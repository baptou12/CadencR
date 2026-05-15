use axum::extract::ws::Message;
use tokio::time::Instant;
use tracing::{debug, error, info};

use crate::domain::agents::adapter::RuntimeMessageRx;
use crate::domain::agents::adapter::RuntimeStreamStatus;
use crate::domain::agents::{runtime_adapter, runtime_session_finished};
use crate::domain::runtime_stream::{
    capture_runtime_session_id, permission_request_payload, persist_usage, RuntimeUsageState,
};
use crate::domain::ws_session::persistence::{
    raw_event_with_agent_message_id, PendingUserInput, WsSessionPersistence,
};
use crate::domain::ws_session::protocol::{
    CommandsUpdatedPayload, PermissionRequestPayload, PromptReceivedPayload, SessionEndedPayload,
    SessionErrorPayload, SessionMessagePayload, SessionStreamStatusPayload,
    SessionUsageUpdatePayload, SlashCommandKindPayload, SlashCommandPayload, StreamStatusState,
    WsEnvelope,
};

use super::super::{send_runtime_session_id, QueryState, SdkSessions, WsSender};
use crate::domain::agents::adapter::RuntimeSpawnConfig;

/// Spawn a background task that forwards runtime messages to the WebSocket client.
pub(crate) fn spawn_stream_reader(
    db_session_id: i64,
    feature_id: i64,
    mut message_rx: RuntimeMessageRx,
    sender: WsSender,
    write_pool: sqlx::SqlitePool,
    session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
    sdk_sessions: SdkSessions,
    runtime_provider: String,
    _model: Option<&str>,
    provider_context_window: Option<u64>,
) {
    tokio::spawn(async move {
        info!(db_session_id, "stream reader started");
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
        let mut needs_session_id_capture = true;
        let mut runtime_session_id: Option<String> = None;
        let mut usage_state = RuntimeUsageState::new(initial_context_window);
        let mut last_runtime_activity = Instant::now();
        let mut last_provider_reconcile = Instant::now();
        let mut last_signal_status: Option<crate::domain::session_status::AgentStatus> = None;
        // Re-armed on every Result; only MessageStart re-enters Agent. Guards
        // against late events (e.g. Codex bash `item/completed` arriving
        // after `turn/completed`) flipping status back to Agent.
        let mut between_turns: bool = true;

        loop {
            let recv_result =
                tokio::time::timeout(std::time::Duration::from_millis(500), message_rx.recv())
                    .await;

            let msg = match recv_result {
                Ok(msg) => msg,
                Err(_) => {
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
                                WsSessionPersistence::broadcast_session_status(
                                    &session_status_tx,
                                    db_session_id,
                                    feature_id,
                                    crate::domain::session_status::AgentStatus::Idle,
                                    None,
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

                    if let Some(client_message_id) =
                        runtime_event.prompt_received_client_message_id()
                    {
                        let env = WsEnvelope::new(
                            "session",
                            "prompt_received",
                            serde_json::to_value(PromptReceivedPayload {
                                client_message_id: client_message_id.to_string(),
                            })
                            .unwrap(),
                        );
                        if sender
                            .send(Message::Text(String::from(env).into()))
                            .is_err()
                        {
                            debug!(
                                db_session_id,
                                "WebSocket sender closed during prompt_received forward"
                            );
                            break;
                        }
                        continue;
                    }

                    if let Some(commands) = runtime_event.slash_commands_updated() {
                        let payload = CommandsUpdatedPayload {
                            commands: commands
                                .iter()
                                .map(|command| SlashCommandPayload {
                                    name: command.name.clone(),
                                    description: command.description.clone(),
                                    kind: match command.kind {
                                        crate::domain::agents::adapter::RuntimeSlashCommandKind::Command => {
                                            SlashCommandKindPayload::Command
                                        }
                                        crate::domain::agents::adapter::RuntimeSlashCommandKind::Skill => {
                                            SlashCommandKindPayload::Skill
                                        }
                                    },
                                })
                                .collect(),
                        };
                        let env = WsEnvelope::new(
                            "commands",
                            "updated",
                            serde_json::to_value(payload).unwrap(),
                        );
                        if sender
                            .send(Message::Text(String::from(env).into()))
                            .is_err()
                        {
                            debug!(
                                db_session_id,
                                "WebSocket sender closed during commands.updated forward"
                            );
                            break;
                        }
                        continue;
                    }

                    if let Some(status) = runtime_event.stream_status() {
                        let payload = match status {
                            RuntimeStreamStatus::Degraded { reason } => {
                                SessionStreamStatusPayload {
                                    state: StreamStatusState::Degraded,
                                    reason: Some(reason.clone()),
                                }
                            }
                            RuntimeStreamStatus::Recovered => SessionStreamStatusPayload {
                                state: StreamStatusState::Recovered,
                                reason: None,
                            },
                        };
                        let env = WsEnvelope::new(
                            "session",
                            "stream_status",
                            serde_json::to_value(payload).unwrap(),
                        );
                        if sender
                            .send(Message::Text(String::from(env).into()))
                            .is_err()
                        {
                            debug!(
                                db_session_id,
                                "WebSocket sender closed during stream_status forward"
                            );
                            break;
                        }
                        continue;
                    }

                    if let Some(request) = runtime_adapter.and_then(|adapter| {
                        adapter.parse_permission_request(runtime_event.raw_json())
                    }) {
                        let is_question = request.tool_name == "AskUserQuestion";
                        let payload: PermissionRequestPayload = permission_request_payload(request);
                        let question_payload = if is_question {
                            Some(serde_json::json!({
                                "tool_name": payload.tool_name.clone(),
                                "tool_input": payload.tool_input.clone(),
                                "request_id": payload.request_id.clone(),
                                "pattern": payload.pattern.clone(),
                            }))
                        } else {
                            None
                        };
                        // Persist + broadcast gates together so snapshots recover them.
                        if let Some(value) = question_payload.as_ref() {
                            WsSessionPersistence::mark_awaiting_user_static(
                                &write_pool,
                                &session_status_tx,
                                db_session_id,
                                feature_id,
                                &PendingUserInput::Question(value),
                            )
                            .await;
                        } else {
                            WsSessionPersistence::mark_awaiting_user_static(
                                &write_pool,
                                &session_status_tx,
                                db_session_id,
                                feature_id,
                                &PendingUserInput::Permission(&payload),
                            )
                            .await;
                        }
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
                        usage_state.set_root_session_id(&runtime_sid);
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

                    if !runtime_event.is_result() {
                        // MessageStart is the only signal that re-enters Agent
                        // after a turn ended.
                        if crate::domain::session_status::event_starts_fresh_turn(&runtime_event) {
                            between_turns = false;
                        }
                        if !between_turns {
                            if let Some(signal) =
                                crate::domain::session_status::provider_signal_for_event(
                                    &runtime_event,
                                )
                            {
                                let next = signal.status();
                                if last_signal_status != Some(next) {
                                    WsSessionPersistence::broadcast_session_signal(
                                        &session_status_tx,
                                        db_session_id,
                                        feature_id,
                                        signal,
                                    );
                                    last_signal_status = Some(next);
                                }
                            }
                        }
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
                    let persisted_message = persistence.persist_runtime_event(&runtime_event).await;

                    // Sub-agent token totals must not clobber the parent row.
                    if !usage_update.is_subagent {
                        let _ = persist_usage(&runtime_event, db_session_id, &write_pool).await;
                    }
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
                        // Re-arm the gate so straggling events can't re-enter Agent.
                        between_turns = true;
                        let has_pending_user_input =
                            WsSessionPersistence::get_session_row(&write_pool, db_session_id)
                                .await
                                .is_some_and(|row| row.has_pending_user_input());
                        if !has_pending_user_input {
                            WsSessionPersistence::broadcast_session_status(
                                &session_status_tx,
                                db_session_id,
                                feature_id,
                                crate::domain::session_status::AgentStatus::Idle,
                                None,
                            );
                            last_signal_status =
                                Some(crate::domain::session_status::AgentStatus::Idle);
                        }
                        WsEnvelope::new(
                            "session",
                            "ended",
                            serde_json::to_value(SessionEndedPayload {
                                reason: "turn_complete".into(),
                            })
                            .unwrap(),
                        )
                    } else {
                        let block = raw_event_with_agent_message_id(
                            runtime_event.raw_json(),
                            persisted_message,
                        );
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
                    let message = e.to_string();
                    error!(db_session_id, error = %message, "SDK stream error");
                    WsSessionPersistence::persist_error_message_static(
                        &write_pool,
                        db_session_id,
                        &message,
                        None,
                    )
                    .await;
                    WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
                    WsSessionPersistence::broadcast_session_status(
                        &session_status_tx,
                        db_session_id,
                        feature_id,
                        crate::domain::session_status::AgentStatus::Idle,
                        None,
                    );
                    let err_env = WsEnvelope::new(
                        "session",
                        "error",
                        serde_json::to_value(SessionErrorPayload {
                            code: "SDK_ERROR".into(),
                            message,
                            ..Default::default()
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

        let mut sessions = sdk_sessions.lock().await;
        if let Some(handle) = sessions.get_mut(&db_session_id) {
            if let QueryState::Active { ref query, .. } = handle.state {
                let q = query.read().await;
                let runtime_session_id = q.session_id().await;
                handle.runtime_control_endpoint = q.runtime_control_endpoint();
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
