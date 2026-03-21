use axum::extract::ws::Message;
use tracing::{error, info};

use claude_agent_sdk_rs::Options;

use crate::app_state::AppState;
use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::{
    parse_permission_mode, parse_session_id, persist_and_close_query, send_error,
    QueryState, SdkSessions, WsSender,
};
use super::session_prompt::PermissionResponse;

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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    let permission_tx = match &handle.state {
        QueryState::Active { permission_tx, .. } => permission_tx,
        QueryState::Pending(_) => {
            send_error(sender, &envelope.id, "INVALID_STATE", "Session not yet active");
            return;
        }
    };

    // Persist user answer for AskUserQuestion so it survives app restart.
    if let Some(ref updated_input) = payload.updated_input {
        if let Some(answers) = updated_input.get("answers") {
            if let Some(answer_text) = answers.get("0").and_then(|v| v.as_str()) {
                let feature_id = handle.feature_id;
                let p = WsSessionPersistence::with_session_id(
                    app_state.write_pool.clone(), feature_id, Some(db_session_id),
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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
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
    WsSessionPersistence::update_model_static(&app_state.write_pool, db_session_id, &payload.model).await;

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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let new_mode = parse_permission_mode(&payload.mode);

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
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
    WsSessionPersistence::update_permission_mode_static(&app_state.write_pool, db_session_id, &payload.mode).await;

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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.remove(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    // Close active subprocess if running
    if let QueryState::Active { query, .. } = handle.state {
        persist_and_close_query(&query, &app_state.write_pool, db_session_id).await;
    }

    WsSessionPersistence::mark_completed_static(&app_state.write_pool, db_session_id).await;

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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    // Remove from in-memory map if present (shouldn't be active, but clean up)
    sdk_sessions.lock().await.remove(&db_session_id);

    match WsSessionPersistence::delete_session_static(&app_state.write_pool, db_session_id).await {
        Ok(feature_id) => {
            WsSessionPersistence::broadcast_turn_state(&app_state.turn_state_tx, feature_id, "none");

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
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    // Close active subprocess if any, capturing claude_session_id for archive
    let cli_sid = if let QueryState::Active { query, .. } = &handle.state {
        persist_and_close_query(query, &app_state.write_pool, db_session_id).await
    } else {
        None
    };

    // Archive and clear in DB (pass cli_sid to avoid re-reading it)
    WsSessionPersistence::archive_and_clear(&app_state.write_pool, db_session_id, cli_sid.as_deref()).await;

    // Reset handle to Pending with fresh options (no resume)
    let fresh_options = Options {
        cwd: handle.config.cwd.clone(),
        permission_mode: handle.desired_permission_mode.clone(),
        model: handle.desired_model.clone(),
        system_prompt: handle.config.system_prompt.clone(),
        ..Options::default()
    };
    handle.state = QueryState::Pending(fresh_options);

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "cleared",
        serde_json::json!({ "session_id": db_session_id.to_string() }),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}
