use axum::extract::ws::Message;
use tracing::{error, info};

use super::super::super::persistence::WsSessionPersistence;
use super::super::super::protocol::*;
use super::super::helpers::{parse_session_id, send_error};
use super::super::types::{QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSessionHandle;

/// Handle session.effort.set: change the thinking effort for subsequent turns.
pub(crate) async fn handle_effort_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: EffortSetPayload = match serde_json::from_value(envelope.payload.clone()) {
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

    // Snapshot the (provider, model) at the moment of the change so the per-
    // model workspace default is keyed against the model that's actually in
    // use right now. If the user later switches models, that's a separate
    // event and should not back-propagate to the previous model's default.
    let (active_query, runtime_provider, current_model): (
        Option<RuntimeSessionHandle>,
        String,
        Option<String>,
    ) = {
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

        info!(
            db_session_id,
            thinking_effort = ?payload.thinking_effort,
            "updating desired thinking effort"
        );
        handle.desired_thinking_effort = payload.thinking_effort.clone();
        handle.config.thinking_effort = payload.thinking_effort.clone();

        let provider = handle.runtime_provider.clone();
        let model = handle
            .desired_model
            .clone()
            .or_else(|| handle.spawned_model.clone());

        let active = match &mut handle.state {
            QueryState::Pending(options) => {
                options.thinking_effort = payload.thinking_effort.clone();
                None
            }
            QueryState::Active { query, .. } => Some(query.clone()),
        };
        (active, provider, model)
    };

    if let Some(query) = active_query {
        let q = query.read().await;
        let applies_in_place = q.applies_thinking_effort_in_place();
        if let Err(error) = q.set_thinking_effort(payload.thinking_effort.clone()).await {
            error!(db_session_id, %error, "failed to set thinking effort on active query");
            send_error(sender, &envelope.id, "SDK_ERROR", &error.to_string());
            return;
        }

        if applies_in_place {
            let mut sessions = sdk_sessions.lock().await;
            if let Some(handle) = sessions.get_mut(&db_session_id) {
                handle.spawned_thinking_effort = payload.thinking_effort.clone();
            }
        }
    }

    // Persist the conversation-level override (column on agent_sessions). A
    // None payload clears the override; the next session.init will fall back
    // to the per-model workspace default.
    WsSessionPersistence::update_thinking_effort_static(
        &app_state.write_pool,
        db_session_id,
        payload.thinking_effort.as_deref(),
    )
    .await;

    // Update the per-model workspace default so newly opened conversations on
    // the same model start at the level the user just chose. Resets (None)
    // intentionally do not erase the default — clearing for one conversation
    // shouldn't surprise the next new one.
    if let (Some(ref effort), Some(ref model_id)) = (&payload.thinking_effort, &current_model) {
        let key = crate::domain::settings::thinking_effort_model_key(&runtime_provider, model_id);
        if let Err(error) =
            crate::domain::workspace::repository::set_setting(&app_state.write_pool, &key, effort)
                .await
        {
            error!(
                db_session_id,
                %error,
                key = %key,
                "failed to persist per-model thinking effort default"
            );
        }
    }

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "effort.set.ok",
        serde_json::to_value(serde_json::json!({
            "thinking_effort": payload.thinking_effort,
        }))
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}
