use std::path::PathBuf;

use axum::extract::ws::Message;
use tracing::{error, info};

use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::session_prompt::PermissionResponse;
use super::{
    parse_permission_mode, parse_session_id, persist_and_close_query, send_error, QueryState,
    SdkSessions, WsSender,
};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::workflow::engine::WsSender as WorkflowWsSender;
use crate::domain::workflow::worktree;

/// Handle session.permission.respond
pub(super) async fn handle_permission_respond(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: PermissionRespondPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    let permission_tx = match &handle.state {
        QueryState::Active { permission_tx, .. } => permission_tx,
        QueryState::Pending(_) => {
            // Handle restored plan approval: CLI is not running, store result in DB
            // so the next CLI spawn can pick it up.
            if payload.request_id.starts_with("plan_restore_") {
                let approved = matches!(
                    payload.decision,
                    PermissionDecision::AllowOnce | PermissionDecision::AllowFuture
                );
                let result_json = serde_json::json!({
                    "approved": approved,
                    "feedback": payload.feedback,
                });
                let _ = sqlx::query(
                    "UPDATE agent_sessions SET plan_approval_result = ?, pending_plan_approval = NULL WHERE id = ?"
                )
                    .bind(result_json.to_string())
                    .bind(db_session_id)
                    .execute(&app_state.write_pool)
                    .await;
                info!(
                    db_session_id,
                    approved, "stored restored plan approval result in DB"
                );
                return;
            }
            send_error(
                sender,
                &envelope.id,
                "INVALID_STATE",
                "Session not yet active",
            );
            return;
        }
    };

    // Persist user answer for AskUserQuestion so it survives app restart.
    if let Some(ref updated_input) = payload.updated_input {
        if let Some(answers) = updated_input.get("answers") {
            if let Some(answer_text) = answers.get("0").and_then(|v| v.as_str()) {
                let feature_id = handle.feature_id;
                let p = WsSessionPersistence::with_session_id(
                    app_state.write_pool.clone(),
                    feature_id,
                    Some(db_session_id),
                );
                p.persist_user_message(answer_text).await;
            }
        }
    }

    let response = PermissionResponse {
        decision: payload.decision,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
    };

    if permission_tx.send(response).await.is_err() {
        send_error(
            sender,
            &envelope.id,
            "CHANNEL_ERROR",
            "Permission channel closed",
        );
    }
}

/// Handle session.provider.set: change the provider before the first prompt only.
pub(super) async fn handle_provider_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ProviderSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    if payload.provider != DEFAULT_PROVIDER {
        send_error(
            sender,
            &envelope.id,
            "UNSUPPORTED_PROVIDER",
            &format!("Only {DEFAULT_PROVIDER} is implemented right now"),
        );
        return;
    }

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    match &mut handle.state {
        QueryState::Pending(_) => {
            let _ = sqlx::query("UPDATE agent_sessions SET runtime_provider = ? WHERE id = ?")
                .bind(&payload.provider)
                .bind(db_session_id)
                .execute(&app_state.write_pool)
                .await;

            let reply = WsEnvelope::reply(
                &envelope.id,
                "session",
                "provider.set.ok",
                serde_json::to_value(serde_json::json!({ "provider": payload.provider })).unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(reply).into()));
        }
        QueryState::Active { .. } => {
            send_error(
                sender,
                &envelope.id,
                "PROVIDER_LOCKED",
                "Provider cannot be changed after the conversation starts",
            );
        }
    }
}

/// Handle session.model.set: change the model and persist to DB.
pub(super) async fn handle_model_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ModelSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    info!(db_session_id, model = %payload.model, "updating desired model");
    handle.desired_model = Some(payload.model.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            options.model = Some(payload.model.clone());
        }
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.set_model(&payload.model).await {
                error!(db_session_id, error = %e, "failed to set model on active query");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
                return;
            }
        }
    }

    // Persist to DB
    WsSessionPersistence::update_model_static(&app_state.write_pool, db_session_id, &payload.model)
        .await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "model.set.ok",
        serde_json::to_value(serde_json::json!({ "model": payload.model })).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.mode.set: change the permission mode and persist to DB.
pub(super) async fn handle_mode_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ModeSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let new_mode = parse_permission_mode(&payload.mode);

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    info!(db_session_id, mode = %payload.mode, "updating permission mode");
    handle.desired_permission_mode = Some(new_mode.clone());
    handle.config.permission_mode = Some(new_mode.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            options.permission_mode = Some(new_mode);
        }
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.set_permission_mode(new_mode).await {
                error!(db_session_id, error = %e, "failed to set permission mode on active query");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
                return;
            }
        }
    }

    // Persist to DB
    WsSessionPersistence::update_permission_mode_static(
        &app_state.write_pool,
        db_session_id,
        &payload.mode,
    )
    .await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "mode.changed",
        serde_json::to_value(serde_json::json!({ "mode": payload.mode })).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.interrupt
pub(super) async fn handle_interrupt(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    match &handle.state {
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.interrupt().await {
                error!(db_session_id, error = %e, "interrupt failed");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
            }
        }
        QueryState::Pending(_) => {
            send_error(sender, &envelope.id, "INVALID_STATE", "Session not active");
        }
    }
}

