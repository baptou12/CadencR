use tracing::{debug, info};

use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{PromptSendPayload, WsEnvelope};

use super::super::{parse_session_id, send_error, QueryState, SdkHandle, SdkSessions, WsSender};
use super::prompt_followup::{handle_followup_prompt, FollowupPromptContext};
use super::prompt_pending::{handle_pending_prompt, PendingPromptContext};

struct DispatchChanges {
    model_changed: bool,
    mode_changed: bool,
    access_changed: bool,
    effort_changed: bool,
    needs_respawn: bool,
}

/// Handle session.prompt.send: send prompt to runtime or spawn new query.
pub(crate) async fn handle_prompt_send(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let Some(payload) = parse_prompt_payload(&envelope, sender) else {
        return;
    };
    let Some(db_session_id) = parse_prompt_session_id(&payload, &envelope, sender) else {
        return;
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                &format!("Session {db_session_id} not found. Send session.init first."),
            );
            return;
        }
    };

    let changes = apply_respawn_if_needed(handle, app_state, db_session_id).await;
    log_dispatch_decision(handle, db_session_id, &changes);

    match &handle.state {
        QueryState::Pending(_) => {
            // First prompt (or respawn after model change) — take stored options and spawn.
            let spawned_model = handle.desired_model.clone();
            let spawned_thinking_effort = handle.desired_thinking_effort.clone();
            let config = handle.config.clone();
            let feature_id = handle.feature_id;
            let provider_id = handle.runtime_provider.clone();
            let mut options = match std::mem::replace(
                &mut handle.state,
                QueryState::Pending(RuntimeSpawnConfig::default()),
            ) {
                QueryState::Pending(opts) => opts,
                _ => unreachable!(),
            };

            // Use the runtime session ID captured at init time for --resume.
            if options.resume_session_id.is_none() {
                if let Some(runtime_sid) = handle.resume_session_id.take() {
                    info!(db_session_id, runtime_session_id = %runtime_sid, "resuming previous runtime session");
                    options.resume_session_id = Some(runtime_sid);
                } else {
                    debug!(
                        db_session_id,
                        feature_id, "no runtime_session_id found, spawning fresh"
                    );
                }
            }
            let context = PendingPromptContext {
                envelope_id: envelope.id.clone(),
                sender: sender.clone(),
                sdk_sessions: sdk_sessions.clone(),
                app_state: app_state.clone(),
                db_session_id,
                feature_id,
                provider_id,
                spawned_model,
                spawned_thinking_effort,
                config,
                options,
                payload,
                permission_tx: None,
            };
            drop(sessions);
            // Persist user message in the pending helper after releasing sdk_sessions.
            handle_pending_prompt(context).await;
        }
        QueryState::Active { query, .. } => {
            let context = FollowupPromptContext {
                query: query.clone(),
                feature_id: handle.feature_id,
                db_session_id,
                write_pool: app_state.write_pool.clone(),
                session_status_tx: app_state.session_status_tx.clone(),
                sender: sender.clone(),
                ws_feature_senders: app_state.ws_feature_senders.clone(),
                feature_events_tx: app_state.feature_events_tx.clone(),
                envelope_id: envelope.id.clone(),
                sdk_sessions: sdk_sessions.clone(),
                active_turns: app_state.active_turns.clone(),
            };
            drop(sessions);
            handle_followup_prompt(context, payload).await;
        }
    }
}

fn parse_prompt_payload(envelope: &WsEnvelope, sender: &WsSender) -> Option<PromptSendPayload> {
    match serde_json::from_value(envelope.payload.clone()) {
        Ok(payload) => Some(payload),
        Err(error) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &error.to_string());
            None
        }
    }
}

fn parse_prompt_session_id(
    payload: &PromptSendPayload,
    envelope: &WsEnvelope,
    sender: &WsSender,
) -> Option<i64> {
    match parse_session_id(&payload.session_id) {
        Some(id) => Some(id),
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "session_id must be a numeric DB id",
            );
            None
        }
    }
}

