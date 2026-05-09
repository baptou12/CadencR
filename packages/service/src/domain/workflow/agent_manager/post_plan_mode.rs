use axum::extract::ws::Message;
use tracing::warn;

use crate::domain::agents::adapter::RuntimeSessionHandle;
use crate::domain::agents::permission_modes::{
    parse_permission_mode, post_plan_approval_mode_wire,
};
use crate::domain::workflow::engine::AgentSlot;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::WsEnvelope;

use super::AgentManager;

impl AgentManager {
    pub(super) async fn transition_runtime_query_to_post_plan_mode(
        &self,
        slot: &AgentSlot,
        query: &RuntimeSessionHandle,
    ) -> Result<(), String> {
        let Some(db_session_id) = self.active_items.get(slot).map(|entry| *entry.value()) else {
            warn!(slot = %slot, "post-plan-approval: no active session for workflow slot");
            return Ok(());
        };
        let (provider, model, current_mode) = self.session_runtime_metadata(db_session_id).await;
        let provider = provider
            .ok_or_else(|| format!("No runtime provider stored for session {db_session_id}"))?;
        let target_wire = post_plan_approval_mode_wire(&provider, model.as_deref());
        if current_mode.as_deref() == Some(target_wire) {
            return Ok(());
        }

        let target_mode = parse_permission_mode(target_wire);
        {
            let q = query.lock().await;
            q.set_permission_mode(target_mode)
                .await
                .map_err(|e| format!("Failed to apply post-plan permission mode: {e}"))?;
        }

        WsSessionPersistence::update_permission_mode_static(
            &self.write_pool,
            db_session_id,
            target_wire,
        )
        .await;
        let envelope = WsEnvelope::new(
            "workflow",
            "mode.changed",
            serde_json::json!({
                "feature_id": self.feature_id,
                "agent_slot": slot,
                "session_id": db_session_id,
                "mode": target_wire,
            }),
        );
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::extract::ws::Message;
    use serde_json::Value;
    use sqlx::sqlite::SqlitePoolOptions;
    use tokio::sync::{mpsc, Mutex};

    use super::AgentManager;
    use crate::domain::agents::adapter::{
        AgentRuntimeSession, RuntimeError, RuntimeMessageRx, RuntimePermissionMode,
        RuntimePermissionResponse, RuntimePermissionResponseKind,
    };
    use crate::domain::session_status::SessionStatusBroadcaster;
    use crate::domain::workflow::engine::{AgentSlot, WsSender};
    use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
    use crate::domain::ws_session::protocol::{PermissionDecision, WsEnvelope};

    struct RecordingPlanApprovalSession {
        events: Arc<Mutex<Vec<String>>>,
        message_rx: Option<RuntimeMessageRx>,
    }

    impl RecordingPlanApprovalSession {
        fn new(events: Arc<Mutex<Vec<String>>>) -> Self {
            let (_tx, rx) = mpsc::channel(1);
            Self {
                events,
                message_rx: Some(rx),
            }
        }
    }

    #[async_trait::async_trait]
    impl AgentRuntimeSession for RecordingPlanApprovalSession {
        fn take_message_rx(&mut self) -> RuntimeMessageRx {
            self.message_rx.take().expect("message rx")
        }

        async fn session_id(&self) -> Option<String> {
            Some("codex-session".to_string())
        }

        async fn stream_input(&self, _content: Value) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn interrupt(&self) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn close(&mut self) {}

        async fn set_model(&self, _model: &str) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn set_permission_mode(
            &self,
            mode: RuntimePermissionMode,
        ) -> Result<(), RuntimeError> {
            self.events.lock().await.push(format!("mode:{mode:?}"));
            Ok(())
        }

        async fn respond_permission(
            &self,
            _response: RuntimePermissionResponse,
        ) -> Result<(), RuntimeError> {
            self.events.lock().await.push("respond".to_string());
            Ok(())
        }

        fn permission_response_kind(&self, request_id: &str) -> RuntimePermissionResponseKind {
            if request_id == "plan-approval" {
                RuntimePermissionResponseKind::PlanApproval
            } else {
                RuntimePermissionResponseKind::Normal
            }
        }

        fn pid(&self) -> Option<u32> {
            None
        }
    }

    async fn test_manager() -> (
        AgentManager,
        mpsc::UnboundedReceiver<Message>,
        sqlx::SqlitePool,
    ) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE agent_sessions (\
                id INTEGER PRIMARY KEY, \
                runtime_provider TEXT, \
                model TEXT, \
                permission_mode TEXT, \
                pending_permission TEXT, \
                pending_questions TEXT, \
                pending_plan_approval TEXT, \
                pending_prd_approval TEXT\
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_sessions \
             (id, runtime_provider, model, permission_mode) \
             VALUES (7, 'codex_cli', 'gpt-5.5', 'plan')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let (tx, rx) = mpsc::unbounded_channel();
        let (status_tx, _) = tokio::sync::broadcast::channel(16);
        let broadcaster = SessionStatusBroadcaster::new(
            status_tx,
            Arc::new(std::sync::atomic::AtomicU64::new(0)),
        );
        let manager = AgentManager::new(
            42,
            pool.clone(),
            pool.clone(),
            WsSender::new(tx),
            broadcaster,
        );
        (manager, rx, pool)
    }

    #[tokio::test]
    async fn codex_plan_approval_switches_to_default_before_responding() {
        let (manager, mut receiver, pool) = test_manager().await;
        let events = Arc::new(Mutex::new(Vec::new()));
        let slot = AgentSlot::Session(7);
        let query = Arc::new(Mutex::new(
            Box::new(RecordingPlanApprovalSession::new(Arc::clone(&events)))
                as Box<dyn AgentRuntimeSession>,
        ));
        manager.active_items.insert(slot.clone(), 7);
        manager.queries.insert(slot.clone(), query);

        let handled = manager
            .respond_runtime_permission(
                &slot,
                PermissionResponse {
                    request_id: "plan-approval".to_string(),
                    decision: PermissionDecision::AllowOnce,
                    option_id: None,
                    feedback: None,
                    updated_input: None,
                    is_approval_gate: true,
                },
            )
            .await
            .unwrap();

        assert!(handled);
        assert_eq!(*events.lock().await, vec!["mode:Default", "respond"]);
        let stored: String =
            sqlx::query_scalar("SELECT permission_mode FROM agent_sessions WHERE id = 7")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored, "default");

        let Message::Text(raw) = receiver.recv().await.unwrap() else {
            panic!("expected workflow mode.changed envelope");
        };
        let envelope: WsEnvelope = serde_json::from_str(&raw).unwrap();
        assert_eq!(envelope.domain, "workflow");
        assert_eq!(envelope.action, "mode.changed");
        assert_eq!(envelope.payload["mode"], "default");
        assert_eq!(envelope.payload["session_id"], 7);
    }
}
