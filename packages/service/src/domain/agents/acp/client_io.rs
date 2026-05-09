use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Child;
use tokio::sync::{broadcast, oneshot};
use tokio::task::JoinHandle;

use crate::domain::agents::acp::error::AcpError;
use crate::domain::agents::acp::protocol::{decode_inbound_message, InboundMessage};
use crate::domain::agents::acp::types::AcpEvent;

pub(crate) type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, AcpError>>>;

/// State shared between the reader task and the rest of the transport.
///
/// Held by `Arc<StdMutex<...>>` for `pending` (so the reaper can drain it on
/// process exit) and `Arc<AtomicBool>` for `exit_sent` (idempotent terminal
/// event). `events` is a clone of the broadcast sender already held by the
/// client; sending into it is non-blocking and lossy at the receiver end
/// only — the reader never blocks.
pub(crate) struct ReaderState {
    pub(crate) pending: Arc<StdMutex<PendingMap>>,
    pub(crate) events: broadcast::Sender<AcpEvent>,
    pub(crate) exit_sent: Arc<AtomicBool>,
    pub(crate) max_line_bytes: usize,
}

/// Spawn the stdout reader. Reads newline-delimited JSON-RPC frames, decodes
/// each one, and either routes responses to pending waiters or broadcasts
/// events. Bounded line size prevents OOM from a runaway agent.
pub(crate) fn spawn_reader<R>(state: ReaderState, stdout: R) -> JoinHandle<()>
where
    R: AsyncRead + Send + Unpin + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_bounded_line(&mut reader, state.max_line_bytes).await {
                Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        // TEMP-ACP-WIRE-LOG: full inbound JSON-RPC frame.
                        // Remove this once ACP debugging is done — grep
                        // `TEMP-ACP-WIRE-LOG`.
                        tracing::info!(
                            acp_wire = "recv",
                            frame = %line,
                            "ACP recv"
                        );
                        let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                            handle_message(&state, message);
                        }));
                        if let Err(payload) = result {
                            tracing::error!("ACP reader panicked while handling message");
                            drain_pending_process_exited(&state.pending);
                            std::panic::resume_unwind(payload);
                        }
                    }
                    Err(error) => {
                        tracing::warn!(%error, line = %line, "failed to parse ACP line");
                    }
                },
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(%error, "ACP stdout read failed");
                    break;
                }
            }
        }

        // Stdout closed (EOF or read error). The reaper will eventually
        // observe the child exit too and emit a terminal event with the
        // exit code; we still emit one here as a defensive idempotent
        // close so callers waiting on responses don't hang if the reaper
        // is delayed.
        send_process_exited(&state.pending, &state.events, &state.exit_sent, None, None);
    })
}

/// Spawn a stderr reader that just logs each line at warn level. Bounded so
/// a misbehaving agent can't blow up our memory.
pub(crate) fn spawn_stderr_reader<R>(stderr: R, max_line_bytes: usize) -> JoinHandle<()>
where
    R: AsyncRead + Send + Unpin + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        loop {
            match read_bounded_line(&mut reader, max_line_bytes).await {
                Ok(Some(line)) => tracing::warn!(target: "acp", "{line}"),
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(%error, "ACP stderr read failed");
                    break;
                }
            }
        }
    })
}

/// Spawn the reaper. Awaits child exit (or our explicit kill signal), drains
/// pending requests with `ProcessExited`, and broadcasts a terminal event.
pub(crate) fn spawn_reaper(
    mut child: Child,
    mut kill_rx: oneshot::Receiver<()>,
    pending: Arc<StdMutex<PendingMap>>,
    events: broadcast::Sender<AcpEvent>,
    exit_sent: Arc<AtomicBool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status,
            _ = &mut kill_rx => {
                let _ = child.start_kill();
                child.wait().await
            }
        };
        match status {
            Ok(status) => {
                send_process_exited(
                    &pending,
                    &events,
                    &exit_sent,
                    status.code(),
                    exit_signal(&status),
                );
            }
            Err(error) => {
                tracing::warn!(%error, "failed to reap ACP process");
                send_process_exited(&pending, &events, &exit_sent, None, None);
            }
        }
    })
}

fn handle_message(state: &ReaderState, message: Value) {
    match decode_inbound_message(message) {
        InboundMessage::Event(event) => {
            // `send` returns Err only if there are no subscribers — that's
            // not an error condition for our purposes (the client is the
            // first subscriber and others come and go).
            let _ = state.events.send(event);
        }
        InboundMessage::Response { id, result } => {
            let tx = state
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&id));
            if let Some(tx) = tx {
                // Sender drops are fine — caller may have timed out and
                // the receiver is gone. `PendingRequestGuard` will have
                // already cleaned up the map entry in that case (drop
                // ordering: guard drops first, then the response arrives
                // and finds nothing). We log to surface the rare case.
                if tx.send(result).is_err() {
                    tracing::debug!(id, "ACP response dropped — caller no longer waiting");
                }
            } else {
                tracing::debug!(id, "ACP response with no pending request");
            }
        }
        InboundMessage::Ignore => {}
    }
}

fn send_process_exited(
    pending: &Arc<StdMutex<PendingMap>>,
    events: &broadcast::Sender<AcpEvent>,
    exit_sent: &AtomicBool,
    status: Option<i32>,
    signal: Option<i32>,
) {
    if exit_sent.swap(true, Ordering::SeqCst) {
        return;
    }
    // TEMP-ACP-WIRE-LOG: ACP subprocess exit. Pair with `acp_wire = "send"`
    // / `"recv"` frames to detect a respawn between turns. Remove with the
    // rest of the TEMP-ACP-WIRE-LOG calls when ACP debugging is done.
    tracing::info!(acp_wire = "exit", ?status, ?signal, "ACP subprocess exited");
    drain_pending_process_exited(pending);
    let _ = events.send(AcpEvent::ProcessExited { status, signal });
}

