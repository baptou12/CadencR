use axum::extract::ws::Message;
use tracing::info;

use crate::app_state::AppState;
use crate::domain::ws_session::protocol::*;
use super::{SdkSessions, WsSender};

/// Handle workflow domain actions.
pub async fn handle_workflow_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    _sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "feature.start" => handle_feature_start(envelope, sender, app_state).await,
        unknown => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "UNKNOWN_ACTION".into(),
                    message: format!("Unknown workflow action: {unknown}"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
    }
}

async fn handle_feature_start(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let payload: WorkflowFeatureStartPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "INVALID_PAYLOAD".into(),
                    message: format!("Invalid feature.start payload: {e}"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
            return;
        }
    };

    let feature_id = payload.feature_id;

    // Verify the feature exists
    let exists = sqlx::query("SELECT 1 FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(&app_state.read_pool)
        .await;

    match exists {
        Ok(Some(_)) => {
            info!(feature_id, "attached workflow to existing ws-feature");
            let resp = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "feature.started",
                serde_json::to_value(WorkflowFeatureStartResponse { feature_id }).unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(resp).into()));
        }
        Ok(None) => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "NOT_FOUND".into(),
                    message: format!("Feature {feature_id} not found"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
        Err(e) => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "LOOKUP_FAILED".into(),
                    message: format!("Failed to look up feature: {e}"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
    }
}
