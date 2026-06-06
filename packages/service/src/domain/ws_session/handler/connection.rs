//! WebSocket upgrade + per-connection inbound/outbound loop. Hands every
//! parsed envelope to [`super::dispatch::dispatch_envelope`] and sweeps
//! per-connection state on disconnect.

use std::collections::HashMap;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::Extension;
use futures::StreamExt;
use tokio::sync::mpsc;
use tracing::debug;

use crate::api::middleware::authenticate_ws;
use crate::app_state::AppState;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{SessionErrorPayload, WsEnvelope};
use crate::remote::RemoteContext;

use super::dispatch::dispatch_envelope;
use super::helpers::persist_and_close_query;
use super::types::{QueryState, SdkSessions};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    // Present only on the remote listener; its absence means loopback.
    remote: Option<Extension<RemoteContext>>,
) -> Response {
    let (selected_proto, device_id) =
        match authenticate_ws(&headers, &state, remote.as_ref().map(|e| &e.0)).await {
            Ok(resolved) => resolved,
            Err(resp) => return resp,
        };
    let ws = ws.protocols([selected_proto]);
    match device_id {
        Some(device_id) => {
            record_remote_connect(&state, device_id);
            ws.on_upgrade(move |socket| handle_remote_connection(socket, state, device_id))
                .into_response()
        }
        None => ws
            .on_upgrade(move |socket| handle_connection(socket, state))
            .into_response(),
    }
}

/// Wrap the normal connection loop so that revoking the device cancels the
/// session immediately. Cancellation drops `handle_connection`, which drops the
/// socket; the live-session guard deregisters on scope exit.
async fn handle_remote_connection(socket: WebSocket, state: AppState, device_id: i64) {
    let guard = state.remote.live().register(device_id);
    tokio::select! {
        _ = handle_connection(socket, state) => {}
        _ = guard.token.cancelled() => {
            debug!(device_id, "remote session force-closed (device revoked)");
        }
    }
}

/// Best-effort: stamp `last_seen` and write a `connect` audit entry without
/// blocking the upgrade.
fn record_remote_connect(state: &AppState, device_id: i64) {
    let pool = state.write_pool.clone();
    tokio::spawn(async move {
        let _ = crate::domain::remote::repo::touch_last_seen(&pool, device_id).await;
        let _ = crate::domain::remote::repo::record_audit(&pool, "connect", Some(device_id), None)
            .await;
    });
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
                                        ..Default::default()
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

    // Cleanup: pause/persist the queries this connection was *driving* before
    // dropping. Only an `Active` handle (a live turn owned by this connection)
    // is paused and announced Idle. A `Pending` handle means this connection was
    // merely viewing the feature — e.g. a remote device mirroring the
    // conversation — so pausing it or broadcasting Idle would wrongly interrupt
    // whichever device is actually running the turn. (Matches the "for every
    // active session" intent noted in the inbound-loop comment above.)
    let mut sessions = sdk_sessions.lock().await;
    debug!(count = sessions.len(), "WS cleanup: draining sessions");
    for (db_session_id, handle) in sessions.drain() {
        let feature_id = handle.feature_id;
        let runtime_provider = handle.runtime_provider.clone();
        if let QueryState::Active { query, .. } = handle.state {
            persist_and_close_query(&query, &state.write_pool, db_session_id, &runtime_provider)
                .await;
            WsSessionPersistence::mark_paused_static(&state.write_pool, db_session_id).await;
            WsSessionPersistence::broadcast_session_status(
                &state.session_status_tx,
                db_session_id,
                feature_id,
                crate::domain::session_status::AgentStatus::Idle,
                None,
            );
        }
    }
    drop(sessions);

    // Drop any `git.status` subscriptions for this WS. The sender-keyed sweep
    // catches half-open shutdowns where the explicit unsubscribe never arrived.
    state.git_watcher.unsubscribe_sender(&outbound_tx).await;

    // Remove this connection's sender from every feature it was registered under.
    state
        .ws_feature_senders
        .unregister_sender(&outbound_tx)
        .await;

    send_task.abort();
}
