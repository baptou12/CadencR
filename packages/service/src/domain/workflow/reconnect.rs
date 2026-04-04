//! Reconnect and re-populate logic for workflow queue.
//!
//! Extracted from queue_advancer.rs to keep files under 400 lines.

use axum::extract::ws::Message;
use tracing::{debug, info};

use crate::domain::features::repository as repo;
use crate::domain::workflow::agent_manager::AgentManager;
use crate::domain::workflow::engine::{agent_type_str_to_slot, AgentSlot};
use crate::domain::workflow::queue_advancer::QueueAdvancer;
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use super::engine::to_value;

impl QueueAdvancer {
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

        if agent_manager.active_items.len() <= 1 {
            WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "none");
        }
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

        // Restore paused queue items
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

        // Clear stale pending_questions
        let _ = sqlx::query(
            "UPDATE agent_sessions SET pending_questions = NULL WHERE feature_id = ? AND pending_questions IS NOT NULL"
        )
        .bind(self.feature_id)
        .execute(&self.write_pool)
        .await;

        // Mark stale running queue items as error
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