fn drain_pending_process_exited(pending: &Arc<StdMutex<PendingMap>>) {
    if let Ok(mut pending) = pending.lock() {
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(AcpError::ProcessExited));
        }
    }
}

/// Read a single newline-delimited frame from the buffered reader, refusing
/// to accumulate more than `max_line_bytes` bytes. On EOF before any data,
/// returns `Ok(None)`. Trims a single trailing `\r` to tolerate CRLF.
async fn read_bounded_line<R>(
    reader: &mut R,
    max_line_bytes: usize,
) -> Result<Option<String>, AcpError>
where
    R: AsyncBufRead + Unpin,
{
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            break;
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.unwrap_or(available.len());
        bytes.extend_from_slice(&available[..take]);
        let found_newline = newline.is_some();
        let consume = newline.map_or(take, |position| position + 1);
        reader.consume(consume);

        if bytes.len() > max_line_bytes {
            return Err(AcpError::Protocol(format!(
                "ACP line exceeded {max_line_bytes} bytes"
            )));
        }
        if found_newline {
            break;
        }
    }
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| AcpError::Protocol(format!("invalid UTF-8 from ACP: {error}")))
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex as StdMutex};

    use serde_json::{json, Value};
    use tokio::io::BufReader;
    use tokio::sync::{broadcast, oneshot};

    use super::{drain_pending_process_exited, handle_message, read_bounded_line, ReaderState};
    use crate::domain::agents::acp::error::AcpError;
    use crate::domain::agents::acp::types::AcpEvent;

    fn reader_state() -> (
        ReaderState,
        broadcast::Receiver<AcpEvent>,
        Arc<StdMutex<HashMap<u64, oneshot::Sender<Result<Value, AcpError>>>>>,
    ) {
        let (events, event_rx) = broadcast::channel(8);
        let pending = Arc::new(StdMutex::new(HashMap::new()));
        (
            ReaderState {
                pending: Arc::clone(&pending),
                events,
                exit_sent: Arc::new(AtomicBool::new(false)),
                max_line_bytes: 1024,
            },
            event_rx,
            pending,
        )
    }

    #[tokio::test]
    async fn reads_line_without_trailing_newline() {
        let mut reader = BufReader::new(&b"hello"[..]);
        assert_eq!(
            read_bounded_line(&mut reader, 1024).await.unwrap(),
            Some("hello".to_string())
        );
        assert_eq!(read_bounded_line(&mut reader, 1024).await.unwrap(), None);
    }

    #[tokio::test]
    async fn rejects_oversized_lines() {
        let mut reader = BufReader::new(&b"abcdef\n"[..]);
        let error = read_bounded_line(&mut reader, 3)
            .await
            .expect_err("line should exceed limit");
        assert!(error.to_string().contains("exceeded"));
    }

    #[tokio::test]
    async fn handles_crlf_terminators() {
        let mut reader = BufReader::new(&b"abc\r\n"[..]);
        assert_eq!(
            read_bounded_line(&mut reader, 1024).await.unwrap(),
            Some("abc".to_string())
        );
    }

    #[tokio::test]
    async fn handle_message_routes_responses_to_pending_request() {
        let (state, _event_rx, pending) = reader_state();
        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(7, tx);

        handle_message(&state, json!({ "id": 7, "result": { "ok": true } }));

        assert_eq!(rx.await.unwrap().unwrap(), json!({ "ok": true }));
        assert!(pending.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn handle_message_broadcasts_notifications() {
        let (state, mut event_rx, _pending) = reader_state();

        handle_message(
            &state,
            json!({ "method": "session/update", "params": { "x": 1 } }),
        );

        let AcpEvent::Notification { method, params } = event_rx.recv().await.unwrap() else {
            panic!("expected notification");
        };
        assert_eq!(method, "session/update");
        assert_eq!(params, json!({ "x": 1 }));
    }

    #[tokio::test]
    async fn handle_message_broadcasts_server_requests() {
        let (state, mut event_rx, _pending) = reader_state();

        handle_message(
            &state,
            json!({ "id": "perm-1", "method": "session/request_permission", "params": { "y": 2 } }),
        );

        let AcpEvent::ServerRequest { id, method, params } = event_rx.recv().await.unwrap() else {
            panic!("expected server request");
        };
        assert_eq!(id, json!("perm-1"));
        assert_eq!(method, "session/request_permission");
        assert_eq!(params, json!({ "y": 2 }));
    }

    #[tokio::test]
    async fn unmatched_response_does_not_disturb_pending_map() {
        let (state, _event_rx, pending) = reader_state();
        let (tx, _rx) = oneshot::channel::<Result<Value, AcpError>>();
        pending.lock().unwrap().insert(1, tx);

        // Stray response with id we never sent — must be a no-op (logged
        // at debug, no panic, no drain).
        handle_message(&state, json!({ "id": 999, "result": null }));

        let pending = pending.lock().unwrap();
        assert!(pending.contains_key(&1));
        assert!(!pending.contains_key(&999));
    }

    #[tokio::test]
    async fn process_exit_drains_pending_requests() {
        let (_state, _event_rx, pending) = reader_state();
        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(9, tx);

        drain_pending_process_exited(&pending);

        assert!(matches!(rx.await.unwrap(), Err(AcpError::ProcessExited)));
        assert!(pending.lock().unwrap().is_empty());
    }
}
