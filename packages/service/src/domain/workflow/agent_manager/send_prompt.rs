//! send_prompt and resume_item for AgentManager.

use std::sync::Arc;

use tracing::{error, info, warn};

use crate::domain::mcp::servers::AgentType;

use crate::domain::workflow::engine::AgentSlot;
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::stream_reader::spawn_workflow_stream_reader;
use crate::domain::ws_session::handler::session_prompt::build_content_value;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::ImagePayload;

use super::AgentManager;

impl AgentManager {
    /// Send a follow-up prompt to a running workflow agent.
    pub async fn send_prompt(
        &self,
        slot: AgentSlot,
        text: &str,
        images: Option<Vec<ImagePayload>>,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        let imgs = images.unwrap_or_default();

        // Fast path: agent is still running, send via stdin
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            let content = build_content_value(text, &imgs);
            q.stream_input(content).await.map_err(|e| format!("stream_input failed: {e}"))?;
            return Ok(());
        }

        // Slow path: agent was paused, resume by spawning new process
        if let Some((_, cc_session_id)) = self.paused_sessions.remove(&slot) {
            info!(slot = %slot, cc_session_id = %cc_session_id, "resuming paused agent with --resume");
            return self.resume_item(slot, &cc_session_id, text, &imgs, permissions).await;
        }

        // Fallback: check DB for a claude_session_id we can resume with
        if let Some(agent_type_str) = slot.agent_type_str() {
            let row: Option<(i64, Option<String>)> = sqlx::query_as(
                "SELECT id, claude_session_id FROM agent_sessions \
                 WHERE feature_id = ? AND agent_type = ? AND status IN ('running', 'paused') \
                 ORDER BY id DESC LIMIT 1",
            )
            .bind(self.feature_id)
            .bind(agent_type_str)
            .fetch_optional(&self.read_pool)
            .await
            .ok()
            .flatten();

            if let Some((db_session_id, Some(ref cc_session_id))) = row {
                if !cc_session_id.is_empty() {
                    let cc_sid = cc_session_id.clone();
                    info!(slot = %slot, db_session_id, cc_session_id = %cc_sid, "DB fallback: resuming paused agent with --resume");
                    self.active_items.insert(slot.clone(), db_session_id);
                    return self.resume_item(slot, &cc_sid, text, &imgs, permissions).await;
                }
            }

            // No claude_session_id at all — restart the agent fresh
            if let Some((db_session_id, _)) = row {
                info!(slot = %slot, db_session_id, "no claude_session_id — restarting agent fresh");
                WsSessionPersistence::mark_completed_static(&self.write_pool, db_session_id).await;
            }

            let sdk_type = slot.sdk_agent_type().unwrap();
            let system_prompt = slot.system_prompt().unwrap();
            info!(slot = %slot, agent_type = agent_type_str, "restarting pre-queue agent fresh (no resumable session)");
            return self.spawn_pre_queue_agent(
                sdk_type,
                agent_type_str,
                system_prompt,
                text,
                &imgs,
                |id| match slot {
                    AgentSlot::Session(_) => AgentSlot::Session(id),
                    AgentSlot::Risk(_) => AgentSlot::Risk(id),
                    AgentSlot::Retro(_) => AgentSlot::Retro(id),
                    AgentSlot::ReviewFixer(_) => AgentSlot::ReviewFixer(id),
                    other => other,
                },
                permissions,
            ).await.map(|_| ());
        }

