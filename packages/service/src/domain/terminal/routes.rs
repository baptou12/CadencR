use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures::SinkExt;
use futures::StreamExt;
use serde::Deserialize;
use tokio::sync::broadcast;
use tracing::{error, info};

use super::cwd::resolve_cwd;
use super::protocol::{ClientMessage, ServerMessage};
use super::service::PtyHandle;
use crate::app_state::AppState;

type WsSink = futures::stream::SplitSink<WebSocket, Message>;
type WsStream = futures::stream::SplitStream<WebSocket>;

#[derive(Debug, Deserialize)]
pub struct TerminalWsParams {
    pub feature_id: Option<i64>,
    pub project_id: Option<i64>,
    pub pty_id: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
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

    if let Some(pty_id) = params.pty_id {
        handle_reconnect(socket, &pty_id, pty_manager).await;
    } else if let (Some(feature_id), Some(project_id)) = (params.feature_id, params.project_id) {
        let cols = params.cols.unwrap_or(80);
        let rows = params.rows.unwrap_or(24);
        handle_new_pty(socket, feature_id, project_id, cols, rows, &state).await;
    } else {
        send_error(
            socket,
            "Missing required params: pty_id or (feature_id + project_id)",
        )
        .await;
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
    cols: u16,
    rows: u16,
    state: &AppState,
) {
    let cwd = match resolve_cwd(&state.read_pool, feature_id, project_id).await {
        Ok(cwd) => cwd,
        Err(e) => {
            send_error(socket, &format!("Failed to resolve CWD: {e}")).await;
            return;
        }
    };

    let (pty_id, handle) = match state.pty_manager.create_pty(&cwd, cols, rows) {
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

/// Spawn task that forwards PTY broadcast data to the WebSocket sink.
fn spawn_pty_to_ws_forwarder(
    sink: Arc<tokio::sync::Mutex<WsSink>>,
    mut data_rx: broadcast::Receiver<String>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            match data_rx.recv().await {
                Ok(data) => {
                    let msg = ServerMessage::Data { data };
                    let json = msg.to_json();
                    if sink
                        .lock()
                        .await
                        .send(Message::Text(json.into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    })
}

/// Spawn task that reads WebSocket messages and dispatches writes/resizes/kills to the PTY.
fn spawn_ws_to_pty_writer(
    mut ws_stream: WsStream,
    pty_id: String,
    pty_manager: super::service::PtyManager,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Text(text) => {
                    let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                        continue;
                    };
                    match client_msg {
                        ClientMessage::Write { data } => {
                            if let Err(e) = pty_manager.write_pty(&pty_id, data.as_bytes()) {
                                error!(pty_id = %pty_id, error = %e, "Write failed");
                            }
                        }
                        ClientMessage::Resize { cols, rows } => {
                            if let Err(e) = pty_manager.resize_pty(&pty_id, cols, rows) {
                                error!(pty_id = %pty_id, error = %e, "Resize failed");
                            }
                        }
                        ClientMessage::Kill => {
                            if let Err(e) = pty_manager.kill_pty(&pty_id) {
                                error!(pty_id = %pty_id, error = %e, "Kill failed");
                            }
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    })
}

/// Spawn task that sends an Exit message to the WebSocket when the PTY process ends.
fn spawn_exit_watcher(
    sink: Arc<tokio::sync::Mutex<WsSink>>,
    pty_id: String,
    handle: Arc<PtyHandle>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut alive_rx = handle.alive.subscribe();
        loop {
            if alive_rx.borrow_and_update().is_some() {
                break;
            }
            if alive_rx.changed().await.is_err() {
                break;
            }
        }
        let exit_code = alive_rx.borrow().unwrap_or(-1);
        let msg = ServerMessage::Exit { code: exit_code };
        let json = msg.to_json();
        let _ = sink.lock().await.send(Message::Text(json.into())).await;
        info!(pty_id = %pty_id, "Sent exit message");
    })
}

/// Orchestrate PTY ↔ WebSocket bridging using the PTY's persistent broadcast channel.
async fn run_pty_ws_loop(
    ws_sink: WsSink,
    ws_stream: WsStream,
    pty_id: String,
    handle: Arc<PtyHandle>,
    pty_manager: super::service::PtyManager,
) {
    let data_rx = handle.data_tx.subscribe();
    let sink = Arc::new(tokio::sync::Mutex::new(ws_sink));

    let mut forward_task = spawn_pty_to_ws_forwarder(Arc::clone(&sink), data_rx);
    let mut write_task = spawn_ws_to_pty_writer(ws_stream, pty_id.clone(), pty_manager);
    let mut exit_task = spawn_exit_watcher(Arc::clone(&sink), pty_id.clone(), Arc::clone(&handle));

    tokio::select! {
        _ = &mut write_task => {
            info!(pty_id = %pty_id, "WebSocket closed, PTY kept alive");
        }
        _ = &mut forward_task => {
            info!(pty_id = %pty_id, "PTY broadcast channel closed");
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), &mut exit_task).await;
        }
        _ = &mut exit_task => {
            info!(pty_id = %pty_id, "PTY exited");
        }
    }

    write_task.abort();
    forward_task.abort();
    exit_task.abort();

    let _ = sink.lock().await.send(Message::Close(None)).await;
}

async fn send_msg(sink: &mut WsSink, msg: &ServerMessage) -> Result<(), ()> {
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
