use axum::extract::ws::Message;
use serde_json::Value;
use tokio::time::Instant;
use tracing::{debug, error, info};

use crate::domain::agents::adapter::RuntimeMessageRx;
use crate::domain::agents::runtime_adapter;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{
    PermissionRequestPayload, SessionEndedPayload, SessionErrorPayload, SessionMessagePayload,
    SessionUsageUpdatePayload, WsEnvelope,
};

use super::super::{QueryState, SdkSessions, WsSender};
use crate::domain::agents::adapter::RuntimeSpawnConfig;

/// Spawn a background task that reads from the runtime message receiver and forwards
/// messages to the WebSocket client.
pub(crate) fn spawn_stream_reader(
    db_session_id: i64,
    feature_id: i64,
    mut message_rx: RuntimeMessageRx,
    sender: WsSender,
    write_pool: sqlx::SqlitePool,
    turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    sdk_sessions: SdkSessions,
    runtime_provider: String,
    model: Option<&str>,
    provider_context_window: Option<u64>,
) {
    let initial_context_window = provider_context_window
        .unwrap_or_else(|| {
            model
                .map(crate::domain::usage::context_window_for_model)
                .unwrap_or(crate::api::DEFAULT_CONTEXT_WINDOW)
        });
    tokio::spawn(async move {
        info!(db_session_id, "stream reader started");
        let runtime_adapter = runtime_adapter(&runtime_provider);
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        // Capture the runtime session ID from the first event that has one.
        let mut needs_session_id_capture = true;
        let mut runtime_session_id: Option<String> = None;
        let mut context_window: u64 = initial_context_window;
        let mut last_runtime_activity = Instant::now();
        let mut last_opencode_reconcile = Instant::now();

        loop {
            let recv_result =
                tokio::time::timeout(std::time::Duration::from_millis(500), message_rx.recv())
                    .await;

            let msg = match recv_result {
                Ok(msg) => msg,
                Err(_) => {
                    // Timeout — check if WS sender is still alive
                    if sender.send(Message::Ping(vec![].into())).is_err() {
                        debug!(
                            db_session_id,
                            "WebSocket closed during timeout check, stopping stream reader"
                        );
                        break;
                    }
                    if runtime_provider == "opencode"
                        && last_runtime_activity.elapsed() >= std::time::Duration::from_millis(750)
                        && last_opencode_reconcile.elapsed()
                            >= std::time::Duration::from_millis(750)
                    {
                        last_opencode_reconcile = Instant::now();
                        if let Some(runtime_sid) = runtime_session_id.as_deref() {
                            if opencode_session_is_finished(runtime_sid).await {
                                info!(
                                    db_session_id,
                                    runtime_session_id = runtime_sid,
                                    "opencode server reports finished session; reconciling completion"
                                );
                                WsSessionPersistence::mark_completed_static(
                                    &write_pool,
                                    db_session_id,
                                )
                                .await;
                                WsSessionPersistence::broadcast_turn_state(
                                    &turn_state_tx,
                                    feature_id,
                                    "none",
                                );
                                let end_env = WsEnvelope::new(
                                    "session",
                                    "ended",
                                    serde_json::to_value(SessionEndedPayload {
                                        reason: "provider_complete".into(),
                                    })
                                    .unwrap(),
                                );
                                let _ = sender.send(Message::Text(String::from(end_env).into()));
                                break;
                            }
                        }
                    }
                    continue;
                }
            };

            match msg {
                Some(Ok(runtime_event)) => {
                    last_runtime_activity = Instant::now();
                    if let Some(request) = runtime_adapter.and_then(|adapter| {
                        adapter.parse_permission_request(runtime_event.raw_json())
                    }) {
                        let envelope = WsEnvelope::new(
                            "session",
                            "permission.request",
                            serde_json::to_value(PermissionRequestPayload {
                                request_id: request.request_id,
                                tool_name: request.tool_name,
                                tool_input: request.tool_input,
                                description: request.description,
                                pattern: request.pattern,
                            })
                            .unwrap(),
                        );
                        let _ = sender.send(Message::Text(String::from(envelope).into()));
                        WsSessionPersistence::broadcast_turn_state(
                            &turn_state_tx,
                            feature_id,
                            "askUser",
                        );
                        continue;
                    }

                    if needs_session_id_capture {
                        if let Some(runtime_sid) = runtime_event.session_id() {
                            if !runtime_sid.is_empty() {
                                needs_session_id_capture = false;
                                runtime_session_id = Some(runtime_sid.to_string());
                                info!(db_session_id, runtime_session_id = %runtime_sid, "stream_reader: persisting runtime session_id to DB");
                                WsSessionPersistence::persist_runtime_session_id_static(
                                    &write_pool,
                                    db_session_id,
                                    &runtime_provider,
                                    runtime_sid,
                                )
                                .await;
                            }
                        }
                    }

                    // Capture context window from init event (prefer provider-
                    // reported value, fall back to model-id lookup).
                    if let Some(init) = runtime_event.init() {
                        if let Some(cw) = init.context_window {
                            context_window = cw;
                        } else if let Some(model) = init.model.as_deref() {
                            context_window = crate::domain::usage::context_window_for_model(model);
                        }
                        WsSessionPersistence::update_context_window(
                            &write_pool,
                            db_session_id,
                            context_window,
                        )
                        .await;
                    }

                    // Persist before forwarding (best-effort).
                    persistence.persist_runtime_event(&runtime_event).await;

                    if let Some(usage) = runtime_event.usage() {
                        if !usage.is_zero() {
                            WsSessionPersistence::update_token_usage(
                                &write_pool,
                                db_session_id,
                                usage.input_tokens,
                                usage.output_tokens,
                            )
                            .await;

                            let usage_env = WsEnvelope::new(
                                "session",
                                "usage_update",
                                serde_json::to_value(SessionUsageUpdatePayload {
                                    input_tokens: usage.input_tokens,
                                    output_tokens: usage.output_tokens,
                                    context_window,
                                })
                                .unwrap(),
                            );
                            let _ = sender.send(Message::Text(String::from(usage_env).into()));
                        }
                    }

                    let envelope = if runtime_event.is_result() {
                        WsSessionPersistence::mark_completed_static(&write_pool, db_session_id)
                            .await;
                        WsSessionPersistence::broadcast_turn_state(
                            &turn_state_tx,
                            feature_id,
                            "none",
                        );
                        WsEnvelope::new(
                            "session",
                            "ended",
                            serde_json::to_value(SessionEndedPayload {
                                reason: "turn_complete".into(),
                            })
                            .unwrap(),
                        )
                    } else {
                        let block = runtime_event.raw_json().clone();
                        WsEnvelope::new(
                            "session",
                            "message",
                            serde_json::to_value(SessionMessagePayload {
                                blocks: vec![block],
                            })
                            .unwrap(),
                        )
                    };

                    if sender
                        .send(Message::Text(String::from(envelope).into()))
                        .is_err()
                    {
                        debug!(
                            db_session_id,
                            "WebSocket sender closed, stopping stream reader"
                        );
                        break;
                    }
                }
                Some(Err(e)) => {
                    error!(db_session_id, error = %e, "SDK stream error");
                    WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
                    WsSessionPersistence::broadcast_turn_state(&turn_state_tx, feature_id, "none");
                    let err_env = WsEnvelope::new(
                        "session",
                        "error",
                        serde_json::to_value(SessionErrorPayload {
                            code: "SDK_ERROR".into(),
                            message: e.to_string(),
                        })
                        .unwrap(),
                    );
                    let _ = sender.send(Message::Text(String::from(err_env).into()));
                    break;
                }
                None => {
                    info!(db_session_id, "SDK stream closed");
                    let end_env = WsEnvelope::new(
                        "session",
                        "ended",
                        serde_json::to_value(SessionEndedPayload {
                            reason: "stream_closed".into(),
                        })
                        .unwrap(),
                    );
                    let _ = sender.send(Message::Text(String::from(end_env).into()));
                    break;
                }
            }
        }

        // Transition Active -> Pending so the next prompt.send spawns a fresh
        // runtime process with --resume instead of writing to dead stdin.
        let mut sessions = sdk_sessions.lock().await;
        if let Some(handle) = sessions.get_mut(&db_session_id) {
            if let QueryState::Active { ref query, .. } = handle.state {
                let q = query.lock().await;
                let runtime_session_id = q.session_id().await;
                drop(q);

                let options = RuntimeSpawnConfig {
                    cwd: handle.config.cwd.clone(),
                    permission_mode: handle.desired_permission_mode.clone(),
                    model: handle.desired_model.clone(),
                    system_prompt: handle.config.system_prompt.clone(),
                    resume_session_id: runtime_session_id,
                    ..RuntimeSpawnConfig::default()
                };

                info!(
                    db_session_id,
                    "stream ended, transitioning Active -> Pending for resume"
                );
                handle.state = QueryState::Pending(options);
            }
        }
    });
}

async fn opencode_session_is_finished(runtime_session_id: &str) -> bool {
    let Ok(server) = opencode_sdk_rs::OpenCodeServer::ensure_running().await else {
        return false;
    };
    let url = format!("{}/session/{runtime_session_id}/message", server.base_url);
    let Ok(response) = reqwest::get(url).await else {
        return false;
    };
    let Ok(body) = response.json::<Value>().await else {
        return false;
    };
    latest_opencode_message_is_final_stop(&body)
}

fn latest_opencode_message_is_final_stop(body: &Value) -> bool {
    let Some(messages) = body.as_array() else {
        return false;
    };
    messages
        .iter()
        .rev()
        .find_map(opencode_sdk_rs::parse_message_from)
        .is_some_and(|message| {
            matches!(message.role, opencode_sdk_rs::MessageRole::Assistant)
                && message.is_terminal_turn_message()
        })
}
