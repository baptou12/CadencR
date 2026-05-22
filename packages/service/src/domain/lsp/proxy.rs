//! Bidirectional pump between a WebSocket and an LSP child's stdio.
//!
//! - WS text frames → `Content-Length`-prefixed bytes on child stdin
//! - `Content-Length`-prefixed bytes from child stdout → WS text frames
//! - child stderr → `tracing::warn!` (LSP servers chatter; we keep it visible
//!   for diagnostics without polluting the JSON-RPC channel)
//!
//! Lifetime: the pump returns once any direction terminates. We then issue
//! `child.kill()` so the server cannot outlive the renderer. Crash-restart
//! and grace-period shutdown are step 5; this module deliberately knows
//! nothing about either, which keeps the wire-protocol logic isolated.

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::mpsc;
use tracing::{debug, warn};

use super::framing::{encode_frame, read_frame};

/// Drives the proxy until either side disconnects. Consumes both the
/// WebSocket and the [`Child`].
pub async fn run_proxy(ws: WebSocket, mut child: Child, display_name: &str) {
    let Some(stdin) = child.stdin.take() else {
        warn!("lsp child {display_name} has no stdin");
        let _ = child.kill().await;
        return;
    };
    let Some(stdout) = child.stdout.take() else {
        warn!("lsp child {display_name} has no stdout");
        let _ = child.kill().await;
        return;
    };
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(drain_stderr(stderr, display_name.to_string()));
    }

    let (out_tx, out_rx) = mpsc::unbounded_channel::<Message>();
    let (sink, stream) = ws.split();

    let send_task = tokio::spawn(ws_sender(sink, out_rx));
    let stdout_task = tokio::spawn(stdout_to_ws(stdout, out_tx.clone()));
    let stdin_task = tokio::spawn(ws_to_stdin(stream, stdin));

    // Exit as soon as either direction ends. Whichever task wins first, we
    // tear down the other ends so the child can't hang half-connected.
    tokio::select! {
        _ = stdout_task => debug!("lsp stdout closed; ending proxy for {display_name}"),
        _ = stdin_task => debug!("lsp ws-stream closed; ending proxy for {display_name}"),
        _ = send_task => debug!("lsp ws-sink closed; ending proxy for {display_name}"),
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

/// stdout → WS. Stops on EOF, malformed framing, or non-UTF8 bytes (LSP
/// mandates UTF-8 JSON-RPC, so the latter is unrecoverable).
async fn stdout_to_ws(stdout: ChildStdout, out_tx: mpsc::UnboundedSender<Message>) {
    let mut reader = BufReader::new(stdout);
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(bytes)) => match String::from_utf8(bytes) {
                Ok(text) => {
                    if out_tx.send(Message::Text(text.into())).is_err() {
                        return; // WS sink gone
                    }
                }
                Err(_) => {
                    warn!("lsp child emitted non-UTF8 frame; closing");
                    return;
                }
            },
            Ok(None) => return, // clean EOF
            Err(e) => {
                warn!("lsp framing error: {e}");
                return;
            }
        }
    }
}

/// WS → stdin. Stops when the WebSocket closes or stdin write fails.
async fn ws_to_stdin<S>(mut stream: S, mut stdin: ChildStdin)
where
    S: StreamExt<Item = Result<Message, axum::Error>> + Unpin,
{
    while let Some(msg) = stream.next().await {
        let Ok(msg) = msg else {
            return;
        };
        match msg {
            Message::Text(text) => {
                let frame = encode_frame(text.as_bytes());
                if stdin.write_all(&frame).await.is_err() {
                    return;
                }
                if stdin.flush().await.is_err() {
                    return;
                }
            }
            Message::Binary(_) => {
                // LSP is JSON text only. Ignore binary; matches existing /ws
                // handler's stance on unexpected frame types.
            }
            Message::Close(_) => return,
            // Pings/pongs are handled by axum's built-in keepalive.
            _ => {}
        }
    }
}

/// Outbound channel → WS sink. Splitting this out lets stdout_to_ws use a
/// cheap mpsc send instead of taking the WS sink lock.
async fn ws_sender<S>(mut sink: S, mut rx: mpsc::UnboundedReceiver<Message>)
where
    S: SinkExt<Message> + Unpin,
{
    while let Some(msg) = rx.recv().await {
        if sink.send(msg).await.is_err() {
            return;
        }
    }
}

/// Pipes stderr lines into the tracing subscriber. LSP servers (rust-analyzer
/// especially) log voluminously to stderr; surfacing it via `warn!` makes
/// crashes diagnosable without scattering println across the proxy.
async fn drain_stderr(stderr: ChildStderr, display_name: String) {
    use tokio::io::AsyncBufReadExt;
    let mut reader = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        warn!(server = %display_name, "lsp stderr: {line}");
    }
}
