use axum::extract::ws::Message;
use tokio::time::Instant;
use tracing::{debug, error, info};

use crate::domain::agents::adapter::RuntimeMessageRx;
use crate::domain::agents::{runtime_adapter, runtime_session_finished};
use crate::domain::runtime_stream::{
    capture_runtime_session_id, permission_request_payload, persist_usage, RuntimeUsageState,
};
use crate::domain::ws_session::persistence::{PendingUserInput, WsSessionPersistence};
use crate::domain::ws_session::protocol::{
    PermissionRequestPayload, SessionEndedPayload, SessionErrorPayload, SessionMessagePayload,
    SessionUsageUpdatePayload, WsEnvelope,
};

use super::super::{send_runtime_session_id, QueryState, SdkSessions, WsSender};
use crate::domain::agents::adapter::RuntimeSpawnConfig;

/// Spawn a background task that reads from the runtime message receiver and forwards
/// messages to the WebSocket client.
pub(crate) fn spawn_stream_reader(
    db_session_id: i64,
    feature_id: i64,
    mut message_rx: RuntimeMessageRx,
    sender: WsSender,
    write_pool: sqlx::SqlitePool,
    turn_state_tx: crate::app_state::TurnStateBroadcaster,
    sdk_sessions: SdkSessions,
    runtime_provider: String,
    _model: Option<&str>,
    provider_context_window: Option<u64>,
) {
    tokio::spawn(async move {
        info!(db_session_id, "stream reader started");
        // Seed from provider (opencode) or from the persisted session row
        // when resuming; `None` means unknown until the first authoritative
        // event arrives.
        let initial_context_window: Option<u64> = match provider_context_window {
            Some(cw) if cw > 0 => Some(cw),
            _ => WsSessionPersistence::get_session_row(&write_pool, db_session_id)
                .await
                .and_then(|row| row.context_window)
                .and_then(|cw| u64::try_from(cw).ok())
                .filter(|cw| *cw > 0),
        };
        let runtime_adapter = runtime_adapter(&runtime_provider);
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        // Capture the runtime session ID from the first event that has one.
        let mut needs_session_id_capture = true;
        let mut runtime_session_id: Option<String> = None;
        let mut usage_state = RuntimeUsageState::new(initial_context_window);
        let mut last_runtime_activity = Instant::now();
        let mut last_provider_reconcile = Instant::now();

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
                    if last_runtime_activity.elapsed() >= std::time::Duration::from_millis(750)
                        && last_provider_reconcile.elapsed()
                            >= std::time::Duration::from_millis(750)
                    {
                        last_provider_reconcile = Instant::now();
                        if let Some(runtime_sid) = runtime_session_id.as_deref() {
                            if runtime_session_finished(&runtime_provider, runtime_sid).await {
                                info!(
                                    db_session_id,
                                    runtime_session_id = runtime_sid,
                                    "provider reports finished session; reconciling completion"
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
                        let payload: PermissionRequestPayload = permission_request_payload(request);
                        // Persist + broadcast "askUser" together. The OpenCode
                        // stream path previously only broadcast, leaving the
                        // DB blank — any snapshot recovery silently dropped
                        // the gate. Now reconnect/lag resubscribe reads a
                        // consistent row.
                        WsSessionPersistence::mark_awaiting_user_static(
                            &write_pool,
                            &turn_state_tx,
                            db_session_id,
                            feature_id,
                            &PendingUserInput::Permission(&payload),
                        )
                        .await;
                        let envelope = WsEnvelope::new(
                            "session",
                            "permission.request",
                            serde_json::to_value(&payload).unwrap(),
                        );
                        let _ = sender.send(Message::Text(String::from(envelope).into()));
                        continue;
                    }

                    if let Some(runtime_sid) =
                        capture_runtime_session_id(&runtime_event, &mut needs_session_id_capture)
                    {
                        runtime_session_id = Some(runtime_sid.clone());
                        info!(db_session_id, runtime_session_id = %runtime_sid, "stream_reader: persisting runtime session_id to DB");
                        WsSessionPersistence::persist_runtime_session_id_static(
                            &write_pool,
                            db_session_id,
                            &runtime_provider,
                            &runtime_sid,
                        )
                        .await;
                        send_runtime_session_id(&sender, &runtime_sid);
                    }

                    let usage_update = usage_state.apply_event(runtime_adapter, &runtime_event);
                    if usage_update.context_window_changed {
                        WsSessionPersistence::update_context_window(
                            &write_pool,
                            db_session_id,
                            usage_update.snapshot.context_window,
                        )
                        .await;
                    }

                    // Persist before forwarding (best-effort).
                    persistence.persist_runtime_event(&runtime_event).await;

                    let _ = persist_usage(&runtime_event, db_session_id, &write_pool).await;
                    if usage_update.changed
                        && (usage_update.snapshot.input_tokens > 0
                            || usage_update.snapshot.output_tokens > 0)
                    {
                        let usage_env = WsEnvelope::new(
                            "session",
                            "usage_update",
                            serde_json::to_value(SessionUsageUpdatePayload {
                                input_tokens: usage_update.snapshot.input_tokens,
                                output_tokens: usage_update.snapshot.output_tokens,
                                context_window: usage_update.snapshot.context_window,
                            })
                            .unwrap(),
                        );
                        let _ = sender.send(Message::Text(String::from(usage_env).into()));
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
                    thinking_effort: handle.desired_thinking_effort.clone(),
                    system_prompt: handle.config.system_prompt.clone(),
                    resume_session_id: runtime_session_id,
                    env: handle.config.env.clone(),
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
