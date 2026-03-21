//! Agent lifecycle management for workflow agents.
//!
//! Handles spawning, interrupting, resuming, and stream reading for both
//! pre-queue agents (plan, PRD, session, refine, review-fixer) and queue items.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use dashmap::{DashMap, DashSet};
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use axum::extract::ws::Message;
use claude_agent_sdk_rs::{Options, PermissionMode, Query, SdkError, SdkMessage, SystemMessage};

use crate::domain::features::models::QueueItem;
use crate::domain::features::repository as repo;
use crate::domain::mcp::servers::{AgentType, mcp_server_name};
use crate::domain::workspace::repository as workspace_repo;
use crate::domain::workflow::engine::{AgentSlot, WsSender};
use crate::domain::workflow::permission_router::{PermissionRouter, WorkflowPermissionBridge};
use crate::domain::workflow::strategies::WorkflowStrategy;
use crate::domain::ws_session::handler::mcp_spawn::build_mcp_server_config;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::permissions;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use super::engine::{send_feature_updated_envelope, to_value};

/// Manages agent lifecycle: spawning, interrupting, resuming, and cleanup.
pub struct AgentManager {
    pub feature_id: i64,
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
    pub turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    /// AgentSlot → Query handle (for interrupt/stream_input)
    pub queries: Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
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
        turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    ) -> Self {
        Self {
            feature_id,
            read_pool,
            write_pool,
            ws_sender,
            turn_state_tx,
            queries: Arc::new(DashMap::new()),
            active_items: Arc::new(DashMap::new()),
            interrupted_items: Arc::new(DashSet::new()),
            paused_sessions: Arc::new(DashMap::new()),
        }
    }

    /// Create a new AgentManager sharing in-memory state (queries, active_items,
    /// interrupted_items, paused_sessions) but with a new WsSender.
    pub fn reconnect_with_sender(old: &AgentManager, new_sender: WsSender) -> Self {
        Self {
            feature_id: old.feature_id,
            read_pool: old.read_pool.clone(),
            write_pool: old.write_pool.clone(),
            ws_sender: new_sender,
            turn_state_tx: old.turn_state_tx.clone(),
            queries: Arc::clone(&old.queries),
            active_items: Arc::clone(&old.active_items),
            interrupted_items: Arc::clone(&old.interrupted_items),
            paused_sessions: Arc::clone(&old.paused_sessions),
        }
    }

    /// Get the feature's working directory.
    /// Prefers worktree_path from feature_settings if set, otherwise falls back to project directory.
    pub async fn get_feature_cwd(&self) -> Option<PathBuf> {
        let wt_row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()?;
        if let Some(Some(wt_path)) = wt_row.map(|(v,)| v) {
            if !wt_path.is_empty() {
                return Some(PathBuf::from(wt_path));
            }
        }
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT p.path FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()?;
        row.and_then(|(d,)| d).map(PathBuf::from)
    }

    /// Resolve the model for a given agent type using the cascade:
    /// feature column → project column → global settings → default.
    ///
    /// The literal value "default" is treated as unset and falls through.
    async fn resolve_model(&self, agent_type_str: &str) -> String {
        const DEFAULT_MODEL: &str = "claude-opus-4-6";
        let db_key = format!("model_{agent_type_str}");

        // 1. Feature-level (real column on features table)
        let feature_val: Option<(Option<String>,)> = sqlx::query_as(
            &format!(r#"SELECT "{db_key}" as v FROM features WHERE id = ?"#),
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()
        .flatten();
        if let Some((Some(ref v),)) = feature_val {
            if !v.is_empty() && v != "default" {
                return v.clone();
            }
        }

        // 2. Project-level (real column on projects table)
        let project_val: Option<(Option<String>,)> = sqlx::query_as(
            &format!(
                r#"SELECT p."{db_key}" as v FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?"#,
            ),
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()
        .flatten();
        if let Some((Some(ref v),)) = project_val {
            if !v.is_empty() && v != "default" {
                return v.clone();
            }
        }

        // 3. Global settings (EAV table)
        if let Ok(Some(v)) = workspace_repo::get_setting(&self.read_pool, &db_key).await {
            if !v.is_empty() && v != "default" {
                return v;
            }
        }

        DEFAULT_MODEL.to_string()
    }

    /// Shared logic for spawning plan/PRD agents (pre-queue agents).
    pub async fn spawn_pre_queue_agent(
        &self,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: &str,
        initial_prompt: &str,
        slot: AgentSlot,
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

        // 2. Build MCP config
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);

        // 3. Resolve cwd
        let cwd = self
            .get_feature_cwd()
            .await
            .ok_or_else(|| format!("No working directory found for feature {}. Was ensure_worktree called?", self.feature_id))?;

        // 4. Set up permission bridge
        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResponse>(16);
        permissions.register(slot.clone(), perm_tx);
        let allowed_patterns = Arc::new(permissions::load_allowed_patterns(&cwd));
        let bridge = WorkflowPermissionBridge {
            slot: slot.clone(),
            feature_id: self.feature_id,
            sender: self.ws_sender.clone(),
            response_rx: Arc::new(tokio::sync::Mutex::new(perm_rx)),
            worktree_path: cwd.clone(),
            session_cache: Arc::new(tokio::sync::Mutex::new(HashSet::new())),
            allowed_patterns,
            read_pool: self.read_pool.clone(),
            write_pool: self.write_pool.clone(),
            db_session_id,
            turn_state_tx: self.turn_state_tx.clone(),
        };

        // 5. Resolve model from feature → project → global → default
        let model = self.resolve_model(agent_type_str).await;
        info!(feature_id = self.feature_id, agent_type = agent_type_str, model = %model, "resolved model for pre-queue agent");

        // Persist model to agent session
        let _ = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(&model)
            .bind(db_session_id)
            .execute(&self.write_pool)
            .await;

        // 6. Build options and spawn
        let mut options = Options {
            cwd,
            permission_mode: Some(PermissionMode::AcceptEdits),
            model: Some(model),
            system_prompt: if system_prompt.is_empty() {
                None
            } else {
                Some(format!(
                    "{system_prompt}\n\n## Feature Context\n\nYour feature_id is **{}**. \
                     The MCP tools will auto-resolve plan_id from your feature — you do NOT need to pass plan_id to any tool. \
                     Just omit it and the correct plan will be used automatically.",
                    self.feature_id
                ))
            },
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        // Persist the initial user prompt and send it to the frontend
        {
            let p = WsSessionPersistence::with_session_id(
                self.write_pool.clone(),
                self.feature_id,
                Some(db_session_id),
            );
            p.persist_user_message(initial_prompt).await;
        }
        self.send_user_message_event(slot.clone(), db_session_id, initial_prompt);

        let content_value = serde_json::Value::String(initial_prompt.to_string());

        match claude_agent_sdk_rs::query(content_value, options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();

                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                self.queries.insert(slot.clone(), query_handle);
                self.active_items.insert(slot.clone(), db_session_id);

                spawn_workflow_stream_reader(
                    slot.clone(),
                    db_session_id,
                    self.feature_id,
                    mcp_server_name(agent_type).to_string(),
                    message_rx,
                    self.ws_sender.clone(),
                    self.write_pool.clone(),
                    self.active_items.clone(),
                    self.queries.clone(),
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
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

                info!(
                    feature_id = self.feature_id,
                    db_session_id,
                    agent_type = agent_type_str,
                    "pre-queue agent spawned"
                );
                Ok(db_session_id)
            }
            Err(e) => {
                error!(
                    feature_id = self.feature_id,
                    agent_type = agent_type_str,
                    error = %e,
                    "failed to spawn pre-queue agent"
                );
                let _ = WsSessionPersistence::mark_paused_static(&self.write_pool, db_session_id).await;
                Err(format!("SDK spawn failed for {agent_type_str}: {e}"))
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
        let agent_type = strategy.agent_type_for_item(&item.item_type)?;
        let system_prompt = strategy.build_system_prompt(&self.read_pool, &item, autonomy).await?;
        let feature_title = self.get_feature_title().await.unwrap_or_default();
        let initial_prompt = strategy
            .build_initial_prompt(&self.read_pool, &item, &feature_title)
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

        sqlx::query("UPDATE workflow_queue SET agent_session_id = ? WHERE id = ?")
            .bind(db_session_id)
            .bind(item_id)
            .execute(&self.write_pool)
            .await
            .map_err(|e| format!("Failed to link session to queue item: {e}"))?;

        // 4. Build MCP config
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);

        // 5. Resolve cwd
        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!("No working directory found for feature {}. Was ensure_worktree called?", self.feature_id)
        })?;

        // 6. Set up permission bridge
        let slot = AgentSlot::QueueItem(item_id);
        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResponse>(16);
        permissions.register(slot.clone(), perm_tx);
        let allowed_patterns = Arc::new(permissions::load_allowed_patterns(&cwd));
        let bridge = WorkflowPermissionBridge {
            slot: slot.clone(),
            feature_id: self.feature_id,
            sender: self.ws_sender.clone(),
            response_rx: Arc::new(tokio::sync::Mutex::new(perm_rx)),
            worktree_path: cwd.clone(),
            session_cache: Arc::new(tokio::sync::Mutex::new(HashSet::new())),
            allowed_patterns,
            read_pool: self.read_pool.clone(),
            write_pool: self.write_pool.clone(),
            db_session_id,
            turn_state_tx: self.turn_state_tx.clone(),
        };

        // 7. Resolve model from feature → project → global → default
        let model = self.resolve_model(&agent_type_str).await;
        info!(feature_id = self.feature_id, agent_type = %agent_type_str, model = %model, "resolved model for queue item");

        // Persist model to agent session
        let _ = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(&model)
            .bind(db_session_id)
            .execute(&self.write_pool)
            .await;

        // 8. Build Options and spawn
        let mut options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::AcceptEdits),
            model: Some(model),
            system_prompt: if system_prompt.is_empty() { None } else { Some(system_prompt) },
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        // Persist the initial user prompt and send it to the frontend
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

        match claude_agent_sdk_rs::query(content_value, options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();

                if let Some(pid) = real_query.pid() {
                    if let Err(e) = repo::update_item_pid(&self.write_pool, item_id, pid as i64).await {
                        warn!(item_id, error = %e, "failed to persist agent PID");
                    }
                }

                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                self.queries.insert(slot.clone(), query_handle);
                self.active_items.insert(slot.clone(), db_session_id);

                spawn_workflow_stream_reader(
                    slot.clone(),
                    db_session_id,
                    self.feature_id,
                    mcp_server_name(agent_type).to_string(),
                    message_rx,
                    self.ws_sender.clone(),
                    self.write_pool.clone(),
                    self.active_items.clone(),
                    self.queries.clone(),
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
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

                info!(item_id, db_session_id, "queue item agent spawned");
                Ok(())
            }
            Err(e) => {
                error!(item_id, error = %e, "failed to spawn agent for queue item");
                Err(format!("SDK spawn failed: {e}"))
            }
        }
    }

    /// Interrupt a running queue item.
    /// Fast path: use in-memory Query handle. Fallback: PID from DB.
    pub async fn interrupt_item(&self, slot: AgentSlot) -> Result<(), String> {
        self.interrupted_items.insert(slot.clone());

        // Capture Claude Code session ID NOW while the query handle still exists
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            if let Some(cc_session_id) = q.session_id().await {
                debug!(slot = %slot, cc_session_id = %cc_session_id, "captured Claude session ID for resume");
                self.paused_sessions.insert(slot.clone(), cc_session_id);
            }
            return q.interrupt().await.map_err(|e| format!("Interrupt failed: {e}"));
        }
        // Fallback: PID from DB — only for real queue items
        if let AgentSlot::QueueItem(item_id) = &slot {
            return self.interrupt_by_pid(*item_id).await;
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
        warn!(queue_item_id, "falling back to PID-based interrupt (no in-memory Query handle)");

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

    /// Send a follow-up prompt to a running workflow agent.
    pub async fn send_prompt(
        &self,
        slot: AgentSlot,
        text: &str,
        _images: Option<Vec<String>>,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        // Fast path: agent is still running, send via stdin
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            let content = serde_json::Value::String(text.to_string());
            q.stream_input(content).await.map_err(|e| format!("stream_input failed: {e}"))?;
            return Ok(());
        }

        // Slow path: agent was paused, resume by spawning new process
        if let Some((_, cc_session_id)) = self.paused_sessions.remove(&slot) {
            info!(slot = %slot, cc_session_id = %cc_session_id, "resuming paused agent with --resume");
            return self.resume_item(slot, &cc_session_id, text, permissions).await;
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
                    return self.resume_item(slot, &cc_sid, text, permissions).await;
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
                slot,
                permissions,
            ).await.map(|_| ());
        }

        Err(format!("No query handle for slot {slot} — agent may need restart"))
    }

    /// Resume a paused agent by spawning a new Claude Code process with `--resume`.
    async fn resume_item(
        &self,
        slot: AgentSlot,
        cc_session_id: &str,
        prompt: &str,
        permissions: &PermissionRouter,
    ) -> Result<(), String> {
        let db_session_id = self.active_items.get(&slot)
            .map(|r| *r)
            .ok_or_else(|| format!("No active session for slot {slot}"))?;

        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!("No working directory found for feature {}", self.feature_id)
        })?;

        let agent_type = slot.sdk_agent_type().unwrap_or(AgentType::Execute);
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);

        // Resolve model: use agent_type_str from slot, or look up from DB session
        let agent_type_str_for_model = match slot.agent_type_str() {
            Some(s) => s.to_string(),
            None => {
                // Queue item — look up agent_type from the session row
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
        let model = self.resolve_model(&agent_type_str_for_model).await;
        info!(feature_id = self.feature_id, agent_type = %agent_type_str_for_model, model = %model, "resolved model for resumed agent");

        // Persist model to agent session
        let _ = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(&model)
            .bind(db_session_id)
            .execute(&self.write_pool)
            .await;

        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResponse>(16);
        permissions.register(slot.clone(), perm_tx);
        let allowed_patterns = Arc::new(permissions::load_allowed_patterns(&cwd));
        let bridge = WorkflowPermissionBridge {
            slot: slot.clone(),
            feature_id: self.feature_id,
            sender: self.ws_sender.clone(),
            response_rx: Arc::new(tokio::sync::Mutex::new(perm_rx)),
            worktree_path: cwd.clone(),
            session_cache: Arc::new(tokio::sync::Mutex::new(HashSet::new())),
            allowed_patterns,
            read_pool: self.read_pool.clone(),
            write_pool: self.write_pool.clone(),
            db_session_id,
            turn_state_tx: self.turn_state_tx.clone(),
        };

        let mut options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::AcceptEdits),
            model: Some(model),
            resume: Some(cc_session_id.to_string()),
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        let content_value = if prompt.is_empty() {
            serde_json::Value::String("Continue where you left off.".to_string())
        } else {
            serde_json::Value::String(prompt.to_string())
        };

        match claude_agent_sdk_rs::query(content_value, options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();

                if let Some(pid) = real_query.pid() {
                    if let AgentSlot::QueueItem(item_id) = &slot {
                        let _ = repo::update_item_pid(&self.write_pool, *item_id, pid as i64).await;
                    }
                }

                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
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
                    slot.clone(),
                    db_session_id,
                    self.feature_id,
                    mcp_server_name(agent_type).to_string(),
                    message_rx,
                    self.ws_sender.clone(),
                    self.write_pool.clone(),
                    self.active_items.clone(),
                    self.queries.clone(),
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

    /// Clean up state for an agent slot (remove from all tracking maps).
    pub fn cleanup_agent(&self, slot: &AgentSlot) {
        self.active_items.remove(slot);
        self.queries.remove(slot);
        self.paused_sessions.remove(slot);
    }

    /// Mark a running agent as done (clean shutdown).
    pub async fn mark_done(&self, slot: AgentSlot) -> Result<(), String> {
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            let _ = q.interrupt().await;
        }

        self.active_items.remove(&slot);
        self.queries.remove(&slot);

        if let AgentSlot::QueueItem(item_id) = &slot {
            if let Err(e) = repo::mark_item_completed(&self.write_pool, *item_id, Some("Marked done by user")).await {
                warn!(slot = %slot, error = %e, "failed to mark item completed on mark_done");
            }
            self.send_item_update(*item_id).await;
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
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        Ok(())
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
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
    }

    /// Send a differential item update envelope.
    pub async fn send_item_update(&self, item_id: i64) {
        match repo::get_queue_item(&self.read_pool, item_id).await {
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
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
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

/// Spawn a background task that reads agent stream messages and forwards them
/// via the workflow domain, then triggers engine callbacks on completion/error.
pub fn spawn_workflow_stream_reader(
    slot: AgentSlot,
    db_session_id: i64,
    feature_id: i64,
    expected_mcp_server: String,
    mut message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,
    sender: WsSender,
    write_pool: SqlitePool,
    active_items: Arc<DashMap<AgentSlot, i64>>,
    queries: Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
) {
    tokio::spawn(async move {
        debug!(slot = %slot, db_session_id, "workflow stream reader started");
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        let mut completed_ok = false;
        let mut error_msg: Option<String> = None;
        let mut needs_session_id_capture = true;
        let mut pending_feature_update: Option<Vec<&'static str>> = None;

        loop {
            match message_rx.recv().await {
                Some(Ok(sdk_msg)) => {
                    // Capture claude_session_id from the first message
                    if needs_session_id_capture {
                        if let Some(cli_sid) = sdk_msg.session_id() {
                            if !cli_sid.is_empty() {
                                needs_session_id_capture = false;
                                debug!(slot = %slot, db_session_id, claude_session_id = %cli_sid, "persisting CLI session_id to DB");
                                WsSessionPersistence::persist_claude_session_id_static(
                                    &write_pool, db_session_id, cli_sid,
                                ).await;
                                let sid_env = WsEnvelope::new(
                                    "workflow",
                                    "agent_session_id",
                                    serde_json::json!({
                                        "agent_slot": &slot,
                                        "session_id": db_session_id,
                                        "claude_session_id": cli_sid,
                                    }),
                                );
                                let _ = sender.send(Message::Text(String::from(sid_env).into()));
                            }
                        }
                    }

                    // Check MCP server status on init
                    if let SdkMessage::System(SystemMessage::Init { ref mcp_servers, ref tools, .. }) = sdk_msg {
                        debug!(slot = %slot, ?mcp_servers, tool_count = tools.len(), "received init message from CLI");
                        let server_status = mcp_servers.iter().find(|s| s.name == expected_mcp_server);
                        let mcp_ok = server_status.map_or(false, |s| s.status == "connected");
                        if !mcp_ok {
                            let status_detail = match server_status {
                                Some(s) => format!("status: {}", s.status),
                                None => "server not found in init".to_string(),
                            };
                            let err = format!(
                                "MCP server '{}' failed to connect ({}). The agent cannot function without its tools.",
                                expected_mcp_server, status_detail
                            );
                            error!(slot = %slot, %err, "MCP server not connected");
                            error_msg = Some(err.clone());
                            WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
                            let err_env = WsEnvelope::new(
                                "workflow",
                                "agent_stream",
                                to_value(WorkflowAgentStreamErrorPayload {
                                    agent_slot: slot.clone(),
                                    session_id: db_session_id,
                                    msg_type: "error".into(),
                                    error: err,
                                }),
                            );
                            let _ = sender.send(Message::Text(String::from(err_env).into()));
                            if let Some(query_handle) = queries.get(&slot) {
                                let q = query_handle.value().lock().await;
                                let _ = q.interrupt().await;
                            }
                            break;
                        }
                        debug!(slot = %slot, server = %expected_mcp_server, "MCP server connected");
                    }

                    // Persist message
                    persistence.persist_sdk_message(&sdk_msg).await;

                    // Extract usage
                    if let Some(usage) = sdk_msg.usage() {
                        let total_input = usage.input_tokens
                            + usage.cache_creation_input_tokens.unwrap_or(0)
                            + usage.cache_read_input_tokens.unwrap_or(0);
                        let total_output = usage.output_tokens;
                        WsSessionPersistence::update_token_usage(
                            &write_pool,
                            db_session_id,
                            total_input,
                            total_output,
                        )
                        .await;
                    }

                    let envelope = match &sdk_msg {
                        SdkMessage::Result { .. } => {
                            debug!(slot = %slot, "received SDK Result message — marking completed_ok");
                            completed_ok = true;
                            WsSessionPersistence::mark_completed_static(
                                &write_pool,
                                db_session_id,
                            )
                            .await;
                            WsEnvelope::new(
                                "workflow",
                                "agent_stream",
                                to_value(WorkflowAgentStreamResultPayload {
                                    agent_slot: slot.clone(),
                                    session_id: db_session_id,
                                    msg_type: "result".into(),
                                }),
                            )
                        }
                        _ => {
                            let block = serde_json::to_value(&sdk_msg).unwrap_or_default();
                            WsEnvelope::new(
                                "workflow",
                                "agent_stream",
                                to_value(WorkflowAgentStreamBlocksPayload {
                                    agent_slot: slot.clone(),
                                    session_id: db_session_id,
                                    blocks: vec![block],
                                }),
                            )
                        }
                    };

                    if sender.send(Message::Text(String::from(envelope).into())).is_err() {
                        warn!(slot = %slot, "WS sender closed, stopping workflow stream reader");
                        break;
                    }

                    if completed_ok {
                        debug!(slot = %slot, "breaking out of stream loop after Result");
                        break;
                    }

                    // Live-refresh: detect plan/phase-modifying tool calls
                    match &sdk_msg {
                        SdkMessage::Assistant { message, .. } => {
                            use claude_agent_sdk_rs::types::ContentBlock;
                            let mut fields: Vec<&'static str> = Vec::new();
                            for block in &message.content {
                                if let ContentBlock::ToolUse { name, .. } = block {
                                    if name.contains("create_phase") || name.contains("finalize_phases") {
                                        fields.extend_from_slice(&["phases", "progress"]);
                                    } else if name.contains("finalize_plan") {
                                        fields.extend_from_slice(&["plan", "phases", "progress", "status"]);
                                    } else if name.contains("save_plan") || name.contains("create_plan") {
                                        fields.extend_from_slice(&["plan"]);
                                    } else if name.contains("save_prd") || name.contains("create_prd") {
                                        fields.extend_from_slice(&["prd"]);
                                    }
                                }
                            }
                            if !fields.is_empty() {
                                fields.dedup();
                                pending_feature_update = Some(fields);
                            }
                        }
                        SdkMessage::User { .. } => {
                            if let Some(fields) = pending_feature_update.take() {
                                send_feature_updated_envelope(&sender, feature_id, &fields);
                            }
                        }
                        SdkMessage::ToolUseSummary { ref data, .. } => {
                            if let Some(tool_name) = data.get("tool_name").and_then(|v| v.as_str()) {
                                let changed: Option<&[&str]> = match tool_name {
                                    t if t.contains("create_phase") || t.contains("finalize_phases") => {
                                        Some(&["phases", "progress"])
                                    }
                                    t if t.contains("finalize_plan") => {
                                        Some(&["plan", "phases", "progress", "status"])
                                    }
                                    t if t.contains("save_plan") || t.contains("create_plan") => {
                                        Some(&["plan"])
                                    }
                                    t if t.contains("save_prd") || t.contains("create_prd") => {
                                        Some(&["prd"])
                                    }
                                    _ => None,
                                };
                                if let Some(fields) = changed {
                                    send_feature_updated_envelope(&sender, feature_id, fields);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Some(Err(e)) => {
                    error!(slot = %slot, error = %e, "workflow SDK stream error");
                    error_msg = Some(e.to_string());
                    WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
                    let err_env = WsEnvelope::new(
                        "workflow",
                        "agent_stream",
                        to_value(WorkflowAgentStreamErrorPayload {
                            agent_slot: slot.clone(),
                            session_id: db_session_id,
                            msg_type: "error".into(),
                            error: e.to_string(),
                        }),
                    );
                    let _ = sender.send(Message::Text(String::from(err_env).into()));
                    break;
                }
                None => {
                    if completed_ok {
                        debug!(slot = %slot, "workflow SDK stream closed after result");
                    } else {
                        warn!(slot = %slot, "workflow SDK stream closed unexpectedly without result");
                        error_msg = Some("Agent stream closed unexpectedly without result".to_string());
                    }
                    break;
                }
            }
        }

        // Post-stream cleanup: remove query handle
        queries.remove(&slot);

        // Post-stream callbacks — delegate to the real engine from the registry
        debug!(slot = %slot, completed_ok, has_error = error_msg.is_some(), "stream reader post-loop: dispatching callbacks");
        if completed_ok {
            if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
                engine.on_item_completed(slot, None).await;
            } else {
                warn!(slot = %slot, feature_id, "no engine found for on_item_completed");
                let legacy_id = slot.as_legacy_id();
                active_items.remove(&slot);
                if let Err(e) = repo::mark_item_completed(&write_pool, legacy_id, None).await {
                    error!(slot = %slot, error = %e, "failed to mark item completed (no engine)");
                }
            }
        } else if let Some(err) = error_msg {
            if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
                engine.on_item_error(slot, &err).await;
            } else {
                let legacy_id = slot.as_legacy_id();
                active_items.remove(&slot);
                if let Err(e) = repo::mark_item_error(&write_pool, legacy_id, Some(&err)).await {
                    error!(slot = %slot, error = %e, "failed to mark item error (no engine)");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE projects (\
                id INTEGER PRIMARY KEY, \
                name TEXT, \
                path TEXT, \
                model_plan TEXT, model_prd TEXT, model_execute TEXT, \
                model_risk TEXT, model_review TEXT, \"model_review-fixer\" TEXT, \
                model_session TEXT, model_qa TEXT, model_retro TEXT\
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE features (\
                id INTEGER PRIMARY KEY, \
                project_id INTEGER, \
                title TEXT, \
                model_plan TEXT, model_prd TEXT, model_execute TEXT, \
                model_risk TEXT, model_review TEXT, \"model_review-fixer\" TEXT, \
                model_session TEXT, model_qa TEXT, model_retro TEXT\
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    fn make_agent_manager(pool: SqlitePool, feature_id: i64) -> AgentManager {
        let (tx, _rx) = mpsc::unbounded_channel();
        let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);
        AgentManager::new(feature_id, pool.clone(), pool, tx, turn_state_tx)
    }

    #[tokio::test]
    async fn test_resolve_model_returns_default_when_no_settings() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan").await;
        assert_eq!(model, "claude-opus-4-6");
    }

    #[tokio::test]
    async fn test_resolve_model_uses_global_setting() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'sonnet')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan").await;
        assert_eq!(model, "sonnet");
    }

    #[tokio::test]
    async fn test_resolve_model_project_overrides_global() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'claude-sonnet-4')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'claude-opus-4-6')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan").await;
        assert_eq!(model, "claude-sonnet-4");
    }

    #[tokio::test]
    async fn test_resolve_model_feature_overrides_project() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'claude-sonnet-4')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, model_plan) VALUES (1, 1, 'feat', 'claude-haiku-3-5')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan").await;
        assert_eq!(model, "claude-haiku-3-5");
    }

    #[tokio::test]
    async fn test_resolve_model_default_value_falls_through() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'sonnet')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, model_plan) VALUES (1, 1, 'feat', 'default')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan").await;
        assert_eq!(model, "sonnet");
    }

    #[tokio::test]
    async fn test_resolve_model_empty_string_falls_through() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_execute) VALUES (1, 'test', 'claude-sonnet-4')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, model_execute) VALUES (1, 1, 'feat', '')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("execute").await;
        assert_eq!(model, "claude-sonnet-4");
    }

    #[tokio::test]
    async fn test_resolve_model_global_default_falls_through() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'default')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan").await;
        assert_eq!(model, "claude-opus-4-6");
    }

    #[tokio::test]
    async fn test_resolve_model_different_agent_types() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_plan, model_execute) VALUES (1, 'test', 'plan-model', 'exec-model')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        assert_eq!(mgr.resolve_model("plan").await, "plan-model");
        assert_eq!(mgr.resolve_model("execute").await, "exec-model");
        assert_eq!(mgr.resolve_model("review").await, "claude-opus-4-6");
    }
}
