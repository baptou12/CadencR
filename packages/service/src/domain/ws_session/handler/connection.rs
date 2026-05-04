//! WebSocket upgrade + per-connection inbound/outbound loop. Hands every
//! parsed envelope to [`super::dispatch::dispatch_envelope`] and sweeps
//! per-connection state on disconnect.

use std::collections::HashMap;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use futures::StreamExt;
use tokio::sync::mpsc;
use tracing::debug;

use crate::api::middleware::{validate_ws_origin, validate_ws_token};
use crate::app_state::AppState;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{SessionErrorPayload, WsEnvelope};

use super::dispatch::dispatch_envelope;
use super::helpers::persist_and_close_query;
use super::types::{QueryState, SdkSessions};
use super::workflow;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(resp) = validate_ws_origin(&headers, state.frontend_port) {
        return resp;
    }
    let selected_proto = match validate_ws_token(&headers, &state.auth_token) {
        Ok(proto) => proto.to_string(),
        Err(resp) => return resp,
    };
    let ws = ws.protocols([selected_proto]);
    ws.on_upgrade(move |socket| handle_connection(socket, state))
        .into_response()
}

/// Runs the WebSocket connection loop after upgrade.
async fn handle_connection(socket: WebSocket, state: AppState) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<Message>();
    let sdk_sessions: SdkSessions = std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    // Spawn outbound forwarder: reads from channel, writes to WebSocket sink.
    // Exits when either the channel is dropped or the sink fails (peer gone).
    let mut send_task = tokio::spawn(async move {
        use futures::SinkExt;
        while let Some(msg) = outbound_rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Inbound loop: read messages from client. We `select!` against the
    // outbound task so a half-open TCP socket (e.g. laptop sleep, Wi-Fi
    // change) is detected within ~one outbound send attempt instead of
    // waiting minutes for OS-level TCP keepalive. Without this, the cleanup
    // block below — which broadcasts `Idle` for every active session —
    // never runs, leaving the UI stuck on "agent working" while the
    // streamed events drop into a subscriber that nobody reads.
    loop {
        tokio::select! {
            biased;
            _ = &mut send_task => {
                debug!("ws_sink closed; ending inbound loop");
                break;
            }
            msg = ws_stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let text_str: &str = &text;
                        match WsEnvelope::try_from(text_str.to_string()) {
                            Ok(envelope) => {
                                dispatch_envelope(
                                    envelope,
                                    &outbound_tx,
                                    &sdk_sessions,
                                    &state,
                                )
                                .await;
                            }
                            Err(e) => {
                                let err_env = WsEnvelope::new(
                                    "session",
                                    "error",
                                    serde_json::to_value(SessionErrorPayload {
                                        code: "PARSE_ERROR".into(),
                                        message: format!("Invalid envelope: {e}"),
                                    })
                                    .unwrap(),
                                );
                                let _ = outbound_tx
                                    .send(Message::Text(String::from(err_env).into()));
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {} // ignore binary, ping, pong
                    Some(Err(_)) | None => break,
                }
            }
        }
    }

    // Cleanup: mark sessions paused and persist runtime_session_id before dropping
    let mut sessions = sdk_sessions.lock().await;
    debug!(count = sessions.len(), "WS cleanup: draining sessions");
    for (db_session_id, handle) in sessions.drain() {
        let feature_id = handle.feature_id;
        let runtime_provider = handle.runtime_provider.clone();
        if let QueryState::Active { query, .. } = handle.state {
            persist_and_close_query(&query, &state.write_pool, db_session_id, &runtime_provider)
                .await;
        }
        WsSessionPersistence::mark_paused_static(&state.write_pool, db_session_id).await;
        WsSessionPersistence::broadcast_session_status(
            &state.session_status_tx,
            db_session_id,
            feature_id,
            crate::domain::session_status::AgentStatus::Idle,
            None,
        );
    }
    drop(sessions);

    // Detach WS sender from workflow engines (keep engines alive for reconnect)
    for feature_id in workflow::tracked_feature_ids() {
        debug!(
            feature_id,
            "WS cleanup: detaching sender from workflow engine"
        );
        workflow::detach_engine_sender(feature_id);
    }

    // Drop any `git.status` subscriptions for this WS. The sender-keyed sweep
    // catches half-open shutdowns where the explicit unsubscribe never arrived.
    state.git_watcher.unsubscribe_sender(&outbound_tx).await;

    send_task.abort();
}