/// Handle session.destroy: mark session as completed and close subprocess.
pub(super) async fn handle_destroy(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.remove(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    let feature_id = handle.feature_id;

    // Close active subprocess if running
    if let QueryState::Active { query, .. } = handle.state {
        persist_and_close_query(&query, &app_state.write_pool, db_session_id).await;
    }

    WsSessionPersistence::mark_completed_static(&app_state.write_pool, db_session_id).await;
    WsSessionPersistence::broadcast_turn_state(&app_state.turn_state_tx, feature_id, "none");

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "ended",
        serde_json::to_value(SessionEndedPayload {
            reason: "destroyed".into(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.delete: hard-delete a session and its messages from the DB.
pub(super) async fn handle_delete(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    // Remove from in-memory map if present (shouldn't be active, but clean up)
    sdk_sessions.lock().await.remove(&db_session_id);

    match WsSessionPersistence::delete_session_static(&app_state.write_pool, db_session_id).await {
        Ok((feature_id, agent_type)) => {
            WsSessionPersistence::broadcast_turn_state(
                &app_state.turn_state_tx,
                feature_id,
                "none",
            );

            // When deleting a plan or prd agent, reset workflow status to idle
            // so the UI doesn't show a ghost agent on next hydration.
            if matches!(agent_type.as_deref(), Some("plan") | Some("prd")) {
                use crate::domain::features::repository::{
                    force_workflow_status, get_workflow_status,
                };
                use crate::domain::workflow::status::WorkflowStatus;
                let previous: WorkflowStatus =
                    get_workflow_status(&app_state.write_pool, feature_id)
                        .await
                        .unwrap_or(WorkflowStatus::Idle);
                if let Err(e) =
                    force_workflow_status(&app_state.write_pool, feature_id, WorkflowStatus::Idle)
                        .await
                {
                    error!(feature_id, %e, "failed to reset workflow status after session delete");
                } else {
                    let status_msg = WsEnvelope::new(
                        "workflow",
                        "status_changed",
                        serde_json::to_value(WorkflowStatusChangedPayload {
                            feature_id,
                            status: "idle".to_string(),
                            previous_status: previous.to_string(),
                        })
                        .unwrap(),
                    );
                    let _ = sender.send(Message::Text(String::from(status_msg).into()));
                }
            }

            let reply = WsEnvelope::reply(
                &envelope.id,
                "session",
                "deleted",
                serde_json::json!({ "session_id": db_session_id.to_string() }),
            );
            let _ = sender.send(Message::Text(String::from(reply).into()));
        }
        Err(reason) => {
            send_error(sender, &envelope.id, "DELETE_FAILED", &reason);
        }
    }
}

/// Handle session.clear: archive conversation and reset to fresh state.
pub(super) async fn handle_clear(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    // Close active subprocess if any, capturing claude_session_id for archive.
    // If stream already finished (Pending with resume), extract from those options.
    let cli_sid = match &handle.state {
        QueryState::Active { query, .. } => {
            persist_and_close_query(query, &app_state.write_pool, db_session_id).await
        }
        QueryState::Pending(opts) => opts.resume_session_id.clone(),
    };

    // Also clear the init-time resume_session_id in case it wasn't consumed yet
    let cli_sid = cli_sid.or_else(|| handle.resume_session_id.take());

    // Archive and clear in DB (pass cli_sid to avoid re-reading it)
    WsSessionPersistence::archive_and_clear(
        &app_state.write_pool,
        db_session_id,
        cli_sid.as_deref(),
    )
    .await;

    // Reset handle to Pending with fresh options (no resume)
    let fresh_options = RuntimeSpawnConfig {
        cwd: handle.config.cwd.clone(),
        permission_mode: handle.desired_permission_mode.clone(),
        model: handle.desired_model.clone(),
        system_prompt: handle.config.system_prompt.clone(),
        ..RuntimeSpawnConfig::default()
    };
    handle.state = QueryState::Pending(fresh_options);

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "cleared",
        serde_json::json!({
            "session_id": db_session_id.to_string(),
            "previous_session_id": cli_sid,
        }),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.retry_worktree_setup: re-run setup commands for an existing worktree.
pub(super) async fn handle_retry_worktree_setup(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let payload: serde_json::Value = envelope.payload;
    let feature_id = match payload.get("feature_id").and_then(|v| v.as_i64()) {
        Some(fid) => fid,
        None => {
            send_error(
                sender,
                &envelope.id,
                "MISSING_FEATURE_ID",
                "feature_id is required",
            );
            return;
        }
    };

    let wt_path_str =
        match worktree::get_setting(&app_state.read_pool, feature_id, "worktree_path").await {
            Some(p) => p,
            None => {
                send_error(
                    sender,
                    &envelope.id,
                    "NO_WORKTREE",
                    "No worktree found for this feature",
                );
                return;
            }
        };

    // Reset setup step
    let _ = worktree::set_setting(
        &app_state.write_pool,
        feature_id,
        "worktree_setup_step",
        "setup",
    )
    .await;
    let _ =
        worktree::set_setting(&app_state.write_pool, feature_id, "worktree_setup_log", "").await;

    let rp = app_state.read_pool.clone();
    let wp = app_state.write_pool.clone();
    let ws = WorkflowWsSender::new(sender.clone());
    let path = PathBuf::from(wt_path_str);
    tokio::spawn(async move {
        worktree::run_setup_commands(rp, wp, feature_id, path, ws).await;
    });
}
