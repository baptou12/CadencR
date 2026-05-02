//! Agent lifecycle management for workflow agents.
//!
//! Handles spawning, interrupting, resuming, and stream reading for both
//! pre-queue agents (plan, PRD, session, refine, review-fixer) and queue items.

use std::sync::Arc;

use dashmap::{DashMap, DashSet};
use sqlx::SqlitePool;
use tracing::{error, info, warn};

use axum::extract::ws::Message;

use crate::domain::agents::adapter::RuntimeSessionHandle;
use crate::domain::agents::runtime_adapter;
use crate::domain::features::models::QueueItem;
use crate::domain::features::repository as repo;
use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::agent_errors::persist_and_send_agent_error;
use crate::domain::workflow::engine::{
    send_feature_updated_envelope, to_value, AgentSlot, WsSender,
};
use crate::domain::workflow::permission_router::PermissionRouter;
use crate::domain::workflow::strategies::WorkflowStrategy;
use crate::domain::workflow::stream_reader::spawn_workflow_stream_reader;
use crate::domain::ws_session::handler::session_prompt::build_content_value;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

mod interrupt;
mod send_prompt;
mod spawn_context;

#[cfg(test)]
mod tests;

/// Holds the resolved context needed to spawn or resume an agent.
/// Built via `AgentManager::build_spawn_context` to deduplicate setup logic.
pub struct SpawnContext {
    pub model: String,
    pub provider: String,
    pub runtime_config: crate::domain::agents::adapter::RuntimeSpawnConfig,
    pub expected_mcp_server: String,
}

/// Manages agent lifecycle: spawning, interrupting, resuming, and cleanup.
pub struct AgentManager {
    pub feature_id: i64,
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
    pub session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
    /// AgentSlot → runtime session handle (for interrupt/stream_input)
    pub queries: Arc<DashMap<AgentSlot, RuntimeSessionHandle>>,
    /// AgentSlot → db_session_id
    pub active_items: Arc<DashMap<AgentSlot, i64>>,
    /// Items that were explicitly interrupted (to distinguish from normal completion).
    pub interrupted_items: Arc<DashSet<AgentSlot>>,
    /// AgentSlot → Claude Code session ID (for --resume after interrupt)
    pub paused_sessions: Arc<DashMap<AgentSlot, String>>,
}

impl AgentManager {
    pub fn new(
        feature_id: i64,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        ws_sender: WsSender,
        session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
    ) -> Self {
        Self {
            feature_id,
            read_pool,
            write_pool,
            ws_sender,
            session_status_tx,
            queries: Arc::new(DashMap::new()),
            active_items: Arc::new(DashMap::new()),
            interrupted_items: Arc::new(DashSet::new()),
            paused_sessions: Arc::new(DashMap::new()),
        }
    }

    /// Shared logic for spawning plan/PRD agents (pre-queue agents).
    pub async fn spawn_pre_queue_agent(
        &self,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: &str,
        initial_prompt: &str,
        images: &[ImagePayload],
        slot_fn: impl FnOnce(i64) -> AgentSlot,
        permissions: &PermissionRouter,
    ) -> Result<i64, String> {
        self.spawn_pre_queue_agent_with_display(
            agent_type,
            agent_type_str,
            system_prompt,
            initial_prompt,
            None,
            images,
            slot_fn,
            permissions,
        )
        .await
    }