        // Fallback for queue items: look up claude_session_id via workflow_queue.agent_session_id
        if let AgentSlot::QueueItem(item_id) = &slot {
            let row: Option<(i64, Option<String>)> = sqlx::query_as(
                "SELECT ags.id, ags.claude_session_id FROM agent_sessions ags \
                 INNER JOIN workflow_queue wq ON wq.agent_session_id = ags.id \
                 WHERE wq.id = ? AND ags.status IN ('running', 'paused') \
                 LIMIT 1",
            )
            .bind(*item_id)
            .fetch_optional(&self.read_pool)
            .await
            .ok()
            .flatten();

            if let Some((db_session_id, Some(ref cc_session_id))) = row {
                if !cc_session_id.is_empty() {
                    let cc_sid = cc_session_id.clone();
                    info!(slot = %slot, db_session_id, cc_session_id = %cc_sid, "DB fallback: resuming paused queue item with --resume");
                    self.active_items.insert(slot.clone(), db_session_id);
                    return self.resume_item(slot, &cc_sid, text, &imgs, permissions).await;
                }
            }
        }

        Err(format!("No query handle for slot {slot} — agent may need restart"))
    }

    /// Resume a paused agent by spawning a new Claude Code process with `--resume`.
    pub(super) async fn resume_item(
        &self,
        slot: AgentSlot,
        cc_session_id: &str,
        prompt: &str,
        images: &[ImagePayload],
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        self.interrupted_items.remove(&slot);

        let db_session_id = self.active_items.get(&slot)
            .map(|r| *r)
            .ok_or_else(|| format!("No active session for slot {slot}"))?;

        // Resolve agent_type_str — prefer the slot, fall back to DB
        let agent_type_str = match slot.agent_type_str() {
            Some(s) => s.to_string(),
            None => {
                let row: Option<(String,)> = sqlx::query_as(
                    "SELECT agent_type FROM agent_sessions WHERE id = ?",
                )
                .bind(db_session_id)
                .fetch_optional(&self.read_pool)
                .await
                .ok()
                .flatten();
                row.map(|(t,)| t).unwrap_or_else(|| "execute".to_string())
            }
        };

        // Derive AgentType from the resolved string so queue items (review, qa, etc.)
        // get the correct MCP server, not a hardcoded Execute fallback.
        let agent_type = agent_type_str.parse::<AgentType>().unwrap_or(AgentType::Execute);

        // Build spawn context with --resume
        let ctx = self.build_spawn_context(
            slot.clone(), db_session_id, agent_type, &agent_type_str,
            None, Some(cc_session_id), false, permissions,
        ).await?;

        let content_value = if prompt.is_empty() && images.is_empty() {
            serde_json::Value::String("Continue where you left off.".to_string())
        } else {
            build_content_value(prompt, images)
        };

        match claude_agent_sdk_rs::query(content_value, ctx.options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();
                if let Some(pid) = real_query.pid() {
                    if let AgentSlot::QueueItem(item_id) = &slot {
                        let _ = crate::domain::features::repository::update_item_pid(&self.write_pool, *item_id, pid as i64).await;
                    }
                }
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                if let Some((_, old_query)) = self.queries.remove(&slot) {
                    warn!(slot = %slot, "closing existing query before resuming agent");
                    old_query.lock().await.close().await;
                }
                self.queries.insert(slot.clone(), query_handle);

                if let AgentSlot::QueueItem(item_id) = &slot {
                    let _ = sqlx::query("UPDATE workflow_queue SET status = 'running' WHERE id = ?")
                        .bind(item_id)
                        .execute(&self.write_pool)
                        .await;
                    self.send_item_update(*item_id).await;
                }

                let _ = sqlx::query("UPDATE agent_sessions SET status = 'running' WHERE id = ?")
                    .bind(db_session_id)
                    .execute(&self.write_pool)
                    .await;

                spawn_workflow_stream_reader(
                    slot.clone(), db_session_id, self.feature_id,
                    ctx.expected_mcp_server, message_rx, self.ws_sender.clone(),
                    self.write_pool.clone(), self.active_items.clone(),
                    self.queries.clone(), Some(ctx.model.as_str()),
                );

                info!(slot = %slot, "agent resumed successfully");
                Ok(())
            }
            Err(e) => {
                error!(slot = %slot, error = %e, "failed to resume agent");
                Err(format!("Failed to resume agent: {e}"))
            }
        }
    }
}
