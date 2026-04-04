//! Gate handling logic for custom workflow phases.
//!
//! Extracted from queue_advancer.rs to keep files under 400 lines.

use std::sync::atomic::Ordering;

use axum::extract::ws::Message;
use tracing::error;

use crate::domain::features::repository as repo;
use crate::domain::ws_workflow::artifact_repository;
use crate::domain::workflow::agent_manager::AgentManager;
use crate::domain::workflow::engine::AgentSlot;
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::queue_advancer::{QueueAdvancer, StatusSetter};
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::protocol::*;

use super::engine::to_value;

impl QueueAdvancer {
    /// Extract gate_type from a queue item's config JSON.
    pub(crate) async fn extract_gate_type(&self, slot: &AgentSlot) -> Option<String> {
        let item_id = match slot {
            AgentSlot::QueueItem(id) => *id,
            _ => return None,
        };
        let item = repo::get_queue_item(&self.read_pool, item_id).await.ok()??;
        let config_str = item.config.as_deref()?;
        let config: serde_json::Value = serde_json::from_str(config_str).ok()?;
        config.get("gate_type").and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    /// Handle approval gate: mark pending_approval, emit WS event.
    pub(crate) async fn handle_approval_gate(&self, slot: &AgentSlot, agent_manager: &AgentManager) {
        let item_id = match slot {
            AgentSlot::QueueItem(id) => *id,
            _ => return,
        };
        if let Err(e) = repo::mark_item_pending_approval(&self.write_pool, item_id).await {
            error!(item_id, error = %e, "failed to mark item pending_approval");
            return;
        }
        agent_manager.send_item_update(item_id).await;

        let (phase_slug, artifact_content) = self.get_phase_artifact_info(item_id).await;
        let envelope = WsEnvelope::new(
            "workflow",
            "approval_requested",
            to_value(WorkflowApprovalRequestedPayload {
                feature_id: self.feature_id,
                phase_slug,
                artifact_content,
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
    }

    /// Handle manual gate: unblock dependents but don't auto-start next items.
    pub(crate) async fn handle_manual_gate(&self, agent_manager: &AgentManager) {
        if let Err(e) = repo::unblock_ready_items(&self.write_pool, self.feature_id).await {
            error!(error = %e, "unblock_ready_items failed for manual gate");
        }
        if let Ok(all_items) = repo::get_queue_for_feature(&self.read_pool, self.feature_id).await {
            let envelope = WsEnvelope::new(
                "workflow",
                "queue_update",
                to_value(WorkflowQueueUpdatePayload {
                    feature_id: self.feature_id,
                    items: all_items,
                    workflow_status: None,
                }),
            );
            let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
        }
        if agent_manager.active_items.is_empty() {
            crate::domain::ws_session::persistence::WsSessionPersistence::broadcast_turn_state(
                &self.turn_state_tx, self.feature_id, "none",
            );
        }
    }

    /// Handle auto gate: existing autonomy-based advancement logic.
    pub(crate) async fn handle_auto_gate(
        &self,
        slot: &AgentSlot,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
        set_status: &dyn StatusSetter,
    ) {
        // Emit phase_completed for custom workflow items
        if let AgentSlot::QueueItem(item_id) = slot {
            let (phase_slug, artifact_preview) = self.get_phase_artifact_info(*item_id).await;
            if !phase_slug.is_empty() {
                let envelope = WsEnvelope::new(
                    "workflow",
                    "phase_completed",
                    to_value(WorkflowPhaseCompletedPayload {
                        feature_id: self.feature_id,
                        phase_slug,
                        artifact_preview,
                    }),
                );
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
            }
        }

        match self.autonomy_level.load(Ordering::Relaxed) {
            3 => {
                if let Err(e) = self.advance(agent_manager, permissions).await {
                    error!(error = %e, "advance after completion failed");
                }
            }
            2 => {
                if let Ok(ready) = repo::unblock_ready_items(&self.write_pool, self.feature_id).await {
                    if !ready.is_empty() {
                        let current_group = if let AgentSlot::QueueItem(id) = slot {
                            self.get_current_group_index(*id).await
                        } else {
                            None
                        };
                        let same_group = ready.iter().all(|r| r.group_index == current_group);
                        if same_group {
                            let capacity = self.max_parallel.load(Ordering::Relaxed)
                                - agent_manager.active_items.len();
                            let autonomy = self.autonomy_level.load(Ordering::Relaxed);
                            for item in ready.into_iter().take(capacity) {
                                if let Err(e) = agent_manager
                                    .start_item(item, self.strategy.as_ref(), autonomy, permissions)
                                    .await
                                {
                                    error!(error = %e, "failed to start queue item");
                                }
                            }
                        } else {
                            set_status.set_status(WorkflowStatus::Paused).await;
                            let envelope = WsEnvelope::new(
                                "workflow",
                                "paused",
                                to_value(WorkflowPausedPayload {
                                    feature_id: self.feature_id,
                                    reason: "group_boundary".into(),
                                }),
                            );
                            let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
                        }
                    }
                }
            }
            _ => {
                set_status.set_status(WorkflowStatus::Paused).await;
                let envelope = WsEnvelope::new(
                    "workflow",
                    "paused",
                    to_value(WorkflowPausedPayload {
                        feature_id: self.feature_id,
                        reason: "autonomy_pause".into(),
                    }),
                );
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
            }
        }
    }

    /// Get the phase slug and artifact content for a queue item.
    pub(crate) async fn get_phase_artifact_info(&self, item_id: i64) -> (String, Option<String>) {
        let item = match repo::get_queue_item(&self.read_pool, item_id).await {
            Ok(Some(item)) => item,
            _ => return (String::new(), None),
        };
        let phase_slug = item.item_type.clone();
        let content = artifact_repository::get_artifact(&self.read_pool, self.feature_id, &phase_slug)
            .await
            .ok()
            .flatten()
            .map(|a| a.content);
        (phase_slug, content)
    }

    /// Approve or reject a phase that's pending approval.
    #[allow(dead_code)]
    pub async fn approve_phase(
        &self,
        phase_slug: &str,
        approved: bool,
        feedback: Option<&str>,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
        set_status: &dyn StatusSetter,
    ) -> Result<(), String> {
        let item = repo::get_queue_item_by_slug(
            &self.read_pool,
            self.feature_id,
            phase_slug,
            "pending_approval",
        )
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No pending_approval item found for phase '{phase_slug}'"))?;

        if approved {
            repo::mark_item_completed(&self.write_pool, item.id, None)
                .await
                .map_err(|e| e.to_string())?;
            agent_manager.send_item_update(item.id).await;

            repo::unblock_ready_items(&self.write_pool, self.feature_id)
                .await
                .map_err(|e| e.to_string())?;
            self.advance(agent_manager, permissions).await?;
            self.check_workflow_completion(agent_manager, set_status).await;
        } else {
            if let Some(fb) = feedback {
                let mut config: serde_json::Value = item
                    .config
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_else(|| serde_json::json!({}));
                config["rejection_feedback"] = serde_json::Value::String(fb.to_string());
                repo::update_item_config(&self.write_pool, item.id, &config.to_string())
                    .await
                    .map_err(|e| e.to_string())?;
            }
            repo::mark_item_ready(&self.write_pool, item.id)
                .await
                .map_err(|e| e.to_string())?;
            agent_manager.send_item_update(item.id).await;
        }

        Ok(())
    }

    /// Trigger a manual phase that's in "ready" state.
    #[allow(dead_code)]
    pub async fn trigger_manual_phase(
        &self,
        phase_slug: &str,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        let item = repo::get_queue_item_by_slug(
            &self.read_pool,
            self.feature_id,
            phase_slug,
            "ready",
        )
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No ready item found for phase '{phase_slug}'"))?;

        let autonomy = self.autonomy_level.load(Ordering::Relaxed);
        agent_manager
            .start_item(item, self.strategy.as_ref(), autonomy, permissions)
            .await
    }

    /// Check if all queue items are completed/skipped and no active items remain.
    pub(crate) async fn check_workflow_completion(
        &self,
        agent_manager: &AgentManager,
        set_status: &dyn StatusSetter,
    ) {
        if !agent_manager.active_items.is_empty() {
            return;
        }
        if let Ok(items) = repo::get_queue_for_feature(&self.read_pool, self.feature_id).await {
            if !items.is_empty()
                && items.iter().all(|i| matches!(i.status.as_str(), "completed" | "skipped"))
            {
                set_status.set_status(WorkflowStatus::Completed).await;
            }
        }
    }
}