    /// Like `spawn_pre_queue_agent`, but accepts an optional display message
    /// to persist and show in the UI instead of the (potentially enriched) initial_prompt.
    pub async fn spawn_pre_queue_agent_with_display(
        &self,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: &str,
        initial_prompt: &str,
        user_display_message: Option<&str>,
        images: &[ImagePayload],
        slot_fn: impl FnOnce(i64) -> AgentSlot,
        permissions: &PermissionRouter,
    ) -> Result<i64, String> {
        info!(
            feature_id = self.feature_id,
            agent_type = agent_type_str,
            "spawning pre-queue agent"
        );

        // 1. Create agent session in DB
        let now = chrono::Utc::now().to_rfc3339();
        let db_session_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at, permission_mode) VALUES (?, ?, 'running', ?, 'acceptEdits') RETURNING id",
        )
        .bind(self.feature_id)
        .bind(agent_type_str)
        .bind(&now)
        .fetch_one(&self.write_pool)
        .await
        .map_err(|e| format!("Failed to create {agent_type_str} agent session: {e}"))?;

        let slot = slot_fn(db_session_id);

        // 2. Build spawn context (MCP, CWD, permissions, model, options)
        let ctx = self
            .build_spawn_context(
                slot.clone(),
                db_session_id,
                agent_type,
                agent_type_str,
                Some(system_prompt),
                None,
                true,
                permissions,
                None,
            )
            .await?;

        // 3. Persist the initial user prompt and send it to the frontend
        let display_msg = user_display_message.unwrap_or(initial_prompt);
        {
            let p = WsSessionPersistence::with_session_id(
                self.write_pool.clone(),
                self.feature_id,
                Some(db_session_id),
            );
            p.persist_user_message(display_msg).await;
        }
        self.send_user_message_event(slot.clone(), db_session_id, display_msg);

        let content_value = build_content_value(initial_prompt, images);

        // 4. Spawn query and start stream reader
        let adapter = runtime_adapter(&ctx.provider).ok_or_else(|| {
            format!(
                "No runtime adapter registered for provider '{}'",
                ctx.provider
            )
        })?;
        match adapter.spawn(content_value, ctx.runtime_config).await {
            Ok(mut runtime_session) => {
                let message_rx = runtime_session.take_message_rx();
                let query_handle = Arc::new(tokio::sync::Mutex::new(runtime_session));
                if let Some((_, old_query)) = self.queries.remove(&slot) {
                    warn!(slot = %slot, "closing existing query before spawning new pre-queue agent");
                    let mut old_query = old_query.lock().await;
                    old_query.close().await;
                }
                self.queries.insert(slot.clone(), query_handle);
                self.active_items.insert(slot.clone(), db_session_id);

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
                    self.session_status_tx.clone(),
                );

                WsSessionPersistence::broadcast_session_status(
                    &self.session_status_tx,
                    db_session_id,
                    self.feature_id,
                    crate::domain::session_status::AgentStatus::Agent,
                    None,
                );

                let envelope = WsEnvelope::new(
                    "workflow",
                    "agent_started",
                    to_value(WorkflowAgentStartedPayload {
                        feature_id: self.feature_id,
                        agent_slot: slot,
                        session_id: db_session_id,
                        agent_type: agent_type_str.to_string(),
                    }),
                );
                let _ = self
                    .ws_sender
                    .send(Message::Text(String::from(envelope).into()));
                info!(
                    feature_id = self.feature_id,
                    db_session_id,
                    agent_type = agent_type_str,
                    "pre-queue agent spawned"
                );
                Ok(db_session_id)
            }
            Err(e) => {
                let message = format!("Runtime spawn failed for {agent_type_str}: {e}");
                error!(feature_id = self.feature_id, agent_type = agent_type_str, error = %message, "failed to spawn pre-queue agent");
                persist_and_send_agent_error(
                    &self.write_pool,
                    &self.ws_sender,
                    &slot,
                    db_session_id,
                    &message,
                )
                .await;
                WsSessionPersistence::mark_error_static(&self.write_pool, db_session_id).await;
                WsSessionPersistence::broadcast_session_status(
                    &self.session_status_tx,
                    db_session_id,
                    self.feature_id,
                    crate::domain::session_status::AgentStatus::Idle,
                    None,
                );
                Err(message)
            }
        }
    }

    /// Start executing a single queue item by spawning an agent.
    pub async fn start_item(
        &self,
        item: QueueItem,
        strategy: &dyn WorkflowStrategy,
        autonomy: u8,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        let item_id = item.id;
        info!(feature_id = self.feature_id, item_id, item_type = %item.item_type, "starting queue item");

        // 1. Mark running in DB
        repo::mark_item_running(&self.write_pool, item_id)
            .await
            .map_err(|e| e.to_string())?;

        self.send_item_update(item_id).await;

        // 2. Delegate to strategy
        let agent_type = strategy.agent_type_for_item(&item.item_type, item.config.as_deref())?;
        let system_prompt = strategy
            .build_system_prompt(&self.read_pool, &item, autonomy)
            .await?;
        let feature_title = self.get_feature_title().await.unwrap_or_default();
        let initial_prompt = strategy
            .build_initial_prompt(&self.read_pool, &item, &feature_title, autonomy)
            .await?;

        // 3. Create agent session in DB
        let now = chrono::Utc::now().to_rfc3339();
        let agent_type_str = format!("{:?}", agent_type).to_lowercase();
        let db_session_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at, permission_mode) VALUES (?, ?, 'running', ?, 'acceptEdits') RETURNING id",
        )
        .bind(self.feature_id)
        .bind(&agent_type_str)
        .bind(&now)
        .fetch_one(&self.write_pool)
        .await
        .map_err(|e| format!("Failed to create agent session: {e}"))?;

        repo::set_item_agent_session(&self.write_pool, item_id, db_session_id)
            .await
            .map_err(|e| format!("Failed to link session to queue item: {e}"))?;

        // 4. Build spawn context (MCP, CWD, permissions, model, options)
        // Extract workflow-specific config from the queue item's config JSON
        let config_json: Option<serde_json::Value> = item
            .config
            .as_deref()
            .and_then(|c| serde_json::from_str(c).ok());
        let model_override_owned = config_json
            .as_ref()
            .and_then(|c| c.get("model_override"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let include_mcp = false;
        let slot = AgentSlot::QueueItem(item_id);
        let ctx = self
            .build_spawn_context(
                slot.clone(),
                db_session_id,
                agent_type,
                &agent_type_str,
                Some(system_prompt.as_str()),
                None,
                include_mcp,
                permissions,
                model_override_owned.as_deref(),
            )
            .await?;

        // 5. Persist the initial user prompt and send it to the frontend
        {
            let p = WsSessionPersistence::with_session_id(
                self.write_pool.clone(),
                self.feature_id,
                Some(db_session_id),
            );
            p.persist_user_message(&initial_prompt).await;
        }
        self.send_user_message_event(slot.clone(), db_session_id, &initial_prompt);

        let content_value = serde_json::Value::String(initial_prompt);

        // 6. Spawn query and start stream reader
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
                    if let Err(e) =
                        repo::update_item_pid(&self.write_pool, item_id, pid as i64).await
                    {
                        warn!(item_id, error = %e, "failed to persist agent PID");
                    }
                }
                let query_handle = Arc::new(tokio::sync::Mutex::new(runtime_session));
                if let Some((_, old_query)) = self.queries.remove(&slot) {
                    warn!(slot = %slot, "closing existing query before spawning new queue item agent");
                    let mut old_query = old_query.lock().await;
                    old_query.close().await;
                }
                self.queries.insert(slot.clone(), query_handle);
                self.active_items.insert(slot.clone(), db_session_id);

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
                    self.session_status_tx.clone(),
                );

                WsSessionPersistence::broadcast_session_status(
                    &self.session_status_tx,
                    db_session_id,
                    self.feature_id,
                    crate::domain::session_status::AgentStatus::Agent,
                    None,
                );

                let envelope = WsEnvelope::new(
                    "workflow",
                    "item_started",
                    to_value(WorkflowItemStartedPayload {
                        feature_id: self.feature_id,
                        agent_slot: slot,
                        session_id: db_session_id,
                        item_type: item.item_type.clone(),
                    }),
                );
                let _ = self
                    .ws_sender
                    .send(Message::Text(String::from(envelope).into()));
                info!(item_id, db_session_id, "queue item agent spawned");
                Ok(())
            }
            Err(e) => {
                let message = format!("Runtime spawn failed: {e}");
                error!(item_id, error = %message, "failed to spawn agent for queue item");
                persist_and_send_agent_error(
                    &self.write_pool,
                    &self.ws_sender,
                    &slot,
                    db_session_id,
                    &message,
                )
                .await;
                // Clean up DB state: mark session as error, reset queue item
                WsSessionPersistence::mark_error_static(&self.write_pool, db_session_id).await;
                let _ = repo::mark_item_error(&self.write_pool, item_id, Some(&message)).await;
                self.send_item_update(item_id).await;
                WsSessionPersistence::broadcast_session_status(
                    &self.session_status_tx,
                    db_session_id,
                    self.feature_id,
                    crate::domain::session_status::AgentStatus::Idle,
                    None,
                );
                Err(message)
            }
        }
    }

    /// Get the feature title from DB.
    pub async fn get_feature_title(&self) -> Option<String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT title FROM features WHERE id = ?")
            .bind(self.feature_id)
            .fetch_optional(&self.read_pool)
            .await
            .ok()?;
        row.map(|(t,)| t)
    }

    /// Send the initial user message to the frontend.
    fn send_user_message_event(&self, slot: AgentSlot, session_id: i64, content: &str) {
        let envelope = WsEnvelope::new(
            "workflow",
            "agent_user_message",
            serde_json::json!({
                "agent_slot": slot,
                "session_id": session_id,
                "content": content,
            }),
        );
        let _ = self
            .ws_sender
            .send(Message::Text(String::from(envelope).into()));
    }

    /// Send a differential item update envelope.
    pub async fn send_item_update(&self, item_id: i64) {
        match repo::get_queue_item(&self.write_pool, item_id).await {
            Ok(Some(item)) => {
                let envelope = WsEnvelope::new(
                    "workflow",
                    "item_update",
                    to_value(WorkflowItemUpdatePayload {
                        feature_id: self.feature_id,
                        id: item.id,
                        status: item.status,
                        started_at: item.started_at,
                        ended_at: item.ended_at,
                        result: item.result,
                        agent_session_id: item.agent_session_id,
                    }),
                );
                let _ = self
                    .ws_sender
                    .send(Message::Text(String::from(envelope).into()));
            }
            Ok(None) => {
                warn!(item_id, "send_item_update: item not found");
            }
            Err(e) => {
                error!(item_id, error = %e, "send_item_update: DB error");
            }
        }
    }

    /// Broadcast a `feature.updated` event to the frontend.
    pub fn send_feature_updated(&self, changed: &[&str]) {
        send_feature_updated_envelope(&self.ws_sender, self.feature_id, changed);
    }
}
