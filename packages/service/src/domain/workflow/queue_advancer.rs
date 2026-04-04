//! Queue state management for workflow execution.
//!
//! Handles advancing the queue, completing/erroring/skipping/retrying items,
//! re-populating on review completion, and restoring stale items on reconnect.

use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

use sqlx::SqlitePool;
use tracing::{error, info, warn};

use axum::extract::ws::Message;

use crate::domain::features::models::WorkflowType;
use crate::domain::features::repository as repo;
use crate::domain::settings::resolve_setting;
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
    pub max_parallel: AtomicUsize,
    pub autonomy_level: AtomicU8,
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
    pub turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
}

impl QueueAdvancer {
    pub async fn new(
        feature_id: i64,
        workflow_type: WorkflowType,
        max_parallel: usize,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        ws_sender: WsSender,
        turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    ) -> Self {
        let project_id = sqlx::query_scalar::<_, i64>(
            "SELECT project_id FROM features WHERE id = ?",
        )
        .bind(feature_id)
        .fetch_optional(&read_pool)
        .await
        .ok()
        .flatten();

        // Select strategy based on workflow type: Custom workflows look up
        // the workflow_definition_id from the feature row.
        let strategy: Box<dyn WorkflowStrategy> = match &workflow_type {
            WorkflowType::Custom => {
                let wd_id: Option<i64> = sqlx::query_scalar(
                    "SELECT workflow_definition_id FROM features WHERE id = ?",
                )
                .bind(feature_id)
                .fetch_optional(&read_pool)
                .await
                .ok()
                .flatten();
                strategies::get_custom_strategy(
                    wd_id.expect("Custom workflow feature must have workflow_definition_id"),
                )
            }
            _ => strategies::get_strategy(&workflow_type)
                .expect("QueueAdvancer::new called with unsupported workflow type"),
        };

        let autonomy = resolve_setting(
            &read_pool,
            "agent_autonomy",
            Some(feature_id),
            project_id,
            Some("1"),
        )
        .await
        .and_then(|v| v.parse::<u8>().ok())
        .unwrap_or(1);

        let parallel_str = resolve_setting(
            &read_pool,
            "parallel_execution",
            Some(feature_id),
            project_id,
            Some("true"),
        )
        .await;
        let effective_max = if parallel_str.as_deref() == Some("false") { 1 } else { max_parallel };

        Self {
            feature_id,
            workflow_type,
            strategy,
            max_parallel: AtomicUsize::new(effective_max),
            autonomy_level: AtomicU8::new(autonomy),
            read_pool,
            write_pool,
            ws_sender,
            turn_state_tx,
        }
    }

    pub fn set_max_parallel(&self, val: usize) {
        self.max_parallel.store(val, Ordering::Relaxed);
    }

