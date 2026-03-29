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
use claude_agent_sdk_rs::{Options, PermissionMode, Query};

use crate::domain::features::models::QueueItem;
use crate::domain::features::repository as repo;
use crate::domain::mcp::servers::{AgentType, mcp_server_name};
use crate::domain::workflow::engine::{AgentSlot, WsSender};
use crate::domain::workflow::permission_router::{PermissionRouter, WorkflowPermissionBridge};
use crate::domain::workflow::strategies::WorkflowStrategy;
use crate::domain::workflow::stream_reader::spawn_workflow_stream_reader;
use crate::domain::ws_session::handler::mcp_spawn::build_mcp_server_config;
use crate::domain::ws_session::handler::session_prompt::{PermissionResponse, build_content_value};
use crate::domain::ws_session::permissions;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

use super::engine::{send_feature_updated_envelope, to_value};

/// Holds the resolved context needed to spawn or resume an agent.
/// Built via `AgentManager::build_spawn_context` to deduplicate setup logic.
pub struct SpawnContext {
    pub model: String,
    pub options: Options,
    pub expected_mcp_server: String,
}

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

    /// Get the project_id for this feature.
    async fn get_project_id(&self) -> Option<i64> {
        sqlx::query_scalar::<_, i64>("SELECT project_id FROM features WHERE id = ?")
            .bind(self.feature_id)
            .fetch_optional(&self.read_pool)
            .await
            .ok()
            .flatten()
    }

    /// Resolve a setting using the shared feature → project → global cascade.
    async fn resolve_setting(&self, key: &str, project_id: Option<i64>, default: Option<&str>) -> Option<String> {
        crate::domain::settings::resolve_setting(
            &self.read_pool,
            key,
            Some(self.feature_id),
            project_id,
            default,
        )
        .await
    }

    /// Resolve the model for a given agent type.
    async fn resolve_model(&self, agent_type_str: &str, project_id: Option<i64>) -> String {
        const DEFAULT_MODEL: &str = crate::api::DEFAULT_MODEL;
        let db_key = format!("model_{agent_type_str}");
        self.resolve_setting(&db_key, project_id, Some(DEFAULT_MODEL))
            .await
            .unwrap_or_else(|| DEFAULT_MODEL.to_string())
    }

    /// Build the language instruction to append to system prompts.
    async fn build_language_instruction(&self, project_id: Option<i64>) -> Option<String> {
        self.resolve_setting("language", project_id, None)
            .await
            .map(|l| format!("\n\n## Language\n\nYou MUST respond in {l}."))
    }

    /// Build a SpawnContext with all the shared setup: MCP config, CWD, permission
    /// bridge, model resolution, language instruction, and Options construction.
    ///
    /// The caller is responsible for creating the DB session and slot beforehand,
    /// since those differ between spawn_pre_queue_agent, start_item, and resume_item.
    async fn build_spawn_context(
        &self,
        slot: AgentSlot,
        db_session_id: i64,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: Option<&str>,
        resume_session_id: Option<&str>,
        include_mcp_instructions: bool,
        permissions: &PermissionRouter,
    ) -> Result<SpawnContext, String> {
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);
        let expected_mcp_server = mcp_server_name(agent_type).to_string();

        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!("No working directory found for feature {}. Was ensure_worktree called?", self.feature_id)
        })?;

        // Permission bridge
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

        // Model + language
        let project_id = self.get_project_id().await;
        let model = self.resolve_model(agent_type_str, project_id).await;
        let language_instruction = self.build_language_instruction(project_id).await;
        info!(feature_id = self.feature_id, agent_type = agent_type_str, model = %model, "resolved model");

        let _ = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(&model)
            .bind(db_session_id)
            .execute(&self.write_pool)
            .await;

        // Build system prompt with optional MCP instructions and language
        let full_system_prompt = match system_prompt {
            Some(sp) if !sp.is_empty() => {
                let mcp_suffix = if include_mcp_instructions {
                    "\n\n## MCP Tools\n\n\
                     The MCP tools will auto-resolve plan_id from your feature — you do NOT need to pass plan_id to any tool. \
                     Just omit it and the correct plan will be used automatically."
                } else {
                    ""
                };
                Some(format!(
                    "{sp}{mcp_suffix}{}",
                    language_instruction.as_deref().unwrap_or("")
                ))
            }
            _ => language_instruction,
        };

        let mut options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::AcceptEdits),
            model: Some(model.clone()),
            system_prompt: full_system_prompt,
            resume: resume_session_id.map(|s| s.to_string()),
            mcp_servers: Some(mcp_servers.clone()),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        Ok(SpawnContext {
            model,
            options,
            expected_mcp_server,
        })
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
        info!(feature_id = self.feature_id, agent_type = agent_type_str, "spawning pre-queue agent");

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
        let ctx = self.build_spawn_context(
            slot.clone(), db_session_id, agent_type, agent_type_str,
            Some(system_prompt), None, true, permissions,
        ).await?;

        // 3. Persist the initial user prompt and send it to the frontend
        {
            let p = WsSessionPersistence::with_session_id(
                self.write_pool.clone(), self.feature_id, Some(db_session_id),
            );
            p.persist_user_message(initial_prompt).await;
        }
        self.send_user_message_event(slot.clone(), db_session_id, initial_prompt);

        let content_value = build_content_value(initial_prompt, images);

        // 4. Spawn query and start stream reader
        match claude_agent_sdk_rs::query(content_value, ctx.options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                if let Some((_, old_query)) = self.queries.remove(&slot) {
                    warn!(slot = %slot, "closing existing query before spawning new pre-queue agent");
                    old_query.lock().await.close().await;
                }
                self.queries.insert(slot.clone(), query_handle);
                self.active_items.insert(slot.clone(), db_session_id);

                spawn_workflow_stream_reader(
                    slot.clone(), db_session_id, self.feature_id,
                    ctx.expected_mcp_server, message_rx, self.ws_sender.clone(),
                    self.write_pool.clone(), self.active_items.clone(),
                    self.queries.clone(), Some(ctx.model.as_str()),
                );

                let envelope = WsEnvelope::new(
                    "workflow", "agent_started",
                    to_value(WorkflowAgentStartedPayload {
                        feature_id: self.feature_id,
                        agent_slot: slot,
                        session_id: db_session_id,
                        agent_type: agent_type_str.to_string(),
                    }),
                );
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
                info!(feature_id = self.feature_id, db_session_id, agent_type = agent_type_str, "pre-queue agent spawned");
                Ok(db_session_id)
            }
            Err(e) => {
                error!(feature_id = self.feature_id, agent_type = agent_type_str, error = %e, "failed to spawn pre-queue agent");
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

        sqlx::query("UPDATE workflow_queue SET agent_session_id = ? WHERE id = ?")
            .bind(db_session_id)
            .bind(item_id)
            .execute(&self.write_pool)
            .await
            .map_err(|e| format!("Failed to link session to queue item: {e}"))?;

        // 4. Build spawn context (MCP, CWD, permissions, model, options)
        let slot = AgentSlot::QueueItem(item_id);
        let ctx = self.build_spawn_context(
            slot.clone(), db_session_id, agent_type, &agent_type_str,
            Some(system_prompt.as_str()), None, false, permissions,
        ).await?;

        // 5. Persist the initial user prompt and send it to the frontend
        {
            let p = WsSessionPersistence::with_session_id(
                self.write_pool.clone(), self.feature_id, Some(db_session_id),
            );
            p.persist_user_message(&initial_prompt).await;
        }
        self.send_user_message_event(slot.clone(), db_session_id, &initial_prompt);

        let content_value = serde_json::Value::String(initial_prompt);

        // 6. Spawn query and start stream reader
        match claude_agent_sdk_rs::query(content_value, ctx.options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();
                if let Some(pid) = real_query.pid() {
                    if let Err(e) = repo::update_item_pid(&self.write_pool, item_id, pid as i64).await {
                        warn!(item_id, error = %e, "failed to persist agent PID");
                    }
                }
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                if let Some((_, old_query)) = self.queries.remove(&slot) {
                    warn!(slot = %slot, "closing existing query before spawning new queue item agent");
                    old_query.lock().await.close().await;
                }
                self.queries.insert(slot.clone(), query_handle);
                self.active_items.insert(slot.clone(), db_session_id);

                spawn_workflow_stream_reader(
                    slot.clone(), db_session_id, self.feature_id,
                    ctx.expected_mcp_server, message_rx, self.ws_sender.clone(),
                    self.write_pool.clone(), self.active_items.clone(),
                    self.queries.clone(), Some(ctx.model.as_str()),
                );

                let envelope = WsEnvelope::new(
                    "workflow", "item_started",
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
        // No query handle — the agent's CLI turn likely already ended.
        // Check if it's already paused/completed and treat as success.
        if let Some(db_sid) = self.active_items.get(&slot) {
            let status: Option<(String,)> = sqlx::query_as(
                "SELECT status FROM agent_sessions WHERE id = ?",
            )
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
    async fn resume_item(
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

        let agent_type = slot.sdk_agent_type().unwrap_or(AgentType::Execute);

        // Resolve agent_type_str for model lookup
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
                        let _ = repo::update_item_pid(&self.write_pool, *item_id, pid as i64).await;
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

    /// Clean up state for an agent slot (remove from all tracking maps).
    pub fn cleanup_agent(&self, slot: &AgentSlot) {
        self.active_items.remove(slot);
        self.queries.remove(slot);
        self.paused_sessions.remove(slot);
    }

    /// Pause all running agents: capture claude_session_id, interrupt, mark paused in DB.
    /// Used during graceful shutdown so agents can be resumed on next app start.
    pub async fn pause_all(&self) {
        let slots: Vec<AgentSlot> = self.queries.iter().map(|e| e.key().clone()).collect();
        for slot in slots {
            if let Some(query_arc) = self.queries.get(&slot) {
                let q = query_arc.lock().await;
                // Capture session ID for resume
                if let Some(cc_session_id) = q.session_id().await {
                    info!(slot = %slot, cc_session_id = %cc_session_id, "pause_all: captured session ID");
                    self.paused_sessions.insert(slot.clone(), cc_session_id.clone());
                    // Persist to DB
                    if let Some(db_session_id) = self.active_items.get(&slot).map(|e| *e.value()) {
                        WsSessionPersistence::persist_claude_session_id_static(
                            &self.write_pool, db_session_id, &cc_session_id,
                        ).await;
                        WsSessionPersistence::mark_paused_static(
                            &self.write_pool, db_session_id,
                        ).await;
                    }
                }
                // Interrupt the process
                let _ = q.interrupt().await;
                drop(q);
            }
            // Also mark queue items as paused in workflow_queue
            if let AgentSlot::QueueItem(item_id) = &slot {
                let _ = sqlx::query(
                    "UPDATE workflow_queue SET status = 'paused', ended_at = datetime('now') WHERE id = ? AND status = 'running'",
                )
                .bind(*item_id)
                .execute(&self.write_pool)
                .await;
            }
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
            if let Err(e) = repo::mark_item_completed(&self.write_pool, *item_id, Some("Marked done by user")).await {
                warn!(slot = %slot, error = %e, "failed to mark item completed on mark_done");
            }
            self.send_item_update(*item_id).await;
        }

        // Mark the agent_sessions row as completed for all slot types
        if let Some((_, db_session_id)) = removed {
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
        AgentManager::new(feature_id, pool.clone(), pool, WsSender::new(tx), turn_state_tx)
    }

    #[tokio::test]
    async fn test_resolve_model_returns_default_when_no_settings() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan", Some(1)).await;
        assert_eq!(model, "opus[1m]");
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
        let model = mgr.resolve_model("plan", Some(1)).await;
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
        let model = mgr.resolve_model("plan", Some(1)).await;
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
        let model = mgr.resolve_model("plan", Some(1)).await;
        assert_eq!(model, "claude-haiku-3-5");
    }

    #[tokio::test]
    async fn test_resolve_model_default_is_not_special() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'sonnet')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, model_plan) VALUES (1, 1, 'feat', 'default')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan", Some(1)).await;
        // "default" is a regular value, feature level wins
        assert_eq!(model, "default");
    }

    #[tokio::test]
    async fn test_resolve_model_empty_string_falls_through() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_execute) VALUES (1, 'test', 'claude-sonnet-4')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, model_execute) VALUES (1, 1, 'feat', '')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("execute", Some(1)).await;
        assert_eq!(model, "claude-sonnet-4");
    }

    #[tokio::test]
    async fn test_resolve_model_global_default_is_not_special() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'default')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let model = mgr.resolve_model("plan", Some(1)).await;
        // "default" is a regular value from global settings, not a magic keyword
        assert_eq!(model, "default");
    }

    #[tokio::test]
    async fn test_resolve_model_different_agent_types() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, model_plan, model_execute) VALUES (1, 'test', 'plan-model', 'exec-model')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        assert_eq!(mgr.resolve_model("plan", Some(1)).await, "plan-model");
        assert_eq!(mgr.resolve_model("execute", Some(1)).await, "exec-model");
        assert_eq!(mgr.resolve_model("review", Some(1)).await, "opus[1m]");
    }

    #[tokio::test]
    async fn test_build_language_instruction_returns_none_when_unset() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        assert!(mgr.build_language_instruction(Some(1)).await.is_none());
    }

    #[tokio::test]
    async fn test_build_language_instruction_returns_instruction_when_set() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('language', 'French')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        let instruction = mgr.build_language_instruction(Some(1)).await;
        assert!(instruction.is_some());
        assert!(instruction.unwrap().contains("French"));
    }

    #[tokio::test]
    async fn test_build_language_instruction_empty_string_returns_none() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('language', '')")
            .execute(&pool).await.unwrap();

        let mgr = make_agent_manager(pool, 1);
        assert!(mgr.build_language_instruction(Some(1)).await.is_none());
    }
}
