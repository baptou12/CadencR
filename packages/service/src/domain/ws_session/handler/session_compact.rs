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
        "compact.started",
        serde_json::Value::Null,
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use tokio::sync::Mutex;

    use super::compaction_strategy;
    use crate::domain::agents::adapter::{RuntimeCompactionStrategy, RuntimeSpawnConfig};
    use crate::domain::ws_session::handler::{QueryState, SdkHandle, SdkSessions, SessionConfig};

    fn handle_for_provider(provider: &str) -> SdkHandle {
        SdkHandle {
            state: QueryState::Pending(RuntimeSpawnConfig::default()),
            feature_id: 1,
            runtime_provider: provider.to_string(),
            desired_model: None,
            spawned_model: None,
            desired_permission_mode: None,
            spawned_permission_mode: None,
            desired_thinking_effort: None,
            spawned_thinking_effort: None,
            runtime_control_endpoint: None,
            manual_compact_running: Arc::new(AtomicBool::new(false)),
            resume_session_id: None,
            config: SessionConfig {
                cwd: PathBuf::new(),
                canonical_cwd: PathBuf::new(),
                permission_mode: None,
                thinking_effort: None,
                system_prompt: None,
                env: None,
            },
            manual_compact_cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    #[tokio::test]
    async fn compaction_strategy_dispatches_by_adapter() {
        let sessions: SdkSessions = Arc::new(Mutex::new(HashMap::from([
            (
                1,
                handle_for_provider(crate::domain::agents::codex::PROVIDER_ID),
            ),
            (
                2,
                handle_for_provider(crate::domain::agents::opencode::PROVIDER_ID),
            ),
        ])));

        assert_eq!(
            compaction_strategy(&sessions, 1).await.unwrap(),
            RuntimeCompactionStrategy::LiveRuntime
        );
        assert_eq!(
            compaction_strategy(&sessions, 2).await.unwrap(),
            RuntimeCompactionStrategy::SummaryReplay
        );
    }
}