    /// Advance the workflow: unblock ready items and start them up to capacity.
    pub async fn advance(
        &self,
        agent_manager: &AgentManager,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        let running = agent_manager.active_items.len();
        let max_parallel = self.max_parallel.load(Ordering::Relaxed);

        if running >= max_parallel {
            info!(
                feature_id = self.feature_id,
                running,
                max = max_parallel,
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

        let capacity = max_parallel - running;
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

        // Grab the db_session_id before cleanup removes it from active_items
        let db_session_id = agent_manager.active_items.get(&slot).map(|e| *e.value());

        agent_manager.cleanup_agent(&slot);
        permissions.cleanup(&slot);

        // Broadcast "none" if no other agents are active (advance may override with "claude")
        if agent_manager.active_items.is_empty() {
            WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "none");
        }

        let legacy_id = slot.as_legacy_id();
        if let Err(e) = repo::mark_item_completed(&self.write_pool, legacy_id, result).await {
            error!(slot = %slot, error = %e, "failed to mark item completed");
        }

        // Also mark the agent_sessions row as completed (mark_item_completed only
        // updates workflow_queue, which is a no-op for pre-queue agents like plan/prd).
        if let Some(session_id) = db_session_id {
            if let Err(e) = sqlx::query("UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?")
                .bind(session_id)
                .execute(&self.write_pool)
                .await
            {
                error!(slot = %slot, error = %e, "failed to mark agent_session completed");
            }
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

        // Autonomy-based advancement and completion check only apply to queue items.
        // Pre-queue agents (Plan, Prd, Session, Refine, etc.) should not trigger
        // pause/advance logic — their status is managed by the approval handlers.
        if matches!(slot, AgentSlot::QueueItem(_)) {
            // Check gate type from config for custom workflow phases
            let gate_type = self.extract_gate_type(&slot).await;

            match gate_type.as_deref() {
                Some("approval") => {
                    self.handle_approval_gate(&slot, agent_manager).await;
                }
                Some("manual") => {
                    self.handle_manual_gate(agent_manager).await;
                }
                _ => {
                    // "auto" or legacy (no gate_type) — use existing autonomy logic
                    self.handle_auto_gate(&slot, agent_manager, permissions, set_status).await;
                }
            }

            // Check if all items are completed after advancement
            self.check_workflow_completion(agent_manager, set_status).await;
        }
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

        let mut db_sid: i64 = 0;
        let mut cc_sid = String::new();

        if let Some(db_session_id) = agent_manager.active_items.get(&slot) {
            db_sid = *db_session_id;
            WsSessionPersistence::mark_paused_static(&self.write_pool, db_sid).await;

            if let Some(cc_sid_ref) = agent_manager.paused_sessions.get(&slot) {
                cc_sid = cc_sid_ref.clone();
                debug!(slot = %slot, db_session_id = db_sid, cc_session_id = %cc_sid, "persisting claude_session_id to DB for resume");
                WsSessionPersistence::persist_claude_session_id_static(&self.write_pool, db_sid, &cc_sid).await;
            }
        }

        // Notify frontend that the agent is paused so it can update the UI status
        let agent_type = slot.agent_type_str().unwrap_or("session").to_string();
        let envelope = WsEnvelope::new(
            "workflow",
            "agent_paused",
            to_value(WorkflowAgentPausedPayload {
                feature_id: self.feature_id,
                agent_slot: slot,
                session_id: db_sid,
                agent_type,
                claude_session_id: cc_sid,
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        // Broadcast "none" if this was the last active agent
        if agent_manager.active_items.len() <= 1 {
            WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "none");
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
            WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "none");
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

    /// Extract gate_type from a queue item's config JSON.
    async fn extract_gate_type(&self, slot: &AgentSlot) -> Option<String> {
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
    async fn handle_approval_gate(&self, slot: &AgentSlot, agent_manager: &AgentManager) {
        let item_id = match slot {
            AgentSlot::QueueItem(id) => *id,
            _ => return,
        };
        // Override the completed status with pending_approval
        if let Err(e) = repo::mark_item_pending_approval(&self.write_pool, item_id).await {
            error!(item_id, error = %e, "failed to mark item pending_approval");
            return;
        }
        agent_manager.send_item_update(item_id).await;

        // Get phase_slug and artifact content for the WS notification
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
    async fn handle_manual_gate(&self, agent_manager: &AgentManager) {
        if let Err(e) = repo::unblock_ready_items(&self.write_pool, self.feature_id).await {
            error!(error = %e, "unblock_ready_items failed for manual gate");
        }
        // Send queue update so frontend sees newly-ready items
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
        // Broadcast turn state since we're not auto-starting
        if agent_manager.active_items.is_empty() {
            WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "none");
        }
    }

    /// Handle auto gate: existing autonomy-based advancement logic.
    async fn handle_auto_gate(
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
                            let capacity = self.max_parallel.load(Ordering::Relaxed) - agent_manager.active_items.len();
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
    }

    /// Get the phase slug and artifact content for a queue item.
    async fn get_phase_artifact_info(&self, item_id: i64) -> (String, Option<String>) {
        let item = match repo::get_queue_item(&self.read_pool, item_id).await {
            Ok(Some(item)) => item,
            _ => return (String::new(), None),
        };
        let phase_slug = item.item_type.clone();
        // Try to load artifact content from workflow_artifacts table
        let artifact: Option<(String,)> = sqlx::query_as(
            "SELECT content FROM workflow_artifacts WHERE feature_id = ? AND phase_slug = ?",
        )
        .bind(self.feature_id)
        .bind(&phase_slug)
        .fetch_optional(&self.read_pool)
        .await
        .ok()
        .flatten();
        let content = artifact.map(|(c,)| c);
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
            // Store feedback in config JSON
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
            // Reset to ready for re-run
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
    async fn check_workflow_completion(
        &self,
        agent_manager: &AgentManager,
        set_status: &dyn StatusSetter,
    ) {
        if !agent_manager.active_items.is_empty() {
            return;
        }
        if let Ok(items) = repo::get_queue_for_feature(&self.read_pool, self.feature_id).await {
            if !items.is_empty() && items.iter().all(|i| matches!(i.status.as_str(), "completed" | "skipped")) {
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

        // Upgrade any draft queue items to ready (placeholders from create_phase)
        sqlx::query(
            "UPDATE workflow_queue SET status = 'ready' WHERE feature_id = ? AND status = 'draft'",
        )
        .bind(self.feature_id)
        .execute(&self.write_pool)
        .await
        .map_err(|e| format!("Failed to upgrade draft items: {e}"))?;

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
        // Track singleton agent types we've already restored (plan, prd, refine).
        // Multi-instance types (session, risk, retro, review-fixer) each get a unique
        // slot via their db_session_id so they never collide.
        let mut seen_singletons = std::collections::HashSet::new();
        for (db_session_id, agent_type, cc_session_id) in &resumable_sessions {
            let Some(slot) = agent_type_str_to_slot(agent_type, *db_session_id) else {
                continue;
            };
            if slot.is_singleton() && !seen_singletons.insert(agent_type.clone()) {
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
