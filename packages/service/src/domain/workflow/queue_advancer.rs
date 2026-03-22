//! Queue state management for workflow execution.
//!
//! Handles advancing the queue, completing/erroring/skipping/retrying items,
//! re-populating on review completion, and restoring stale items on reconnect.

use std::sync::atomic::{AtomicU8, Ordering};

use sqlx::SqlitePool;
use tracing::{error, info, warn};

use axum::extract::ws::Message;

use crate::domain::features::models::WorkflowType;
use crate::domain::features::repository as repo;
use crate::domain::workflow::agent_manager::AgentManager;
use crate::domain::workflow::engine::{agent_type_str_to_slot, AgentSlot, WsSender};
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::workflow::strategies::{self, WorkflowStrategy};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use super::engine::to_value;

/// Manages queue advancement and item lifecycle transitions.
pub struct QueueAdvancer {
    pub feature_id: i64,
    pub workflow_type: WorkflowType,
    pub strategy: Box<dyn WorkflowStrategy>,
    pub max_parallel: usize,
    pub autonomy_level: AtomicU8,
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
}

impl QueueAdvancer {
    pub fn new(
        feature_id: i64,
        workflow_type: WorkflowType,
        max_parallel: usize,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        ws_sender: WsSender,
    ) -> Self {
        let strategy = strategies::get_strategy(&workflow_type)
            .expect("QueueAdvancer::new called with unsupported workflow type");
        Self {
            feature_id,
            workflow_type,
            strategy,
            max_parallel,
            autonomy_level: AtomicU8::new(1),
            read_pool,
            write_pool,
            ws_sender,
        }
    }