async fn apply_respawn_if_needed(
    handle: &mut SdkHandle,
    app_state: &AppState,
    db_session_id: i64,
) -> DispatchChanges {
    let changes = dispatch_changes(handle);
    if !changes.needs_respawn {
        return changes;
    }
    log_respawn(handle, db_session_id);
    let runtime_session_id = close_active_for_respawn(handle, app_state, db_session_id).await;
    reset_handle_to_pending(handle, runtime_session_id);
    changes
}

fn dispatch_changes(handle: &SdkHandle) -> DispatchChanges {
    let model_changed = handle.desired_model != handle.spawned_model;
    let mode_changed = handle.desired_permission_mode != handle.spawned_permission_mode;
    let access_changed = handle.desired_access_mode != handle.spawned_access_mode;
    let effort_changed = handle.desired_thinking_effort != handle.spawned_thinking_effort;
    DispatchChanges {
        model_changed,
        mode_changed,
        access_changed,
        effort_changed,
        needs_respawn: matches!(&handle.state, QueryState::Active { .. })
            && (model_changed || mode_changed || access_changed || effort_changed),
    }
}

fn log_respawn(handle: &SdkHandle, db_session_id: i64) {
    info!(
        db_session_id,
        old_model = ?handle.spawned_model,
        new_model = ?handle.desired_model,
        old_mode = ?handle.spawned_permission_mode,
        new_mode = ?handle.desired_permission_mode,
        old_access_mode = ?handle.spawned_access_mode,
        new_access_mode = ?handle.desired_access_mode,
        old_effort = ?handle.spawned_thinking_effort,
        new_effort = ?handle.desired_thinking_effort,
        "runtime config changed, respawning runtime with --resume"
    );
}

async fn close_active_for_respawn(
    handle: &mut SdkHandle,
    app_state: &AppState,
    db_session_id: i64,
) -> Option<String> {
    let QueryState::Active { query, .. } = &handle.state else {
        return None;
    };
    let session_id = query.read().await.session_id().await;
    if let Some(ref runtime_session_id) = session_id {
        WsSessionPersistence::persist_runtime_session_id_static(
            &app_state.write_pool,
            db_session_id,
            &handle.runtime_provider,
            runtime_session_id,
        )
        .await;
    }
    query.write().await.close().await;
    session_id
}

fn reset_handle_to_pending(handle: &mut SdkHandle, resume_session_id: Option<String>) {
    let options = RuntimeSpawnConfig {
        cwd: handle.config.cwd.clone(),
        permission_mode: handle.desired_permission_mode.clone(),
        access_mode: handle.desired_access_mode.clone(),
        model: handle.desired_model.clone(),
        thinking_effort: handle.desired_thinking_effort.clone(),
        system_prompt: handle.config.system_prompt.clone(),
        resume_session_id,
        allow_bypass_permissions: handle.config.allow_bypass_permissions,
        env: handle.config.env.clone(),
        ..RuntimeSpawnConfig::default()
    };
    handle.spawned_model = handle.desired_model.clone();
    handle.spawned_permission_mode = handle.desired_permission_mode.clone();
    handle.spawned_access_mode = handle.desired_access_mode.clone();
    handle.spawned_thinking_effort = handle.desired_thinking_effort.clone();
    handle.config.permission_mode = handle.desired_permission_mode.clone();
    handle.config.access_mode = handle.desired_access_mode.clone();
    handle.config.thinking_effort = handle.desired_thinking_effort.clone();
    handle.state = QueryState::Pending(options);
}

fn log_dispatch_decision(handle: &SdkHandle, db_session_id: i64, changes: &DispatchChanges) {
    info!(
        db_session_id,
        desired_model = ?handle.desired_model,
        spawned_model = ?handle.spawned_model,
        desired_mode = ?handle.desired_permission_mode,
        spawned_mode = ?handle.spawned_permission_mode,
        desired_effort = ?handle.desired_thinking_effort,
        spawned_effort = ?handle.spawned_thinking_effort,
        model_changed = changes.model_changed,
        mode_changed = changes.mode_changed,
        access_changed = changes.access_changed,
        effort_changed = changes.effort_changed,
        needs_respawn = changes.needs_respawn,
        state = match &handle.state {
            QueryState::Pending(_) => "pending",
            QueryState::Active { .. } => "active",
        },
        "prompt_send dispatch decision"
    );
}
