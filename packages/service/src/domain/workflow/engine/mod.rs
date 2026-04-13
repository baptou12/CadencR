//! Workflow engine: thin orchestrator that delegates to focused collaborators.
//!
//! - `AgentManager`: agent lifecycle (spawn, interrupt, resume, stream reading)
//! - `QueueAdvancer`: queue state management (advance, complete, error, skip, retry)
//! - `PermissionRouter`: permission channel management and approval gate bridge

pub use super::agent_slot::*;
pub use super::ws_sender::*;

use std::sync::atomic::{AtomicU64, Ordering};

use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{info, warn};

use axum::extract::ws::Message;

use crate::domain::features::models::WorkflowType;
use crate::domain::features::repository as repo;
use crate::domain::workflow::agent_manager::AgentManager;
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::queue_advancer::{QueueAdvancer, StatusSetter};
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::protocol::*;

/// Helper to serialize a typed payload to serde_json::Value.
pub fn to_value<T: serde::Serialize>(v: T) -> serde_json::Value {
    serde_json::to_value(v).unwrap()
}

/// Thin orchestrator that composes AgentManager, QueueAdvancer, and PermissionRouter.
pub struct WorkflowEngine {
    pub feature_id: i64,
    pub workflow_type: WorkflowType,
    pub agent_manager: AgentManager,
    pub queue: QueueAdvancer,
    pub permissions: PermissionRouter,
    /// Unix timestamp (seconds) of last activity — updated on advance/completion/error.
    pub last_activity: AtomicU64,
    // DB pools kept for orchestration-level queries (status)
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
}

impl WorkflowEngine {
    pub async fn new(
        feature_id: i64,
        workflow_type: WorkflowType,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        raw_sender: mpsc::UnboundedSender<Message>,
        max_parallel: usize,
        turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    ) -> Result<Self, String> {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let ws_sender = WsSender::new(raw_sender);
        let agent_manager = AgentManager::new(
            feature_id,
            read_pool.clone(),
            write_pool.clone(),
            ws_sender.clone(),
            turn_state_tx,
        );
        let queue = QueueAdvancer::new(
            feature_id,
            workflow_type.clone(),
            max_parallel,
            read_pool.clone(),
            write_pool.clone(),
            ws_sender.clone(),
            agent_manager.turn_state_tx.clone(),
        )
        .await?;
        let permissions = PermissionRouter::new();

        Ok(Self {
            feature_id,
            workflow_type,
            agent_manager,
            queue,
            permissions,
            last_activity: AtomicU64::new(now_secs),
            read_pool,
            write_pool,
            ws_sender,
        })
    }

    /// Reattach a new raw WS sender to this engine (on reconnect).
    /// All components share the same WsSender Arc, so this updates them all.
    pub fn reattach_sender(&self, raw_sender: mpsc::UnboundedSender<Message>) {
        self.ws_sender.reattach(raw_sender);
        self.touch_activity();
    }

    /// Detach the WS sender (on disconnect). Messages will be silently dropped.
    pub fn detach_sender(&self) {
        self.ws_sender.detach();
    }

    /// Whether a WS client is currently connected.
    pub fn has_sender(&self) -> bool {
        self.ws_sender.is_attached()
    }

    /// Pause all running agents for graceful shutdown.
    pub async fn pause_all(&self) {
        self.agent_manager.pause_all().await;
    }