    /// Advance the workflow: unblock ready items and start them up to capacity.
    pub async fn advance(
        &self,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        let running = agent_manager.active_items.len();

        if running >= self.max_parallel {
            info!(
                feature_id = self.feature_id,
                running,
                max = self.max_parallel,
                "at capacity, not starting new items"
            );
            return Ok(());
        }

        // Unblock items whose dependencies are all completed
        repo::unblock_ready_items(&self.write_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        let ready = repo::get_ready_items(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        let capacity = self.max_parallel - running;
        let autonomy = self.autonomy_level.load(Ordering::Relaxed);
        for item in ready.into_iter().take(capacity) {
            if let Err(e) = agent_manager.start_item(item, self.strategy.as_ref(), autonomy, permissions).await {
                error!(feature_id = self.feature_id, error = %e, "failed to start queue item");
            }
        }

        Ok(())
    }

    /// Called when a queue item completes successfully.
    pub async fn on_item_completed(
        &self,
        slot: AgentSlot,
        result: Option<&str>,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
        set_status: &dyn StatusSetter,
    ) {
        // If this item was interrupted, treat as paused
        if agent_manager.interrupted_items.remove(&slot).is_some() {
            self.on_item_paused(slot, agent_manager).await;
            return;
        }

        info!(feature_id = self.feature_id, slot = %slot, "queue item completed");

        agent_manager.cleanup_agent(&slot);
        permissions.cleanup(&slot);

        let legacy_id = slot.as_legacy_id();
        if let Err(e) = repo::mark_item_completed(&self.write_pool, legacy_id, result).await {
            error!(slot = %slot, error = %e, "failed to mark item completed");
        }

        if let AgentSlot::QueueItem(item_id) = &slot {
            agent_manager.send_item_update(*item_id).await;
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "item_completed",
            to_value(WorkflowItemCompletedPayload {
                feature_id: self.feature_id,
                agent_slot: slot.clone(),
                result: result.map(|s| s.to_string()),
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        // Notify frontend when pre-queue agents complete
        if matches!(slot, AgentSlot::Plan) {
            agent_manager.send_feature_updated(&["plan", "phases", "progress"]);
        } else if matches!(slot, AgentSlot::Prd) {
            agent_manager.send_feature_updated(&["prd"]);
        }

        // If a "review" item just completed, check for new phases and re-populate
        if let AgentSlot::QueueItem(item_id) = &slot {
            if let Ok(Some(item)) = repo::get_queue_item(&self.read_pool, *item_id).await {
                if matches!(item.item_type.as_str(), "execute" | "review") {
                    agent_manager.send_feature_updated(&["progress", "phases"]);
                }
                if item.item_type == "review" {
                    if let Err(e) = self.re_populate_queue_for_new_phases().await {
                        warn!(feature_id = self.feature_id, error = %e, "re-populate after review failed");
                    }
                }
            }
        }

        // Autonomy-based advancement
        match self.autonomy_level.load(Ordering::Relaxed) {
            3 => {
                if let Err(e) = self.advance(agent_manager, permissions).await {
                    error!(error = %e, "advance after completion failed");
                }
            }
            2 => {
                if let Ok(ready) = repo::unblock_ready_items(&self.write_pool, self.feature_id).await {
                    if !ready.is_empty() {
                        let current_group = if let AgentSlot::QueueItem(id) = &slot {
                            self.get_current_group_index(*id).await
                        } else {
                            None
                        };
                        let same_group = ready.iter().all(|r| r.group_index == current_group);
                        if same_group {
                            let capacity = self.max_parallel - agent_manager.active_items.len();
                            let autonomy = self.autonomy_level.load(Ordering::Relaxed);
                            for item in ready.into_iter().take(capacity) {
                                if let Err(e) = agent_manager.start_item(item, self.strategy.as_ref(), autonomy, permissions).await {
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

        // Check if all items are completed after advancement
        self.check_workflow_completion(agent_manager, set_status).await;
    }

    /// Called when a queue item is paused (interrupted by user).
    pub async fn on_item_paused(&self, slot: AgentSlot, agent_manager: &AgentManager) {
        info!(feature_id = self.feature_id, slot = %slot, "queue item paused (interrupted)");

        if let AgentSlot::QueueItem(item_id) = &slot {
            let _ = sqlx::query("UPDATE workflow_queue SET status = 'paused' WHERE id = ?")
                .bind(item_id)
                .execute(&self.write_pool)
                .await;
            agent_manager.send_item_update(*item_id).await;
        }

        if let Some(db_session_id) = agent_manager.active_items.get(&slot) {
            let db_sid = *db_session_id;
            WsSessionPersistence::mark_paused_static(&self.write_pool, db_sid).await;

            if let Some(cc_sid_ref) = agent_manager.paused_sessions.get(&slot) {
                let cc_sid = cc_sid_ref.clone();
                debug!(slot = %slot, db_session_id = db_sid, cc_session_id = %cc_sid, "persisting claude_session_id to DB for resume");
                WsSessionPersistence::persist_claude_session_id_static(&self.write_pool, db_sid, &cc_sid).await;
            }
        }
    }

    /// Called when a queue item errors. Auto-retries if retry_count < max_retries.
    pub async fn on_item_error(
        &self,
        slot: AgentSlot,
        error: &str,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
        set_status: &dyn StatusSetter,
    ) {
        // If this item was interrupted, treat as paused
        if agent_manager.interrupted_items.remove(&slot).is_some() {
            self.on_item_paused(slot, agent_manager).await;
            return;
        }

        warn!(feature_id = self.feature_id, slot = %slot, error, "queue item errored");

        agent_manager.cleanup_agent(&slot);
        permissions.cleanup(&slot);

        let legacy_id = slot.as_legacy_id();

        // Check if we can auto-retry
        if let AgentSlot::QueueItem(item_id) = &slot {
            if let Ok(Some(item)) = repo::get_queue_item(&self.write_pool, *item_id).await {
                if item.retry_count < item.max_retries {
                    match repo::increment_retry_count(&self.write_pool, *item_id).await {
                        Ok(new_count) => {
                            warn!(
                                feature_id = self.feature_id,
                                item_id = *item_id,
                                "auto-retrying item {} (attempt {}/{})",
                                item_id, new_count, item.max_retries
                            );

                            if let Err(e) = repo::mark_item_ready(&self.write_pool, *item_id).await {
                                tracing::error!(item_id = *item_id, error = %e, "failed to reset item to ready for retry");
                            }

                            let envelope = WsEnvelope::new(
                                "workflow",
                                "item_retrying",
                                to_value(WorkflowItemRetryingPayload {
                                    feature_id: self.feature_id,
                                    queue_item_id: *item_id,
                                    retry_count: new_count,
                                    max_retries: item.max_retries,
                                }),
                            );
                            let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

                            agent_manager.send_item_update(*item_id).await;

                            // Trigger advance to pick up the retried item
                            let _ = self.advance(agent_manager, permissions).await;
                            return;
                        }
                        Err(e) => {
                            tracing::error!(item_id = *item_id, error = %e, "failed to increment retry count");
                        }
                    }
                }
            }
        }

        // No retry available — proceed with error handling
        if let Err(e) = repo::mark_item_error(&self.write_pool, legacy_id, Some(error)).await {
            tracing::error!(slot = %slot, error = %e, "failed to mark item error");
        }

        if let AgentSlot::QueueItem(item_id) = &slot {
            agent_manager.send_item_update(*item_id).await;
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "item_error",
            to_value(WorkflowItemErrorPayload {
                feature_id: self.feature_id,
                agent_slot: slot,
                error: error.to_string(),
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        if agent_manager.active_items.is_empty() {
            set_status.set_status(WorkflowStatus::Error).await;
        }
    }

    /// Retry a failed queue item.
    pub async fn retry_item(
        &self,
        item_id: i64,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        info!(feature_id = self.feature_id, item_id, "retrying queue item");

        sqlx::query("UPDATE workflow_queue SET status = 'ready', started_at = NULL, ended_at = NULL, result = NULL WHERE id = ?")
            .bind(item_id)
            .execute(&self.write_pool)
            .await
            .map_err(|e| format!("Failed to reset item for retry: {e}"))?;

        agent_manager.send_item_update(item_id).await;
        self.advance(agent_manager, permissions).await
    }

    /// Skip a queue item and unblock dependents.
    pub async fn skip_item(
        &self,
        item_id: i64,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        info!(feature_id = self.feature_id, item_id, "skipping queue item");

        repo::mark_item_skipped(&self.write_pool, item_id)
            .await
            .map_err(|e| e.to_string())?;

        agent_manager.active_items.remove(&AgentSlot::QueueItem(item_id));

        agent_manager.send_item_update(item_id).await;

        let envelope = WsEnvelope::new(
            "workflow",
            "item_skipped",
            to_value(WorkflowItemSkippedPayload {
                feature_id: self.feature_id,
                agent_slot: AgentSlot::QueueItem(item_id),
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        self.advance(agent_manager, permissions).await
    }

    /// Check if all queue items are completed/skipped and no active items remain.
    async fn check_workflow_completion(
        &self,
        agent_manager: &AgentManager,
        set_status: &dyn StatusSetter,
    ) {
        if !agent_manager.active_items.is_empty() {
            return;
        }
        if let Ok(items) = repo::get_queue_for_feature(&self.read_pool, self.feature_id).await {
            if !items.is_empty() && items.iter().all(|i| i.status == "completed" || i.status == "skipped") {
                set_status.set_status(WorkflowStatus::Completed).await;
            }
        }
    }

    /// Get the group_index for a completed item (for autonomy level 2 checks).
    async fn get_current_group_index(&self, item_id: i64) -> Option<i64> {
        let row: Option<(Option<i64>,)> =
            sqlx::query_as("SELECT group_index FROM workflow_queue WHERE id = ?")
                .bind(item_id)
                .fetch_optional(&self.read_pool)
                .await
                .ok()?;
        row.and_then(|(g,)| g)
    }

    /// After a review item completes, check if the review agent created new phases.
    /// If so, add new queue items for those phases.
    pub async fn re_populate_queue_for_new_phases(&self) -> Result<(), String> {
        let plan_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to get plan: {e}"))?;

        let plan_id = match plan_id {
            Some(id) => id,
            None => return Ok(()),
        };

        let all_phases: Vec<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id, title, depends_on FROM phases WHERE plan_id = ? ORDER BY order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read phases: {e}"))?;

        let existing_phase_ids: Vec<(Option<i64>,)> = sqlx::query_as(
            "SELECT phase_id FROM workflow_queue WHERE feature_id = ? AND phase_id IS NOT NULL",
        )
        .bind(self.feature_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read queue: {e}"))?;

        let existing: std::collections::HashSet<i64> = existing_phase_ids
            .into_iter()
            .filter_map(|(id,)| id)
            .collect();

        let new_phases: Vec<_> = all_phases
            .iter()
            .filter(|(id, _, _)| !existing.contains(id))
            .collect();

        if new_phases.is_empty() {
            info!(feature_id = self.feature_id, "review completed, no new phases to add");
            return Ok(());
        }

        info!(
            feature_id = self.feature_id,
            count = new_phases.len(),
            "review created fix phases, adding to queue"
        );

        let max_order: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(order_index), 0) FROM workflow_queue WHERE feature_id = ?",
        )
        .bind(self.feature_id)
        .fetch_one(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to get max order: {e}"))?;

        let max_group: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(group_index), 0) FROM workflow_queue WHERE feature_id = ?",
        )
        .bind(self.feature_id)
        .fetch_one(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to get max group: {e}"))?;

        let workflow_type_str = self.workflow_type.as_str();

        for (i, (phase_id, _title, _deps)) in new_phases.iter().enumerate() {
            let order = max_order + 1 + i as i64;
            let group = max_group + 1;
            repo::insert_queue_item(
                &self.write_pool,
                self.feature_id,
                workflow_type_str,
                "execute",
                Some(*phase_id),
                "ready",
                order,
                Some(group),
            )
            .await
            .map_err(|e| format!("Failed to insert fix queue item: {e}"))?;
        }

        let review_order = max_order + 1 + new_phases.len() as i64;
        let review_group = max_group + 2;
        let review_id = repo::insert_queue_item(
            &self.write_pool,
            self.feature_id,
            workflow_type_str,
            "review",
            None,
            "blocked",
            review_order,
            Some(review_group),
        )
        .await
        .map_err(|e| format!("Failed to insert follow-up review: {e}"))?;

        let new_fix_ids: Vec<(i64,)> = sqlx::query_as(
            "SELECT id FROM workflow_queue WHERE feature_id = ? AND order_index > ? AND item_type = 'execute' ORDER BY order_index",
        )
        .bind(self.feature_id)
        .bind(max_order)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read new fix items: {e}"))?;

        for (fix_id,) in new_fix_ids {
            let _ = repo::insert_dependency(&self.write_pool, review_id, fix_id).await;
        }

        let all_items = repo::get_queue_for_feature(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| format!("Failed to read queue: {e}"))?;

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

        let envelope = WsEnvelope::new(
            "workflow",
            "review_verdict",
            to_value(serde_json::json!({
                "feature_id": self.feature_id,
                "verdict": "changes_requested",
                "fix_phase_count": new_phases.len(),
            })),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        Ok(())
    }

    /// Restore workflow state from DB on reconnection.
    pub async fn restore_on_reconnect(&self, agent_manager: &AgentManager) -> Result<(), String> {
        info!(feature_id = self.feature_id, "restoring workflow state on reconnect");

        // Restore paused pre-queue agents from DB.
        // Only restore sessions that haven't ended (ended_at IS NULL) — sessions with
        // ended_at set are finished even if status wasn't updated.
        let resumable_sessions: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT id, agent_type, claude_session_id FROM agent_sessions \
             WHERE feature_id = ? AND claude_session_id IS NOT NULL \
             AND status = 'paused' \
             ORDER BY id DESC",
        )
        .bind(self.feature_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut restored: Vec<(AgentSlot, i64, String, String)> = Vec::new();
        let mut seen_slots = std::collections::HashSet::new();
        for (db_session_id, agent_type, cc_session_id) in &resumable_sessions {
            let Some(slot) = agent_type_str_to_slot(agent_type) else {
                continue;
            };
            // Only restore the most recent session per slot
            if !seen_slots.insert(slot.clone()) {
                continue;
            }
            info!(
                feature_id = self.feature_id,
                db_session_id,
                agent_type = agent_type.as_str(),
                cc_session_id = cc_session_id.as_str(),
                slot = %slot,
                "restoring paused pre-queue agent for resume"
            );
            agent_manager.paused_sessions.insert(slot.clone(), cc_session_id.clone());
            agent_manager.active_items.insert(slot.clone(), *db_session_id);
            WsSessionPersistence::mark_paused_static(&self.write_pool, *db_session_id).await;
            restored.push((slot, *db_session_id, agent_type.clone(), cc_session_id.clone()));
        }

        // Restore paused queue items (from graceful shutdown via pause_all).
        // The relationship is: workflow_queue.agent_session_id → agent_sessions.id
        let paused_queue_items: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
            "SELECT wq.id, wq.agent_session_id, ags.claude_session_id \
             FROM workflow_queue wq \
             LEFT JOIN agent_sessions ags ON ags.id = wq.agent_session_id \
             WHERE wq.feature_id = ? AND wq.status = 'paused'",
        )
        .bind(self.feature_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| e.to_string())?;

        for (item_id, agent_session_id, cc_session_id) in &paused_queue_items {
            let slot = AgentSlot::QueueItem(*item_id);
            if let Some(ref sid) = cc_session_id {
                info!(feature_id = self.feature_id, item_id, cc_session_id = %sid, "restoring paused queue item for resume");
                agent_manager.paused_sessions.insert(slot.clone(), sid.clone());
            }
            if let Some(db_sid) = agent_session_id {
                agent_manager.active_items.insert(slot.clone(), *db_sid);
            }
        }

        // Clear stale pending_questions so the frontend doesn't show stale forms.
        let _ = sqlx::query(
            "UPDATE agent_sessions SET pending_questions = NULL WHERE feature_id = ? AND pending_questions IS NOT NULL"
        )
        .bind(self.feature_id)
        .execute(&self.write_pool)
        .await;

        // Mark stale running queue items as error (only truly orphaned ones)
        sqlx::query(
            "UPDATE workflow_queue SET status = 'error', result = 'Stale after reconnect', ended_at = datetime('now'), pid = NULL WHERE feature_id = ? AND status = 'running'",
        )
        .bind(self.feature_id)
        .execute(&self.write_pool)
        .await
        .map_err(|e| e.to_string())?;

        // Send full queue update
        let all_items = repo::get_queue_for_feature(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        let workflow_status = repo::get_workflow_status(&self.read_pool, self.feature_id)
            .await
            .unwrap_or(WorkflowStatus::Idle)
            .to_string();

        let envelope = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id: self.feature_id,
                items: all_items,
                workflow_status: Some(workflow_status),
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        // Notify frontend about restored paused agents
        for (slot, db_session_id, agent_type, cc_session_id) in &restored {
            let envelope = WsEnvelope::new(
                "workflow",
                "agent_paused",
                to_value(WorkflowAgentPausedPayload {
                    feature_id: self.feature_id,
                    agent_slot: slot.clone(),
                    session_id: *db_session_id,
                    agent_type: agent_type.clone(),
                    claude_session_id: cc_session_id.clone(),
                }),
            );
            let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
        }

        // Notify frontend about restored paused queue items
        for (item_id, _agent_session_id, cc_session_id) in &paused_queue_items {
            if let Some(ref sid) = cc_session_id {
                let slot = AgentSlot::QueueItem(*item_id);
                let db_sid = agent_manager.active_items.get(&slot).map(|e| *e.value()).unwrap_or(0);
                let envelope = WsEnvelope::new(
                    "workflow",
                    "agent_paused",
                    to_value(WorkflowAgentPausedPayload {
                        feature_id: self.feature_id,
                        agent_slot: slot,
                        session_id: db_sid,
                        agent_type: "execute".to_string(),
                        claude_session_id: sid.clone(),
                    }),
                );
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
            }
        }

        Ok(())
    }
}

/// Trait for setting workflow status. This allows the engine to pass itself
/// as a status setter without creating circular dependencies.
#[async_trait::async_trait]
pub trait StatusSetter: Send + Sync {
    async fn set_status(&self, status: WorkflowStatus);
}

// Import debug for the on_item_paused method
use tracing::debug;
