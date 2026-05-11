use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout};
use tokio::sync::{broadcast, oneshot};
use tokio::task::JoinHandle;

use crate::error::SdkError;
use crate::protocol::{decode_inbound_message, InboundMessage};
use crate::types::AppServerEvent;

pub(crate) type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, SdkError>>>;

pub(crate) struct ReaderState {
    pub(crate) pending: Arc<StdMutex<PendingMap>>,
    pub(crate) events: broadcast::Sender<AppServerEvent>,
    pub(crate) exit_sent: Arc<AtomicBool>,
    pub(crate) max_line_bytes: usize,
}

pub(crate) fn spawn_reader(state: ReaderState, stdout: ChildStdout) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_bounded_line(&mut reader, state.max_line_bytes).await {
                Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                            handle_message(&state, message);
                        }));
                        if let Err(payload) = result {
                            tracing::error!(
                                "codex app-server reader panicked while handling message"
                            );
                            drain_pending_process_exited(&state.pending);
                            std::panic::resume_unwind(payload);
                        }
                    }
                    Err(error) => tracing::warn!(%error, "failed to parse codex app-server line"),
                },
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(%error, "codex app-server stdout read failed");
                    break;
                }
            }
        }

        send_process_exited(&state.pending, &state.events, &state.exit_sent, None, None);
    })
}

pub(crate) fn spawn_stderr_reader(stderr: ChildStderr, max_line_bytes: usize) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        loop {
            match read_bounded_line(&mut reader, max_line_bytes).await {
                Ok(Some(line)) => tracing::warn!(target: "codex_app_server", "{line}"),
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(%error, "codex app-server stderr read failed");
                    break;
                }
            }
        }
    })
}

pub(crate) fn spawn_reaper(
    mut child: Child,
    mut kill_rx: oneshot::Receiver<()>,
    pending: Arc<StdMutex<PendingMap>>,
    events: broadcast::Sender<AppServerEvent>,
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
                tracing::warn!(%error, "failed to reap codex app-server process");
                send_process_exited(&pending, &events, &exit_sent, None, None);
            }
        }
    })
}

fn handle_message(state: &ReaderState, message: Value) {
    match decode_inbound_message(message) {
        InboundMessage::Event(event) => {
            let _ = state.events.send(event);
        }
        InboundMessage::Response { id, result } => {
            let tx = state
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&id));
            if let Some(tx) = tx {
                let _ = tx.send(result);
            }
        }
        InboundMessage::Ignore => {}
    }
}

fn send_process_exited(
    pending: &Arc<StdMutex<PendingMap>>,
    events: &broadcast::Sender<AppServerEvent>,
    exit_sent: &AtomicBool,
    status: Option<i32>,
    signal: Option<i32>,
) {
    if exit_sent.swap(true, Ordering::SeqCst) {
        return;
    }
    drain_pending_process_exited(pending);
    let _ = events.send(AppServerEvent::ProcessExited { status, signal });
}

fn drain_pending_process_exited(pending: &Arc<StdMutex<PendingMap>>) {
    if let Ok(mut pending) = pending.lock() {
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(SdkError::ProcessExited));
        }
    }
}

async fn read_bounded_line<R>(
    reader: &mut R,
    max_line_bytes: usize,
) -> Result<Option<String>, SdkError>
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
            return Err(SdkError::Protocol(format!(
                "app-server line exceeded {max_line_bytes} bytes"
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
        .map_err(|error| SdkError::Protocol(format!("invalid UTF-8 from app-server: {error}")))
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

    use super::{
        drain_pending_process_exited, handle_message, read_bounded_line, ReaderState, SdkError,
    };
    use crate::types::AppServerEvent;

    type PendingMap = Arc<StdMutex<HashMap<u64, oneshot::Sender<Result<Value, SdkError>>>>>;

    fn reader_state() -> (ReaderState, broadcast::Receiver<AppServerEvent>, PendingMap) {
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
    async fn bounded_line_reads_line_without_newline() {
        let mut reader = BufReader::new(&b"hello"[..]);
        assert_eq!(
            read_bounded_line(&mut reader, 1024).await.unwrap(),
            Some("hello".to_string())
        );
        assert_eq!(read_bounded_line(&mut reader, 1024).await.unwrap(), None);
    }

    #[tokio::test]
    async fn bounded_line_rejects_oversized_messages() {
        let mut reader = BufReader::new(&b"abcdef\n"[..]);
        let error = read_bounded_line(&mut reader, 3)
            .await
            .expect_err("line should exceed limit");
        assert!(error.to_string().contains("exceeded"));
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
    async fn handle_message_broadcasts_server_requests() {
        let (state, mut event_rx, _pending) = reader_state();

        handle_message(
            &state,
            json!({ "id": "approval", "method": "tool/request", "params": { "x": 1 } }),
        );

        let AppServerEvent::ServerRequest { id, method, params } = event_rx.recv().await.unwrap()
        else {
            panic!("expected server request event");
        };
        assert_eq!(id, json!("approval"));
        assert_eq!(method, "tool/request");
        assert_eq!(params, json!({ "x": 1 }));
    }

    #[tokio::test]
    async fn process_exit_drains_pending_requests() {
        let (_state, _event_rx, pending) = reader_state();
        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(9, tx);

        drain_pending_process_exited(&pending);

        assert!(matches!(rx.await.unwrap(), Err(SdkError::ProcessExited)));
        assert!(pending.lock().unwrap().is_empty());
    }
}
