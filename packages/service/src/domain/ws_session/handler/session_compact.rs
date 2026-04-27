use axum::extract::ws::Message;

use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::session_compact_opencode::handle_opencode_compact;
use super::{parse_session_id, send_error, QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeCompactionStrategy;
use crate::domain::agents::runtime_adapter;

pub(super) async fn handle_compact(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload = match compact_payload(&envelope, sender) {
        Some(payload) => payload,
        None => return,
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

    let session_row =
        WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await;
    match compaction_strategy(sdk_sessions, db_session_id).await {
        Ok(RuntimeCompactionStrategy::LiveRuntime) => {
            handle_active_runtime_compact(&envelope.id, sender, sdk_sessions, db_session_id).await;
        }
        Ok(RuntimeCompactionStrategy::SummaryReplay) => {
            handle_opencode_compact(
                &envelope.id,
                sender,
                sdk_sessions,
                app_state,
                db_session_id,
                session_row.as_ref(),
            )
            .await;
        }
        Err(message) => send_error(sender, &envelope.id, "INVALID_STATE", &message),
    }
}

fn compact_payload(envelope: &WsEnvelope, sender: &WsSender) -> Option<SessionActionPayload> {
    match serde_json::from_value(envelope.payload.clone()) {
        Ok(payload) => Some(payload),
        Err(error) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &error.to_string());
            None
        }
    }
}

async fn compaction_strategy(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
) -> Result<RuntimeCompactionStrategy, String> {
    let sessions = sdk_sessions.lock().await;
    let Some(handle) = sessions.get(&db_session_id) else {
        return Err("Session not found".to_string());
    };
    runtime_adapter(&handle.runtime_provider)
        .and_then(|adapter| adapter.compaction_strategy())
        .ok_or_else(|| "/compact is not supported for this provider".to_string())
}

async fn handle_active_runtime_compact(
    envelope_id: &str,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
) {
    let query = {
        let sessions = sdk_sessions.lock().await;
        let Some(handle) = sessions.get(&db_session_id) else {
            send_error(
                sender,
                envelope_id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        };
        let QueryState::Active { query, .. } = &handle.state else {
            send_error(
                sender,
                envelope_id,
                "INVALID_STATE",
                "Start the session before using /compact",
            );
            return;
        };
        query.clone()
    };

    if let Err(error) = query.lock().await.compact().await {
        send_error(sender, envelope_id, "SDK_ERROR", &error.to_string());
        return;
    }

    let reply = WsEnvelope::reply(
        envelope_id,
        "session",
        "compact.ok",
        serde_json::Value::Null,
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}