    /// Replay current engine state to a reconnected client: queue state,
    /// workflow status, and agent statuses (running/paused).
    pub async fn replay_state_to_client(&self) -> Result<(), String> {
        info!(
            feature_id = self.feature_id,
            "replaying engine state to reconnected client"
        );

        // 1. Send full queue update
        let all_items = repo::get_queue_for_feature(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;
        let workflow_status = repo::get_workflow_status(&self.read_pool, self.feature_id)
            .await
            .unwrap_or(WorkflowStatus::Idle)
            .to_string();
        let queue_env = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id: self.feature_id,
                items: all_items,
                workflow_status: Some(workflow_status),
            }),
        );
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(queue_env).into()));

        // 2. Report active (running) agents
        for entry in self.agent_manager.active_items.iter() {
            let slot = entry.key().clone();
            let db_session_id = *entry.value();
            let is_running = self.agent_manager.queries.contains_key(&slot);
            let is_paused = self.agent_manager.paused_sessions.contains_key(&slot);

            if is_running {
                let agent_type = slot.agent_type_str().unwrap_or("execute").to_string();
                let envelope = WsEnvelope::new(
                    "workflow",
                    "agent_running",
                    to_value(WorkflowAgentStartedPayload {
                        feature_id: self.feature_id,
                        agent_slot: slot.clone(),
                        session_id: db_session_id,
                        agent_type,
                    }),
                );
                let _ = self
                    .ws_sender
                    .send(Message::Text(String::from(envelope).into()));
            } else if is_paused {
                if let Some(rt_sid) = self.agent_manager.paused_sessions.get(&slot) {
                    let agent_type = slot.agent_type_str().unwrap_or("execute").to_string();
                    let envelope = WsEnvelope::new(
                        "workflow",
                        "agent_paused",
                        to_value(WorkflowAgentPausedPayload {
                            feature_id: self.feature_id,
                            agent_slot: slot.clone(),
                            session_id: db_session_id,
                            agent_type,
                            runtime_session_id: rt_sid.clone(),
                        }),
                    );
                    let _ = self
                        .ws_sender
                        .send(Message::Text(String::from(envelope).into()));
                }
            }

            // Replay pending permission.request for any active agent with pending questions
            if let Ok(Some(pq_json)) = sqlx::query_scalar::<_, String>(
                "SELECT pending_questions FROM agent_sessions WHERE id = ? AND pending_questions IS NOT NULL"
            )
            .bind(db_session_id)
            .fetch_optional(&self.read_pool)
            .await
            {
                if let Ok(pq) = serde_json::from_str::<serde_json::Value>(&pq_json) {
                    let perm_env = WsEnvelope::new(
                        "workflow",
                        "permission.request",
                        to_value(WorkflowPermissionRequestPayload {
                            feature_id: self.feature_id,
                            agent_slot: slot,
                            request_id: pq["request_id"].as_str().unwrap_or("").to_string(),
                            tool_name: pq["tool_name"].as_str().unwrap_or("AskUserQuestion").to_string(),
                            tool_input: pq["tool_input"].clone(),
                            description: None,
                            pattern: pq["pattern"].as_str().map(|s| s.to_string()),
                        }),
                    );
                    let _ = self.ws_sender.send(Message::Text(String::from(perm_env).into()));
                }
            }
        }

        // 3. Auto-resume agents that were paused by WS disconnect.
        // They have entries in paused_sessions + active_items but no running Query.
        let auto_resume_slots: Vec<(AgentSlot, String)> = self
            .agent_manager
            .paused_sessions
            .iter()
            .filter(|entry| {
                let slot = entry.key();
                !self.agent_manager.queries.contains_key(slot)
                    && self.agent_manager.active_items.contains_key(slot)
            })
            .map(|entry| (entry.key().clone(), entry.value().clone()))
            .collect();

        for (slot, _rt_sid) in auto_resume_slots {
            info!(feature_id = self.feature_id, slot = %slot, "auto-resuming agent after WS reconnect");
            if let Err(e) = self.send_prompt(slot.clone(), "", None).await {
                warn!(feature_id = self.feature_id, slot = %slot, error = %e, "failed to auto-resume agent");
            }
        }

        Ok(())
    }

    // ── Backward-compatible accessors for workflow handler ──

    /// Access to active_items (for handler/eviction checks).
    pub fn active_items(&self) -> &dashmap::DashMap<AgentSlot, i64> {
        &self.agent_manager.active_items
    }

    /// Access to autonomy_level (for set_autonomy handler).
    pub fn autonomy_level(&self) -> &std::sync::atomic::AtomicU8 {
        &self.queue.autonomy_level
    }

    // ── Status management ──

    /// Transition the workflow to a new status, persisting to DB and notifying the frontend.
    pub async fn set_status(&self, new_status: WorkflowStatus) {
        let current = repo::get_workflow_status(&self.read_pool, self.feature_id)
            .await
            .unwrap_or(WorkflowStatus::Idle);

        if current == new_status {
            return;
        }

        match repo::set_workflow_status(&self.write_pool, self.feature_id, new_status).await {
            Ok(_) => {
                info!(feature_id = self.feature_id, from = %current, to = %new_status, "workflow status changed");
            }
            Err(e) => {
                tracing::warn!(feature_id = self.feature_id, from = %current, to = %new_status, error = %e, "invalid transition, force-setting");
                let _ = repo::force_workflow_status(&self.write_pool, self.feature_id, new_status)
                    .await;
            }
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "status_changed",
            to_value(WorkflowStatusChangedPayload {
                feature_id: self.feature_id,
                status: new_status.to_string(),
                previous_status: current.to_string(),
            }),
        );
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));
    }

    // ── Queue operations (delegates to QueueAdvancer) ──

    /// Update the last_activity timestamp to now.
    fn touch_activity(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_activity.store(now, Ordering::Relaxed);
    }

    pub fn set_max_parallel(&self, val: usize) {
        self.queue.set_max_parallel(val);
    }

    pub async fn advance(&self) -> Result<(), String> {
        self.touch_activity();
        self.queue
            .advance(&self.agent_manager, &self.permissions)
            .await
    }

    pub async fn on_item_completed(&self, slot: AgentSlot, result: Option<&str>) {
        self.touch_activity();
        self.queue
            .on_item_completed(slot, result, &self.agent_manager, &self.permissions, self)
            .await;
    }

    pub async fn on_item_paused(&self, slot: AgentSlot) {
        self.touch_activity();
        self.queue.on_item_paused(slot, &self.agent_manager).await;
    }

    pub async fn on_item_error(&self, slot: AgentSlot, error: &str) {
        self.touch_activity();
        self.queue
            .on_item_error(slot, error, &self.agent_manager, &self.permissions, self)
            .await;
    }

    pub async fn skip_item(&self, item_id: i64) -> Result<(), String> {
        self.queue
            .skip_item(item_id, &self.agent_manager, &self.permissions)
            .await
    }

    pub async fn retry_item(&self, item_id: i64) -> Result<(), String> {
        self.queue
            .retry_item(item_id, &self.agent_manager, &self.permissions)
            .await
    }

    // ── Permission routing (delegates to PermissionRouter) ──

    pub async fn respond_permission(
        &self,
        slot: AgentSlot,
        response: PermissionResponse,
    ) -> Result<(), String> {
        if self
            .agent_manager
            .respond_runtime_permission(&slot, response.clone())
            .await?
        {
            return Ok(());
        }
        self.permissions.respond(slot, response).await
    }

    // ── Agent operations (delegates to AgentManager) ──

    pub async fn interrupt_item(&self, slot: AgentSlot) -> Result<(), String> {
        self.agent_manager.interrupt_item(slot).await
    }

    pub async fn send_prompt(
        &self,
        slot: AgentSlot,
        text: &str,
        images: Option<Vec<ImagePayload>>,
    ) -> Result<(), String> {
        self.agent_manager
            .send_prompt(slot, text, images, &self.permissions)
            .await
    }

    pub async fn mark_done(&self, slot: AgentSlot) -> Result<(), String> {
        self.permissions.cleanup(&slot);
        self.agent_manager.mark_done(slot).await
    }

    // ── Restore + lifecycle ──

    pub async fn restore_on_reconnect(&self) -> Result<(), String> {
        self.queue.restore_on_reconnect(&self.agent_manager).await
    }
}

#[async_trait::async_trait]
impl StatusSetter for WorkflowEngine {
    async fn set_status(&self, status: WorkflowStatus) {
        self.set_status(status).await;
    }
}

#[cfg(test)]
mod tests;
