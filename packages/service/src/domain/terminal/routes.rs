use std::io::Read;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures::StreamExt;
use serde::Deserialize;
use tracing::{error, info};

use crate::app_state::AppState;
use super::cwd::resolve_cwd;
use super::protocol::{ClientMessage, ServerMessage};
use super::service::PtyHandle;

#[derive(Debug, Deserialize)]
pub struct TerminalWsParams {
    pub feature_id: Option<i64>,
    pub project_id: Option<i64>,
    pub pty_id: Option<String>,
}

pub fn terminal_router() -> Router<AppState> {
    Router::new().route("/api/terminal/ws", get(terminal_ws_handler))
}

async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<TerminalWsParams>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, params, state))
}

async fn handle_terminal_ws(socket: WebSocket, params: TerminalWsParams, state: AppState) {
    let pty_manager = &state.pty_manager;

    // Determine if this is a new PTY or a reconnection
    if let Some(pty_id) = params.pty_id {
        handle_reconnect(socket, &pty_id, pty_manager).await;
    } else if let (Some(feature_id), Some(project_id)) = (params.feature_id, params.project_id) {
        handle_new_pty(socket, feature_id, project_id, &state).await;
    } else {
        send_error(socket, "Missing required params: pty_id or (feature_id + project_id)").await;
    }
}

async fn handle_reconnect(
    socket: WebSocket,
    pty_id: &str,
    pty_manager: &super::service::PtyManager,
) {
    match pty_manager.get_scrollback(pty_id) {
        Some((alive, scrollback)) => {
            let (mut ws_sink, ws_stream) = socket.split();
            let msg = ServerMessage::Reconnected { scrollback, alive };
            if send_msg(&mut ws_sink, &msg).await.is_err() {
                return;
            }

            if alive {
                if let Some(handle) = pty_manager.terminals.get(pty_id) {
                    run_pty_ws_loop(
                        ws_sink,
                        ws_stream,
                        pty_id.to_string(),
                        Arc::clone(handle.value()),
                        pty_manager.clone(),
                    )
                    .await;
                }
            }
            // If not alive, WS stays open briefly for client to read scrollback, then closes
        }
        None => {
            send_error(socket, &format!("PTY not found: {pty_id}")).await;
        }
    }
}

async fn handle_new_pty(
    socket: WebSocket,
    feature_id: i64,
    project_id: i64,
    state: &AppState,
) {
    let cwd = match resolve_cwd(&state.read_pool, feature_id, project_id).await {
        Ok(cwd) => cwd,
        Err(e) => {
            send_error(socket, &format!("Failed to resolve CWD: {e}")).await;
            return;
        }
    };

    let (pty_id, handle) = match state.pty_manager.create_pty(&cwd) {
        Ok(result) => result,
        Err(e) => {
            send_error(socket, &format!("Failed to create PTY: {e}")).await;
            return;
        }
    };

    info!(pty_id = %pty_id, cwd = %cwd, "Created new PTY");

    let (mut ws_sink, ws_stream) = socket.split();
    let ready_msg = ServerMessage::Ready {
        pty_id: pty_id.clone(),
    };
    if send_msg(&mut ws_sink, &ready_msg).await.is_err() {
        return;
    }

    run_pty_ws_loop(
        ws_sink,
        ws_stream,
        pty_id,
        handle,
        state.pty_manager.clone(),
    )
    .await;
}

/// Main loop bridging PTY I/O and WebSocket messages.
async fn run_pty_ws_loop(
    ws_sink: futures::stream::SplitSink<WebSocket, Message>,
    mut ws_stream: futures::stream::SplitStream<WebSocket>,
    pty_id: String,
    handle: Arc<PtyHandle>,
    pty_manager: super::service::PtyManager,
) {
    let reader = Arc::clone(&handle.master_reader);
    let scrollback = Arc::clone(&handle.scrollback);
    let mut alive_rx = handle.alive.subscribe();
    // PTY → WS: read PTY output and send to WebSocket
    let sink = Arc::new(tokio::sync::Mutex::new(ws_sink));
    let sink_read = Arc::clone(&sink);

    let read_task = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            let n = match reader.lock().expect("reader lock").read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };

            let data = String::from_utf8_lossy(&buf[..n]).into_owned();

            // Append to scrollback
            scrollback
                .lock()
                .expect("scrollback lock")
                .append(&buf[..n]);

            let msg = ServerMessage::Data { data };
            let json = msg.to_json();

            // Send via WebSocket (bridge blocking → async)
            let sink = Arc::clone(&sink_read);
            let rt = tokio::runtime::Handle::current();
            if rt
                .block_on(async {
                    use futures::SinkExt;
                    sink.lock().await.send(Message::Text(json.into())).await
                })
                .is_err()
            {
                break;
            }
        }
    });

    // WS → PTY: read WebSocket messages and dispatch to PTY
    let pty_id_write = pty_id.clone();
    let pty_manager_write = pty_manager.clone();
    let write_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Text(text) => {
                    let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                        continue;
                    };
                    match client_msg {
                        ClientMessage::Write { data } => {
                            if let Err(e) =
                                pty_manager_write.write_pty(&pty_id_write, data.as_bytes())
                            {
                                error!(pty_id = %pty_id_write, error = %e, "Write failed");
                            }
                        }
                        ClientMessage::Resize { cols, rows } => {
                            if let Err(e) =
                                pty_manager_write.resize_pty(&pty_id_write, cols, rows)
                            {
                                error!(pty_id = %pty_id_write, error = %e, "Resize failed");
                            }
                        }
                        ClientMessage::Kill => {
                            if let Err(e) = pty_manager_write.kill_pty(&pty_id_write) {
                                error!(pty_id = %pty_id_write, error = %e, "Kill failed");
                            }
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for PTY exit to send exit message
    let sink_exit = Arc::clone(&sink);
    let pty_id_exit = pty_id.clone();
    let exit_task = tokio::spawn(async move {
        // Wait for alive to become false
        while *alive_rx.borrow_and_update() {
            if alive_rx.changed().await.is_err() {
                break;
            }
        }
        let msg = ServerMessage::Exit { code: 0 };
        let json = msg.to_json();
        use futures::SinkExt;
        let _ = sink_exit
            .lock()
            .await
            .send(Message::Text(json.into()))
            .await;
        info!(pty_id = %pty_id_exit, "Sent exit message");
    });

    // Wait for either the WS write task or read task to finish
    tokio::select! {
        _ = write_task => {
            // Client disconnected — PTY stays alive for reconnection
            info!(pty_id = %pty_id, "WebSocket closed, PTY kept alive");
        }
        _ = read_task => {
            // PTY output ended
            info!(pty_id = %pty_id, "PTY read ended");
        }
        _ = exit_task => {
            info!(pty_id = %pty_id, "PTY exited");
        }
    }
}

async fn send_msg(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    msg: &ServerMessage,
) -> Result<(), ()> {
    use futures::SinkExt;
    sink.send(Message::Text(msg.to_json().into()))
        .await
        .map_err(|e| {
            error!("Failed to send WebSocket message: {e}");
        })
}

async fn send_error(socket: WebSocket, message: &str) {
    let (mut sink, _) = socket.split();
    let msg = ServerMessage::Error {
        message: message.to_string(),
    };
    let _ = send_msg(&mut sink, &msg).await;
}
