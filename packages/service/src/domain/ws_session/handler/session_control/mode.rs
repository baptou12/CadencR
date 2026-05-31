use axum::extract::ws::Message;
use tracing::{error, info};

use super::super::super::persistence::WsSessionPersistence;
use super::super::super::protocol::*;
use super::super::helpers::{
    parse_permission_mode, parse_session_id, provider_supports_mode, send_error,
};
use super::super::types::{QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeError;
use crate::domain::agents::codex::{
    access_mode_wire, parse_access_mode_wire, PROVIDER_ID as CODEX_PROVIDER_ID,
};
use crate::domain::agents::permission_modes::permission_mode_wire;

/// Handle session.mode.set: change the permission mode and persist to DB.
pub(crate) async fn handle_mode_set(
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

    // Reject modes the active provider doesn't support — guards against a
    // stale FE catalog (e.g. user just switched provider but UI hadn't
    // re-rendered) and surfaces the failure to the user via the standard
    // error envelope rather than silently dropping the request.
    if !provider_supports_mode(&handle.runtime_provider, &new_mode) {
        send_error(
            sender,
            &envelope.id,
            "MODE_NOT_SUPPORTED",
            &format!(
                "Provider {} does not support permission mode {}",
                handle.runtime_provider, payload.mode
            ),
        );
        return;
    }

    info!(db_session_id, mode = %payload.mode, "updating permission mode");

    match &mut handle.state {
        QueryState::Pending(options) => {
            // No live CLI yet; the queued mode will be passed via
            // `Options.permission_mode` at spawn time.
            handle.desired_permission_mode = Some(new_mode.clone());
            handle.config.permission_mode = Some(new_mode.clone());
            options.permission_mode = Some(new_mode);
        }
        QueryState::Active { query, .. } => {
            let q = query.read().await;
            if let Err(e) = q.set_permission_mode(new_mode.clone()).await {
                // The CLI rejected (or never acked) the mode change.
                // Per `no-optimistic-updates.md` we leave the FE chip
                // alone, and don't mutate desired/config state until the
                // CLI accepts. Otherwise the next prompt sees desired !=
                // spawned and respawns into the rejected mode invisibly.
                error!(db_session_id, error = %e, "failed to set permission mode on active query");
                // `ControlRequestRejected` for `set_permission_mode` is
                // the recoverable case (CLI alive, refused this mode for
                // this model — e.g. Claude Code `auto` on a non-auto
                // model). Tag it with the rejected wire mode so the FE
                // can skip past it in the Shift+Tab cycle rather than
                // locking the chip.
                let payload = match &e {
                    RuntimeError::ControlRequestRejected { subtype, .. }
                        if subtype == "set_permission_mode" =>
                    {
                        SessionErrorPayload {
                            code: "MODE_REJECTED_BY_CLI".into(),
                            message: e.to_string(),
                            mode: Some(permission_mode_wire(&new_mode)),
                        }
                    }
                    _ => SessionErrorPayload {
                        code: "SDK_ERROR".into(),
                        message: e.to_string(),
                        ..Default::default()
                    },
                };
                let err = WsEnvelope::reply(
                    &envelope.id,
                    "session",
                    "error",
                    serde_json::to_value(payload).unwrap(),
                );
                let _ = sender.send(Message::Text(String::from(err).into()));
                return;
            }
            handle.desired_permission_mode = Some(new_mode.clone());
            handle.config.permission_mode = Some(new_mode.clone());
            // Track what the CLI actually accepted. Without this,
            // `plan_post_plan_mode_transition`'s "already in target mode"
            // short-circuit (post_plan_mode.rs) reads stale state and
            // may skip the post-plan-approval transition.
            handle.spawned_permission_mode = Some(new_mode);
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

/// Handle session.codex_permission_mode.set: change Codex access mode for this conversation.
pub(crate) async fn handle_codex_permission_mode_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: CodexPermissionModeSetPayload =
        match serde_json::from_value(envelope.payload.clone()) {
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

    {
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

        if handle.runtime_provider != CODEX_PROVIDER_ID {
            send_error(
                sender,
                &envelope.id,
                "MODE_NOT_SUPPORTED",
                "Codex access mode can only be changed on Codex sessions",
            );
            return;
        }
    }

    let Some(access_mode) = parse_access_mode_wire(&payload.mode) else {
        send_error(
            sender,
            &envelope.id,
            "INVALID_PAYLOAD",
            "Invalid Codex access mode",
        );
        return;
    };
    let mode_wire = access_mode_wire(&access_mode);
    if let Err(error) = WsSessionPersistence::update_codex_permission_mode_static(
        &app_state.write_pool,
        db_session_id,
        mode_wire,
    )
    .await
    {
        error!(
            db_session_id,
            %error,
            "failed to persist Codex permission mode"
        );
        send_error(
            sender,
            &envelope.id,
            "DB_ERROR",
            "Failed to persist Codex permission mode",
        );
        return;
    }

    {
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
        handle.desired_access_mode = Some(access_mode.clone());
        handle.config.access_mode = Some(access_mode.clone());
        match &mut handle.state {
            QueryState::Pending(options) => {
                options.access_mode = Some(access_mode);
            }
            QueryState::Active { .. } => {}
        }
    }

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "codex_permission_mode.changed",
        serde_json::json!({ "mode": mode_wire }),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}
