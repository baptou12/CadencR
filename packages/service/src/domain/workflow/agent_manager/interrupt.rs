//! Interrupt, pause, and cleanup logic for AgentManager.

use tracing::{debug, info, warn};

use axum::extract::ws::Message;

use crate::domain::features::repository as repo;
use crate::domain::workflow::engine::{to_value, AgentSlot};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use super::AgentManager;

impl AgentManager {
    /// Interrupt a running queue item.
    /// Fast path: use in-memory Query handle. Fallback: PID from DB.
    pub async fn interrupt_item(&self, slot: AgentSlot) -> Result<(), String> {
        self.interrupted_items.insert(slot.clone());

        // Capture Claude Code session ID NOW while the query handle still exists
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            if let Some(rt_session_id) = q.session_id().await {
                debug!(slot = %slot, rt_session_id = %rt_session_id, "captured runtime session ID for resume");
                self.paused_sessions.insert(slot.clone(), rt_session_id);
            }
            return q
                .interrupt()
                .await
                .map_err(|e| format!("Interrupt failed: {e}"));
        }
        // Fallback: PID from DB — only for real queue items
        if let AgentSlot::QueueItem(item_id) = &slot {
            return self.interrupt_by_pid(*item_id).await;
        }
        // No query handle — the agent's CLI turn likely already ended.
        // Check if it's already paused/completed and treat as success.
        if let Some(db_sid) = self.active_items.get(&slot) {
            let status: Option<(String,)> =
                sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
                    .bind(*db_sid)
                    .fetch_optional(&self.read_pool)
                    .await
                    .ok()
                    .flatten();
            if let Some((ref s,)) = status {
                if s == "paused" || s == "completed" {
                    info!(slot = %slot, status = %s, "interrupt requested but agent already {s} — treating as success");
                    return Ok(());
                }
            }
        }
        Err(format!("No query handle for slot {slot}"))
    }

    /// PID-based interrupt fallback.
    ///
    /// # Safety note on PID reuse
    /// There is an inherent TOCTOU race with PID-based signals: between reading the PID
    /// from the DB and sending the signal, the process could exit and the PID could be
    /// reassigned. This is mitigated by preferring the in-memory Query handle path.
    pub async fn interrupt_by_pid(&self, queue_item_id: i64) -> Result<(), String> {
        warn!(
            queue_item_id,
            "falling back to PID-based interrupt (no in-memory Query handle)"
        );

        let item = repo::get_queue_item(&self.read_pool, queue_item_id)
            .await
            .map_err(|e| format!("DB lookup failed: {e}"))?
            .ok_or_else(|| format!("Queue item {queue_item_id} not found"))?;

        if let Some(pid) = item.pid {
            // SAFETY: libc::kill sends a signal to a process. We validate the return value
            // and handle ESRCH (process not found). PID reuse risk is documented above.
            let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
            if result == 0 {
                info!(queue_item_id, pid, "sent SIGINT via PID fallback");
                Ok(())
            } else {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ESRCH) {
                    Err("Process already exited".into())
                } else {
                    Err(format!("kill({pid}, SIGINT) failed: {err}"))
                }
            }
        } else {
            Err(format!("No query handle or PID for item {queue_item_id}"))
        }
    }

    /// Clean up state for an agent slot (remove from all tracking maps).
    pub fn cleanup_agent(&self, slot: &AgentSlot) {
        self.active_items.remove(slot);
        self.queries.remove(slot);
        self.paused_sessions.remove(slot);
    }

    /// Pause all running agents: capture runtime_session_id, interrupt, mark paused in DB.
    /// Used during graceful shutdown so agents can be resumed on next app start.
    pub async fn pause_all(&self) {
        let slots: Vec<AgentSlot> = self.queries.iter().map(|e| e.key().clone()).collect();
        let mut paused_session_ids: Vec<i64> = Vec::new();
        for slot in slots {
            if let Some(query_arc) = self.queries.get(&slot) {
                let q = query_arc.lock().await;
                // Capture session ID for resume
                if let Some(rt_session_id) = q.session_id().await {
                    info!(slot = %slot, rt_session_id = %rt_session_id, "pause_all: captured session ID");
                    self.paused_sessions
                        .insert(slot.clone(), rt_session_id.clone());
                    // Persist to DB
                    if let Some(db_session_id) = self.active_items.get(&slot).map(|e| *e.value()) {
                        WsSessionPersistence::persist_runtime_session_id_only(
                            &self.write_pool,
                            db_session_id,
                            &rt_session_id,
                        )
                        .await;
                        WsSessionPersistence::mark_paused_static(&self.write_pool, db_session_id)
                            .await;
                        paused_session_ids.push(db_session_id);
                    }
                }
                // Interrupt and close the runtime process. We already persisted
                // the runtime_session_id above, so the next app start can resume
                // while the local provider subprocess is fully stopped.
                let _ = q.interrupt().await;
                drop(q);
                if let Some(query_arc) = self.queries.get(&slot) {
                    query_arc.lock().await.close().await;
                }
            }
            // Also mark queue items as paused in workflow_queue
            if let AgentSlot::QueueItem(item_id) = &slot {
                let _ = repo::mark_running_item_paused(&self.write_pool, *item_id).await;
            }
        }
        // Per-session Idle broadcast: each paused session flips to Idle
        // independently so the sidebar drops the working/asking icon for it.
        for sid in paused_session_ids {
            WsSessionPersistence::broadcast_session_status(
                &self.session_status_tx,
                sid,
                self.feature_id,
                crate::domain::session_status::AgentStatus::Idle,
                None,
            );
        }
        info!(feature_id = self.feature_id, "pause_all: all agents paused");
    }

    /// Mark a running agent as done (clean shutdown).
    pub async fn mark_done(&self, slot: AgentSlot) -> Result<(), String> {
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            let _ = q.interrupt().await;
        }

        let removed = self.active_items.remove(&slot);
        self.queries.remove(&slot);

        if let AgentSlot::QueueItem(item_id) = &slot {
            if let Err(e) =
                repo::mark_item_completed(&self.write_pool, *item_id, Some("Marked done by user"))
                    .await
            {
                warn!(slot = %slot, error = %e, "failed to mark item completed on mark_done");
            }
            self.send_item_update(*item_id).await;
        }

        // Mark the agent_sessions row as completed for all slot types and
        // broadcast Idle for the affected session.
        let removed_session_id = removed.map(|(_, db_session_id)| db_session_id);
        if let Some(db_session_id) = removed_session_id {
            if let Err(e) = sqlx::query("UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?")
                .bind(db_session_id)
                .execute(&self.write_pool)
                .await
            {
                warn!(slot = %slot, error = %e, "failed to mark agent_session completed on mark_done");
            }
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "item_completed",
            to_value(WorkflowItemCompletedPayload {
                feature_id: self.feature_id,
                agent_slot: slot,
                result: Some("Marked done by user".to_string()),
            }),
        );
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));

        if let Some(db_session_id) = removed_session_id {
            WsSessionPersistence::broadcast_session_status(
                &self.session_status_tx,
                db_session_id,
                self.feature_id,
                crate::domain::session_status::AgentStatus::Idle,
                None,
            );
        }

        Ok(())
    }
}
