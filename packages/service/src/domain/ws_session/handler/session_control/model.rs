use tracing::{error, info};

use super::super::super::persistence::WsSessionPersistence;
use super::super::super::protocol::*;
use super::super::helpers::{parse_session_id, send_error};
use super::super::types::{QueryState, SdkSessions, WsSender};
use super::session_has_messages;
use crate::app_state::AppState;
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::agents::{adapter_for_model, runtime_adapter};

fn provider_for_model(current_provider: &str, model: &str) -> String {
    adapter_for_model(model)
        .map(|(provider_id, _)| provider_id)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            if current_provider != DEFAULT_PROVIDER && !model.contains('/') {
                return DEFAULT_PROVIDER.to_string();
            }

            current_provider.to_string()
        })
}

/// Handle session.model.set: change the model and persist to DB.
pub(crate) async fn handle_model_set(
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

    let has_messages = match session_has_messages(&app_state.read_pool, db_session_id).await {
        Ok(value) => value,
        Err(error) => {
            error!(db_session_id, %error, "failed to verify session history before model change");
            send_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                "Failed to verify session history",
            );
            return;
        }
    };

    // The live turn may be owned by another connection (e.g. the host changing
    // the model of a conversation started on a remote device). Operate on the
    // owning map so the change reaches the running CLI, not just our viewer.
    let effective_sessions =
        super::resolve_owner_sessions(sdk_sessions, app_state, db_session_id).await;
    let sdk_sessions = &effective_sessions;

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
    let feature_id = handle.feature_id;

    let target_provider = provider_for_model(&handle.runtime_provider, &payload.model);
    if has_messages && handle.runtime_provider != target_provider {
        send_error(
            sender,
            &envelope.id,
            "PROVIDER_LOCKED",
            "Start a new session to switch providers",
        );
        return;
    }

    info!(db_session_id, model = %payload.model, "updating desired model");
    handle.desired_model = Some(payload.model.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            options.model = Some(payload.model.clone());
            if handle.runtime_provider != target_provider {
                handle.runtime_provider = target_provider.clone();
                handle.resume_session_id = None;
                options.resume_session_id = None;
                let _ = sqlx::query("UPDATE agent_sessions SET runtime_provider = ? WHERE id = ?")
                    .bind(&target_provider)
                    .bind(db_session_id)
                    .execute(&app_state.write_pool)
                    .await;
            }
        }
        QueryState::Active { query, .. } => {
            let q = query.read().await;
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
    // Seed the new model's context window ONLY when the target adapter can
    // answer authoritatively right now (e.g. opencode knows its catalog
    // windows). Never fall back to history — for Claude Code, the CLI is the
    // source of truth and the window arrives on the first `result` event.
    // Token counts are NOT reset: the conversation history has not changed,
    // only the model has. The first `result` from the new model will stamp
    // fresh token totals.
    let target_adapter = adapter_for_model(&payload.model)
        .map(|(_, a)| a)
        .or_else(|| runtime_adapter(&handle.runtime_provider));
    let seeded_window = match target_adapter {
        Some(adapter) => adapter.context_window_for_model(&payload.model).await,
        None => None,
    };
    drop(sessions);
    WsSessionPersistence::update_context_window(
        &app_state.write_pool,
        db_session_id,
        seeded_window,
    )
    .await;

    // Reply to the caller and mirror to other devices so their model chip updates.
    super::reply_and_broadcast(
        app_state,
        sender,
        &envelope.id,
        feature_id,
        "model.set.ok",
        serde_json::json!({
            "model": payload.model,
            "context_window": seeded_window,
        }),
    )
    .await;
}
