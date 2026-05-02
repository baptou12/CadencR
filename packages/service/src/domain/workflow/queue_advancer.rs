//! Queue state management for workflow execution.
//!
//! Handles advancing the queue, completing/erroring/skipping/retrying items.
//! Gate handling is in gate_handler.rs, reconnect/re-populate in reconnect.rs.

use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

use sqlx::SqlitePool;
use tracing::{error, info, warn};

use axum::extract::ws::Message;

use crate::domain::features::models::WorkflowType;
use crate::domain::features::repository as repo;
use crate::domain::settings::resolve_setting;
use crate::domain::workflow::agent_manager::AgentManager;
use crate::domain::workflow::engine::{AgentSlot, WsSender};
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
    pub session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
}

impl QueueAdvancer {
    pub async fn new(
        feature_id: i64,
        workflow_type: WorkflowType,
        max_parallel: usize,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        ws_sender: WsSender,
        session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
    ) -> Result<Self, String> {
        let project_id =
            sqlx::query_scalar::<_, i64>("SELECT project_id FROM features WHERE id = ?")
                .bind(feature_id)
                .fetch_optional(&read_pool)
                .await
                .ok()
                .flatten();

        let strategy: Box<dyn WorkflowStrategy> = strategies::get_strategy(&workflow_type)?;

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
        let effective_max = if parallel_str.as_deref() == Some("false") {
            1
        } else {
            max_parallel
        };

        Ok(Self {
            feature_id,
            workflow_type,
            strategy,
            max_parallel: AtomicUsize::new(effective_max),
            autonomy_level: AtomicU8::new(autonomy),
            read_pool,
            write_pool,
            ws_sender,
            session_status_tx,
        })
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

        repo::unblock_ready_items(&self.write_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        let ready = repo::get_ready_items(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        let capacity = max_parallel - running;
        let autonomy = self.autonomy_level.load(Ordering::Relaxed);
        for item in ready.into_iter().take(capacity) {
            if let Err(e) = agent_manager
                .start_item(item, self.strategy.as_ref(), autonomy, permissions)
                .await
            {
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
        if agent_manager.interrupted_items.remove(&slot).is_some() {
            self.on_item_paused(slot, agent_manager).await;
            return;
        }

        info!(feature_id = self.feature_id, slot = %slot, "queue item completed");

        let db_session_id = agent_manager.active_items.get(&slot).map(|e| *e.value());

        agent_manager.cleanup_agent(&slot);
        permissions.cleanup(&slot);

        if let Some(sid) = db_session_id {
            WsSessionPersistence::broadcast_session_status(
                &self.session_status_tx,
                sid,
                self.feature_id,
                crate::domain::session_status::AgentStatus::Idle,
                None,
            );
        }

        let legacy_id = slot.as_legacy_id();
        if let Err(e) = repo::mark_item_completed(&self.write_pool, legacy_id, result).await {
            error!(slot = %slot, error = %e, "failed to mark item completed");
        }

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
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));

        if matches!(slot, AgentSlot::Plan) {
            agent_manager.send_feature_updated(&["plan", "phases", "progress"]);
        } else if matches!(slot, AgentSlot::Prd) {
            agent_manager.send_feature_updated(&["prd"]);
        }

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

        if matches!(slot, AgentSlot::QueueItem(_)) {
            let gate_type = self.extract_gate_type(&slot).await;

            match gate_type.as_deref() {
                Some("approval") => {
                    self.handle_approval_gate(&slot, agent_manager).await;
                }
                Some("manual") => {
                    self.handle_manual_gate(agent_manager).await;
                }
                Some("iterate") => {
                    self.handle_iterate_gate(&slot, agent_manager, permissions, set_status)
                        .await;
                }
                _ => {
                    self.handle_auto_gate(&slot, agent_manager, permissions, set_status)
                        .await;
                }
            }

            self.check_workflow_completion(agent_manager, set_status)
                .await;
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
        if agent_manager.interrupted_items.remove(&slot).is_some() {
            self.on_item_paused(slot, agent_manager).await;
            return;
        }

        warn!(feature_id = self.feature_id, slot = %slot, error, "queue item errored");

        let errored_session_id = agent_manager.active_items.get(&slot).map(|e| *e.value());
        agent_manager.cleanup_agent(&slot);
        permissions.cleanup(&slot);

        let legacy_id = slot.as_legacy_id();

        if let AgentSlot::QueueItem(item_id) = &slot {
            if let Ok(Some(item)) = repo::get_queue_item(&self.write_pool, *item_id).await {
                if item.retry_count < item.max_retries {
                    match repo::increment_retry_count(&self.write_pool, *item_id).await {
                        Ok(new_count) => {
                            warn!(
                                feature_id = self.feature_id,
                                item_id = *item_id,
                                "auto-retrying item {} (attempt {}/{})",
                                item_id,
                                new_count,
                                item.max_retries
                            );

                            if let Err(e) = repo::mark_item_ready(&self.write_pool, *item_id).await
                            {
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
                            let _ = self
                                .ws_sender
                                .send(Message::Text(String::from(envelope).into()));

                            agent_manager.send_item_update(*item_id).await;

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
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));

        if let Some(sid) = errored_session_id {
            WsSessionPersistence::broadcast_session_status(
                &self.session_status_tx,
                sid,
                self.feature_id,
                crate::domain::session_status::AgentStatus::Idle,
                None,
            );
        }
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

        repo::reset_item_for_retry(&self.write_pool, item_id)
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

        agent_manager
            .active_items
            .remove(&AgentSlot::QueueItem(item_id));

        agent_manager.send_item_update(item_id).await;

        let envelope = WsEnvelope::new(
            "workflow",
            "item_skipped",
            to_value(WorkflowItemSkippedPayload {
                feature_id: self.feature_id,
                agent_slot: AgentSlot::QueueItem(item_id),
            }),
        );
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));

        self.advance(agent_manager, permissions).await
    }

    /// Get the group_index for a completed item (for autonomy level 2 checks).
    pub(crate) async fn get_current_group_index(&self, item_id: i64) -> Option<i64> {
        repo::get_group_index(&self.read_pool, item_id).await.ok()?
    }
}

/// Trait for setting workflow status. This allows the engine to pass itself
/// as a status setter without creating circular dependencies.
#[async_trait::async_trait]
pub trait StatusSetter: Send + Sync {
    async fn set_status(&self, status: WorkflowStatus);
}
