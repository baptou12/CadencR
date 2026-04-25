//! send_prompt and resume_item for AgentManager.

use std::sync::Arc;

use axum::extract::ws::Message;
use tracing::{error, info, warn};

use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionResponse};
use crate::domain::agents::runtime_adapter;
use crate::domain::features::repository as repo;
use crate::domain::mcp::servers::AgentType;

use crate::domain::workflow::engine::{to_value, AgentSlot};
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::stream_reader::spawn_workflow_stream_reader;
use crate::domain::ws_session::handler::session_prompt::build_content_value;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{ImagePayload, WorkflowAgentStartedPayload, WsEnvelope};

use super::AgentManager;

impl AgentManager {
    pub async fn respond_runtime_permission(
        &self,
        slot: &AgentSlot,
        response: PermissionResponse,
    ) -> Result<bool, String> {
        let Some(query) = self.queries.get(slot) else {
            return Ok(false);
        };
        let runtime_response = RuntimePermissionResponse {
            request_id: response.request_id.clone(),
            decision: match response.decision {
                crate::domain::ws_session::protocol::PermissionDecision::AllowOnce => {
                    RuntimePermissionDecision::AllowOnce
                }
                crate::domain::ws_session::protocol::PermissionDecision::AllowFuture => {
                    RuntimePermissionDecision::AllowFuture
                }
                crate::domain::ws_session::protocol::PermissionDecision::Deny => {
                    RuntimePermissionDecision::Deny
                }
            },
            feedback: response.feedback.clone(),
            updated_input: response.updated_input.clone(),
        };

        let q = query.lock().await;
        let result = q.respond_permission(runtime_response).await;
        drop(q);

        if result.is_ok() {
            // Every successful response clears the askUser gate — both the DB
            // row (so a reconnect-lag snapshot doesn't resurrect a ghost
            // askUser) and the broadcast turn state (so the sidebar icon
            // disappears without waiting for the runtime's next stream event).
            // Claude Code's `wait_for_approval` bridge does the same via
            // `mark_agent_resumed_static`; this is the direct-to-runtime
            // counterpart (OpenCode per-tool perms, AskUserQuestion answers,
            // and plan/PRD approvals all land here).
            let is_approval_gate = response.request_id.starts_with("approval_");
            let next_turn = if is_approval_gate {
                crate::domain::permission_bridge::turn_state_after_approval(
                    response.decision,
                    response.feedback.as_deref(),
                )
            } else {
                crate::domain::permission_bridge::turn_state_after_decision(response.decision)
            };
            if let Some(db_session_id) = self.active_items.get(slot).map(|e| *e.value()) {
                WsSessionPersistence::clear_all_pending_user_input_static(
                    &self.write_pool,
                    db_session_id,
                )
                .await;
            }
            WsSessionPersistence::broadcast_turn_state(
                &self.turn_state_tx,
                self.feature_id,
                next_turn,
            );
        }

        Ok(result.is_ok())
    }

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
            q.stream_input(content)
                .await
                .map_err(|e| format!("stream_input failed: {e}"))?;
            // The stream reader broadcasts "none" + marks the session
            // completed at `is_result`, so a follow-up prompt into the same
            // live runtime must re-assert "agent" / running for every
            // consumer of the global turn state (sidebar, runtime hook,
            // `agent_sessions.status`). The resume-from-paused branch below
            // already does this via `broadcast_turn_state("agent")` — this
            // mirrors it for the fast path.
            if let Some(entry) = self.active_items.get(&slot) {
                let db_session_id = *entry.value();
                drop(entry);
                WsSessionPersistence::mark_running_static(&self.write_pool, db_session_id).await;
            }
            WsSessionPersistence::broadcast_turn_state(
                &self.turn_state_tx,
                self.feature_id,
                "agent",
            );
            return Ok(());
        }

        // Slow path: agent was paused, resume by spawning new process
        if let Some((_, runtime_session_id)) = self.paused_sessions.remove(&slot) {
            info!(slot = %slot, runtime_session_id = %runtime_session_id, "resuming paused agent with stored runtime session id");
            match self
                .resume_item(slot.clone(), &runtime_session_id, text, &imgs, permissions)
                .await
            {
                Ok(()) => return Ok(()),
                Err(e) => {
                    warn!(slot = %slot, error = %e, "resume failed, will try fresh spawn fallback");
                    // Fall through to fresh spawn paths below
                }
            }
        }

        // Fallback: check DB for a runtime_session_id we can resume with
        if let Some(agent_type_str) = slot.agent_type_str() {
            let row: Option<(i64, Option<String>)> = sqlx::query_as(
                "SELECT id, runtime_session_id FROM agent_sessions \
                 WHERE feature_id = ? AND agent_type = ? AND status IN ('running', 'paused') \
                 ORDER BY id DESC LIMIT 1",
            )
            .bind(self.feature_id)
            .bind(agent_type_str)
            .fetch_optional(&self.read_pool)
            .await
            .ok()
            .flatten();

            if let Some((db_session_id, Some(ref rt_session_id))) = row {
                if !rt_session_id.is_empty() {
                    let runtime_sid = rt_session_id.clone();
                    info!(slot = %slot, db_session_id, runtime_session_id = %runtime_sid, "DB fallback: resuming paused agent with stored runtime session id");
                    self.active_items.insert(slot.clone(), db_session_id);
                    match self
                        .resume_item(slot.clone(), &runtime_sid, text, &imgs, permissions)
                        .await
                    {
                        Ok(()) => return Ok(()),
                        Err(e) => {
                            warn!(slot = %slot, error = %e, "DB resume failed, falling through to fresh spawn");
                            // Mark the stale session as completed so fresh spawn creates a new one
                            WsSessionPersistence::mark_completed_static(
                                &self.write_pool,
                                db_session_id,
                            )
                            .await;
                        }
                    }
                }
            }

            // No runtime_session_id or resume failed — restart the agent fresh
            if let Some((db_session_id, _)) = row {
                info!(slot = %slot, db_session_id, "no runtime_session_id — restarting agent fresh");
                WsSessionPersistence::mark_completed_static(&self.write_pool, db_session_id).await;
            }

            let sdk_type = slot.sdk_agent_type().unwrap();
            let system_prompt = slot.system_prompt().unwrap();
            info!(slot = %slot, agent_type = agent_type_str, "restarting pre-queue agent fresh (no resumable session)");
            return self
                .spawn_pre_queue_agent(
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
                )
                .await
                .map(|_| ());
        }

        // Fallback for queue items: look up runtime_session_id via workflow_queue.agent_session_id
        if let AgentSlot::QueueItem(item_id) = &slot {
            let row = repo::get_session_for_queue_item(&self.read_pool, *item_id)
                .await
                .ok()
                .flatten();

            if let Some((db_session_id, Some(ref rt_session_id))) = row {
                if !rt_session_id.is_empty() {
                    let runtime_sid = rt_session_id.clone();
                    info!(slot = %slot, db_session_id, runtime_session_id = %runtime_sid, "DB fallback: resuming paused queue item with stored runtime session id");
                    self.active_items.insert(slot.clone(), db_session_id);
                    match self
                        .resume_item(slot.clone(), &runtime_sid, text, &imgs, permissions)
                        .await
                    {
                        Ok(()) => return Ok(()),
                        Err(e) => {
                            warn!(slot = %slot, error = %e, "queue item resume failed");
                            // Mark stale session so retry can start fresh
                            WsSessionPersistence::mark_completed_static(
                                &self.write_pool,
                                db_session_id,
                            )
                            .await;
                            return Err(format!("Resume failed for queue item: {e}"));
                        }
                    }
                }
            }
        }

        Err(format!(
            "No query handle for slot {slot} — agent may need restart"
        ))
    }

    /// Resume a paused agent by spawning a new runtime process with `--resume`.
    pub(super) async fn resume_item(
        &self,
        slot: AgentSlot,
        runtime_session_id: &str,
        prompt: &str,
        images: &[ImagePayload],
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        self.interrupted_items.remove(&slot);

        let db_session_id = self
            .active_items
            .get(&slot)
            .map(|r| *r)
            .ok_or_else(|| format!("No active session for slot {slot}"))?;

        // Resolve agent_type_str — prefer the slot, fall back to DB
        let agent_type_str = match slot.agent_type_str() {
            Some(s) => s.to_string(),
            None => {
                let row: Option<(String,)> =
                    sqlx::query_as("SELECT agent_type FROM agent_sessions WHERE id = ?")
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
        let agent_type = agent_type_str
            .parse::<AgentType>()
            .unwrap_or(AgentType::Execute);

        // Build spawn context with --resume
        let ctx = self
            .build_spawn_context(
                slot.clone(),
                db_session_id,
                agent_type,
                &agent_type_str,
                None,
                Some(runtime_session_id),
                false,
                permissions,
                None,
            )
            .await?;

        let content_value = if prompt.is_empty() && images.is_empty() {
            serde_json::Value::String("Continue where you left off.".to_string())
        } else {
            build_content_value(prompt, images)
        };

        let adapter = runtime_adapter(&ctx.provider).ok_or_else(|| {
            format!(
                "No runtime adapter registered for provider '{}'",
                ctx.provider
            )
        })?;
        match adapter.spawn(content_value, ctx.runtime_config).await {
            Ok(mut runtime_session) => {
                let message_rx = runtime_session.take_message_rx();
                if let Some(pid) = runtime_session.pid() {
                    if let AgentSlot::QueueItem(item_id) = &slot {
                        let _ = crate::domain::features::repository::update_item_pid(
                            &self.write_pool,
                            *item_id,
                            pid as i64,
                        )
                        .await;
                    }
                }
                let query_handle = Arc::new(tokio::sync::Mutex::new(runtime_session));
                if let Some((_, old_query)) = self.queries.remove(&slot) {
                    warn!(slot = %slot, "closing existing query before resuming agent");
                    let mut old_query = old_query.lock().await;
                    old_query.close().await;
                }
                self.queries.insert(slot.clone(), query_handle);

                if let AgentSlot::QueueItem(item_id) = &slot {
                    let _ = repo::mark_item_running_only(&self.write_pool, *item_id).await;
                    self.send_item_update(*item_id).await;
                }

                let _ = sqlx::query("UPDATE agent_sessions SET status = 'running' WHERE id = ?")
                    .bind(db_session_id)
                    .execute(&self.write_pool)
                    .await;

                spawn_workflow_stream_reader(
                    slot.clone(),
                    db_session_id,
                    self.feature_id,
                    ctx.expected_mcp_server,
                    ctx.provider.clone(),
                    message_rx,
                    self.ws_sender.clone(),
                    self.write_pool.clone(),
                    self.active_items.clone(),
                    self.queries.clone(),
                    self.paused_sessions.clone(),
                    Some(ctx.model.as_str()),
                    self.turn_state_tx.clone(),
                );

                // Frontend needs an explicit running event so the per-agent
                // status flips back from "paused" to "running" without relying
                // on an optimistic client-side write. The runtime will produce
                // stream events shortly, but those don't touch agent.status.
                let running_env = WsEnvelope::new(
                    "workflow",
                    "agent_running",
                    to_value(WorkflowAgentStartedPayload {
                        feature_id: self.feature_id,
                        agent_slot: slot.clone(),
                        session_id: db_session_id,
                        agent_type: agent_type_str.clone(),
                    }),
                );
                let _ = self
                    .ws_sender
                    .send(Message::Text(String::from(running_env).into()));

                WsSessionPersistence::broadcast_turn_state(
                    &self.turn_state_tx,
                    self.feature_id,
                    "agent",
                );
                info!(slot = %slot, "agent resumed successfully");
                Ok(())
            }
            Err(e) => {
                error!(slot = %slot, error = %e, "failed to resume agent");
                let message = crate::domain::agents::discovery::cli_not_found_message(&e)
                    .unwrap_or_else(|| format!("Failed to resume agent: {e}"));
                Err(message)
            }
        }
    }
}
