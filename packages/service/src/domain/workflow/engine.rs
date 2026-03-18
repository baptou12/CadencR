//! Workflow engine: orchestrates queue execution through a strategy pattern.
//!
//! The engine is workflow-type-agnostic — it delegates item-specific decisions
//! (agent type, prompts, MCP config) to the WorkflowStrategy trait.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use axum::extract::ws::Message;
use claude_agent_sdk_rs::{Options, PermissionMode, Query, SdkError, SdkMessage};

use crate::domain::features::models::{QueueItem, WorkflowType};
use crate::domain::features::repository as repo;
use crate::domain::mcp::context::{ApprovalResult, McpContext};
use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::prompts::Prompts;
use crate::domain::workflow::strategies::{self, WorkflowStrategy};
use crate::domain::ws_session::handler::mcp_spawn::build_mcp_server_config;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

pub type WsSender = mpsc::UnboundedSender<Message>;

pub struct WorkflowEngine {
    pub feature_id: i64,
    pub workflow_type: WorkflowType,
    pub strategy: Box<dyn WorkflowStrategy>,
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
    pub autonomy_level: AtomicU8,
    pub max_parallel: usize,
    /// queue_item_id → db_session_id
    pub active_items: Arc<DashMap<i64, i64>>,
    /// queue_item_id → Query handle (for interrupt/stream_input)
    pub queries: Arc<DashMap<i64, Arc<tokio::sync::Mutex<Query>>>>,
    /// Shared MCP context for approval gates (plan/PRD approval resolution).
    /// Created lazily when plan/PRD agents are spawned.
    pub mcp_context: Arc<tokio::sync::RwLock<Option<Arc<McpContext>>>>,
    /// Cancellation signal for background tasks (e.g. timeout checker).
    cancel_tx: tokio::sync::watch::Sender<bool>,
    cancel_rx: tokio::sync::watch::Receiver<bool>,
}

impl WorkflowEngine {
    pub fn new(
        feature_id: i64,
        workflow_type: WorkflowType,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        ws_sender: WsSender,
        max_parallel: usize,
    ) -> Self {
        let strategy = strategies::get_strategy(&workflow_type);
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        Self {
            feature_id,
            workflow_type,
            strategy,
            read_pool,
            write_pool,
            ws_sender,
            autonomy_level: AtomicU8::new(3),
            max_parallel,
            active_items: Arc::new(DashMap::new()),
            queries: Arc::new(DashMap::new()),
            mcp_context: Arc::new(tokio::sync::RwLock::new(None)),
            cancel_tx,
            cancel_rx,
        }
    }

    /// Spawn a plan agent for this feature. The plan agent runs outside the queue
    /// and uses a synthetic queue_item_id of -1 for streaming.
    pub async fn spawn_plan_agent(&self, description: &str) -> Result<i64, String> {
        self.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            description,
            -1, // synthetic queue_item_id for plan
        )
        .await
    }

    /// Spawn a PRD agent for this feature. The PRD agent runs outside the queue
    /// and uses a synthetic queue_item_id of -2 for streaming.
    pub async fn spawn_prd_agent(&self, description: &str) -> Result<i64, String> {
        self.spawn_pre_queue_agent(
            AgentType::Prd,
            "prd",
            Prompts::prd(),
            description,
            -2, // synthetic queue_item_id for PRD
        )
        .await
    }

    /// Shared logic for spawning plan/PRD agents (pre-queue agents).
    async fn spawn_pre_queue_agent(
        &self,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: &str,
        initial_prompt: &str,
        synthetic_item_id: i64,
    ) -> Result<i64, String> {
        info!(
            feature_id = self.feature_id,
            agent_type = agent_type_str,
            "spawning pre-queue agent"
        );

        // 1. Create agent session in DB
        let now = chrono::Utc::now().to_rfc3339();
        let db_session_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, 'running', ?) RETURNING id",
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
            .unwrap_or_else(|| PathBuf::from("."));

        // 4. Build options and spawn
        let options = Options {
            cwd,
            permission_mode: Some(PermissionMode::BypassPermissions),
            system_prompt: if system_prompt.is_empty() {
                None
            } else {
                Some(system_prompt.to_string())
            },
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };

        let content_value = serde_json::Value::String(initial_prompt.to_string());

        match claude_agent_sdk_rs::query(content_value, options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();

                // Store Query handle for interrupt support (skip PID persist for synthetic IDs)
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                self.queries.insert(synthetic_item_id, query_handle);

                // Track in active items with synthetic ID
                self.active_items.insert(synthetic_item_id, db_session_id);

                // Spawn stream reader (reuses the same workflow stream reader)
                spawn_workflow_stream_reader(
                    synthetic_item_id,
                    db_session_id,
                    self.feature_id,
                    message_rx,
                    self.ws_sender.clone(),
                    self.write_pool.clone(),
                    self.active_items.clone(),
                    self.queries.clone(),
                );

                // Send agent started envelope
                let envelope = WsEnvelope::new(
                    "workflow",
                    "agent_started",
                    serde_json::json!({
                        "feature_id": self.feature_id,
                        "queue_item_id": synthetic_item_id,
                        "session_id": db_session_id,
                        "agent_type": agent_type_str,
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
                error!(
                    feature_id = self.feature_id,
                    agent_type = agent_type_str,
                    error = %e,
                    "failed to spawn pre-queue agent"
                );
                // Mark session as failed
                let _ = WsSessionPersistence::mark_paused_static(&self.write_pool, db_session_id)
                    .await;
                Err(format!("SDK spawn failed for {agent_type_str}: {e}"))
            }
        }
    }

    /// Resolve a pending approval by request_id pattern.
    /// Iterates pending_approvals on the engine's McpContext looking for keys
    /// matching the given prefix, and resolves the first match.
    pub async fn resolve_approval(
        &self,
        prefix: &str,
        approved: bool,
        feedback: Option<String>,
    ) -> Result<bool, String> {
        let ctx_guard = self.mcp_context.read().await;
        let Some(ctx) = ctx_guard.as_ref() else {
            return Err("No MCP context available".to_string());
        };

        // Find request_id matching the prefix
        let request_id = ctx
            .pending_approvals
            .iter()
            .find(|entry| entry.key().starts_with(prefix))
            .map(|entry| entry.key().clone());

        drop(ctx_guard);

        if let Some(request_id) = request_id {
            let ctx_guard = self.mcp_context.read().await;
            if let Some(ctx) = ctx_guard.as_ref() {
                let result = ApprovalResult { approved, feedback };
                Ok(ctx.resolve_approval(&request_id, result))
            } else {
                Err("MCP context disappeared".to_string())
            }
        } else {
            // No pending approval found — this is common when using subprocess MCP.
            // The approval might need to be resolved via DB in future.
            warn!(
                feature_id = self.feature_id,
                prefix,
                "no pending approval found matching prefix"
            );
            Ok(false)
        }
    }

    /// Advance the workflow: unblock ready items and start them up to capacity.
    pub async fn advance(&self) -> Result<(), String> {
        let running = repo::get_running_count(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        if running as usize >= self.max_parallel {
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

        let capacity = self.max_parallel - running as usize;
        for item in ready.into_iter().take(capacity) {
            if let Err(e) = self.start_item(item).await {
                error!(feature_id = self.feature_id, error = %e, "failed to start queue item");
            }
        }

        Ok(())
    }

    /// Start executing a single queue item by spawning an agent.
    async fn start_item(&self, item: QueueItem) -> Result<(), String> {
        let item_id = item.id;
        info!(feature_id = self.feature_id, item_id, item_type = %item.item_type, "starting queue item");

        // 1. Mark running in DB
        repo::mark_item_running(&self.write_pool, item_id)
            .await
            .map_err(|e| e.to_string())?;

        // 2. Delegate to strategy
        let agent_type = self.strategy.agent_type_for_item(&item.item_type)?;
        let system_prompt = self.strategy.build_system_prompt(&self.read_pool, &item).await?;
        let feature_title = self.get_feature_title().await.unwrap_or_default();
        let initial_prompt = self
            .strategy
            .build_initial_prompt(&self.read_pool, &item, &feature_title)
            .await?;

        // 3. Create agent session in DB
        let now = chrono::Utc::now().to_rfc3339();
        let agent_type_str = format!("{:?}", agent_type).to_lowercase();
        let db_session_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, 'running', ?) RETURNING id",
        )
        .bind(self.feature_id)
        .bind(&agent_type_str)
        .bind(&now)
        .fetch_one(&self.write_pool)
        .await
        .map_err(|e| format!("Failed to create agent session: {e}"))?;

        // Update queue item with session reference
        sqlx::query("UPDATE workflow_queue SET agent_session_id = ? WHERE id = ?")
            .bind(db_session_id)
            .bind(item_id)
            .execute(&self.write_pool)
            .await
            .map_err(|e| format!("Failed to link session to queue item: {e}"))?;

        // 4. Build MCP config
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);

        // 5. Resolve cwd — use project directory from feature
        let cwd = self.get_feature_cwd().await.unwrap_or_else(|| PathBuf::from("."));

        // 6. Build Options and spawn
        let options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::BypassPermissions),
            system_prompt: if system_prompt.is_empty() { None } else { Some(system_prompt) },
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };

        let content_value = serde_json::Value::String(initial_prompt);

        match claude_agent_sdk_rs::query(content_value, options).await {
            Ok(mut real_query) => {
                let message_rx = real_query.take_message_rx();

                // Persist PID for interrupt fallback (survives reconnect/restart)
                if let Some(pid) = real_query.pid() {
                    if let Err(e) = repo::update_item_pid(&self.write_pool, item_id, pid as i64).await {
                        warn!(item_id, error = %e, "failed to persist agent PID");
                    }
                }

                // Store Query handle for interrupt support
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                self.queries.insert(item_id, query_handle);

                // Track in active items
                self.active_items.insert(item_id, db_session_id);

                // Spawn workflow stream reader
                spawn_workflow_stream_reader(
                    item_id,
                    db_session_id,
                    self.feature_id,
                    message_rx,
                    self.ws_sender.clone(),
                    self.write_pool.clone(),
                    self.active_items.clone(),
                    self.queries.clone(),
                );

                // Send item_started envelope
                let envelope = WsEnvelope::new(
                    "workflow",
                    "item_started",
                    serde_json::json!({
                        "feature_id": self.feature_id,
                        "queue_item_id": item_id,
                        "session_id": db_session_id,
                        "item_type": item.item_type,
                    }),
                );
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

                info!(item_id, db_session_id, "queue item agent spawned");
                Ok(())
            }
            Err(e) => {
                error!(item_id, error = %e, "failed to spawn agent for queue item");
                self.on_item_error(item_id, &e.to_string()).await;
                Err(format!("SDK spawn failed: {e}"))
            }
        }
    }

    /// Called when a queue item completes successfully.
    pub async fn on_item_completed(&self, item_id: i64, result: Option<&str>) {
        info!(feature_id = self.feature_id, item_id, "queue item completed");

        self.active_items.remove(&item_id);
        self.queries.remove(&item_id);

        if let Err(e) = repo::mark_item_completed(&self.write_pool, item_id, result).await {
            error!(item_id, error = %e, "failed to mark item completed");
        }

        // Send item_completed envelope
        let envelope = WsEnvelope::new(
            "workflow",
            "item_completed",
            serde_json::json!({
                "feature_id": self.feature_id,
                "queue_item_id": item_id,
                "result": result,
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        // Autonomy-based advancement
        match self.autonomy_level.load(Ordering::Relaxed) {
            3 => {
                if let Err(e) = self.advance().await {
                    error!(error = %e, "advance after completion failed");
                }
            }
            2 => {
                // Advance if next ready items share the same group_index
                if repo::unblock_ready_items(&self.write_pool, self.feature_id)
                    .await
                    .is_ok()
                {
                    if let Ok(ready) = repo::get_ready_items(&self.read_pool, self.feature_id).await
                    {
                        let current_group = self.get_current_group_index(item_id).await;
                        let same_group = ready.iter().all(|r| r.group_index == current_group);
                        if same_group && !ready.is_empty() {
                            if let Err(e) = self.advance().await {
                                error!(error = %e, "advance after completion failed");
                            }
                        } else if !ready.is_empty() {
                            let envelope = WsEnvelope::new(
                                "workflow",
                                "paused",
                                serde_json::json!({
                                    "feature_id": self.feature_id,
                                    "reason": "group_boundary",
                                }),
                            );
                            let _ = self
                                .ws_sender
                                .send(Message::Text(String::from(envelope).into()));
                        }
                    }
                }
            }
            _ => {
                // Level 1: always pause
                let envelope = WsEnvelope::new(
                    "workflow",
                    "paused",
                    serde_json::json!({
                        "feature_id": self.feature_id,
                        "reason": "autonomy_pause",
                    }),
                );
                let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
            }
        }
    }

    /// Called when a queue item errors.
    pub async fn on_item_error(&self, item_id: i64, error: &str) {
        warn!(feature_id = self.feature_id, item_id, error, "queue item errored");

        self.active_items.remove(&item_id);
        self.queries.remove(&item_id);

        if let Err(e) = repo::mark_item_error(&self.write_pool, item_id, Some(error)).await {
            error!(item_id, error = %e, "failed to mark item error");
        }

        let envelope = WsEnvelope::new(
            "workflow",
            "item_error",
            serde_json::json!({
                "feature_id": self.feature_id,
                "queue_item_id": item_id,
                "error": error,
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
    }

    /// Interrupt a running queue item.
    /// Fast path: use in-memory Query handle. Fallback: PID from DB.
    pub async fn interrupt_item(&self, queue_item_id: i64) -> Result<(), String> {
        // Fast path: in-memory Query handle
        if let Some(query) = self.queries.get(&queue_item_id) {
            let q = query.lock().await;
            return q.interrupt().await.map_err(|e| format!("Interrupt failed: {e}"));
        }
        // Fallback: PID from DB (handles refresh + restart)
        self.interrupt_by_pid(queue_item_id).await
    }

    async fn interrupt_by_pid(&self, queue_item_id: i64) -> Result<(), String> {
        let item = repo::get_queue_item(&self.read_pool, queue_item_id)
            .await
            .map_err(|e| format!("DB lookup failed: {e}"))?
            .ok_or_else(|| format!("Queue item {queue_item_id} not found"))?;

        if let Some(pid) = item.pid {
            let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
            if result == 0 {
                info!(queue_item_id, pid, "sent SIGINT via PID fallback");
                Ok(())
            } else {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ESRCH) {
                    // Process already dead — mark item as error
                    self.on_item_error(queue_item_id, "Agent process no longer running").await;
                    Err("Process already exited".into())
                } else {
                    Err(format!("kill({pid}, SIGINT) failed: {err}"))
                }
            }
        } else {
            Err(format!("No query handle or PID for item {queue_item_id}"))
        }
    }

    /// Retry a failed queue item.
    pub async fn retry_item(&self, item_id: i64) -> Result<(), String> {
        info!(feature_id = self.feature_id, item_id, "retrying queue item");

        sqlx::query("UPDATE workflow_queue SET status = 'ready', started_at = NULL, ended_at = NULL, result = NULL WHERE id = ?")
            .bind(item_id)
            .execute(&self.write_pool)
            .await
            .map_err(|e| format!("Failed to reset item for retry: {e}"))?;

        self.advance().await
    }

    /// Skip a queue item and unblock dependents.
    pub async fn skip_item(&self, item_id: i64) -> Result<(), String> {
        info!(feature_id = self.feature_id, item_id, "skipping queue item");

        repo::mark_item_skipped(&self.write_pool, item_id)
            .await
            .map_err(|e| e.to_string())?;

        self.active_items.remove(&item_id);

        let envelope = WsEnvelope::new(
            "workflow",
            "item_skipped",
            serde_json::json!({
                "feature_id": self.feature_id,
                "queue_item_id": item_id,
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        self.advance().await
    }

    /// Get the feature title from DB.
    async fn get_feature_title(&self) -> Option<String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT title FROM features WHERE id = ?")
            .bind(self.feature_id)
            .fetch_optional(&self.read_pool)
            .await
            .ok()?;
        row.map(|(t,)| t)
    }

    /// Get the feature's working directory (project cwd).
    async fn get_feature_cwd(&self) -> Option<PathBuf> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT p.directory FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()?;
        row.and_then(|(d,)| d).map(PathBuf::from)
    }

    /// Spawn a background task that periodically checks for stuck agents.
    /// Items running longer than `timeout_minutes` are marked as error.
    /// Cancel all background tasks (timeout checker, etc.).
    pub fn cancel(&self) {
        let _ = self.cancel_tx.send(true);
    }

    pub fn spawn_timeout_checker(&self, timeout_minutes: u64) {
        let read_pool = self.read_pool.clone();
        let write_pool = self.write_pool.clone();
        let feature_id = self.feature_id;
        let sender = self.ws_sender.clone();
        let active_items = self.active_items.clone();
        let mut cancel_rx = self.cancel_rx.clone();

        tokio::spawn(async move {
            let interval = std::time::Duration::from_secs(60); // check every minute
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = cancel_rx.changed() => {
                        info!(feature_id, "timeout checker cancelled");
                        break;
                    }
                }

                // Find running items that started more than timeout_minutes ago
                let stale: Vec<(i64,)> = match sqlx::query_as(
                    "SELECT id FROM workflow_queue WHERE feature_id = ? AND status = 'running' AND started_at < datetime('now', ?)",
                )
                .bind(feature_id)
                .bind(format!("-{timeout_minutes} minutes"))
                .fetch_all(&read_pool)
                .await {
                    Ok(rows) => rows,
                    Err(e) => {
                        error!(feature_id, error = %e, "timeout checker query failed");
                        continue;
                    }
                };

                for (item_id,) in stale {
                    warn!(feature_id, item_id, "agent timed out");
                    active_items.remove(&item_id);

                    if let Err(e) = repo::mark_item_error(&write_pool, item_id, Some("Agent timed out")).await {
                        error!(item_id, error = %e, "failed to mark timed-out item");
                        continue;
                    }

                    let envelope = WsEnvelope::new(
                        "workflow",
                        "item_error",
                        serde_json::json!({
                            "feature_id": feature_id,
                            "queue_item_id": item_id,
                            "error": "Agent timed out",
                        }),
                    );
                    let _ = sender.send(Message::Text(String::from(envelope).into()));
                }
            }
        });
    }

    /// Restore workflow state from DB on reconnection.
    /// Marks stale running items as error and sends full queue update.
    pub async fn restore_on_reconnect(&self) -> Result<(), String> {
        info!(feature_id = self.feature_id, "restoring workflow state on reconnect");

        // Mark any items that were "running" as error (stale from server restart)
        let stale_items: Vec<(i64,)> = sqlx::query_as(
            "SELECT id FROM workflow_queue WHERE feature_id = ? AND status = 'running'",
        )
        .bind(self.feature_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| e.to_string())?;

        for (item_id,) in &stale_items {
            if let Err(e) = repo::mark_item_error(&self.write_pool, *item_id, Some("Stale after reconnect")).await {
                error!(item_id, error = %e, "failed to mark stale item");
            }
            // Clear PID since we've lost the Query handles
            let _ = sqlx::query("UPDATE workflow_queue SET pid = NULL WHERE id = ?")
                .bind(*item_id)
                .execute(&self.write_pool)
                .await;
        }

        // Send full queue update
        let all_items = repo::get_queue_for_feature(&self.read_pool, self.feature_id)
            .await
            .map_err(|e| e.to_string())?;

        let envelope = WsEnvelope::new(
            "workflow",
            "queue_update",
            serde_json::json!({
                "feature_id": self.feature_id,
                "items": all_items,
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));

        Ok(())
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
}

/// Spawn a background task that reads agent stream messages and forwards them
/// via the workflow domain, then triggers engine callbacks on completion/error.
fn spawn_workflow_stream_reader(
    queue_item_id: i64,
    db_session_id: i64,
    feature_id: i64,
    mut message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,
    sender: WsSender,
    write_pool: SqlitePool,
    active_items: Arc<DashMap<i64, i64>>,
    queries: Arc<DashMap<i64, Arc<tokio::sync::Mutex<Query>>>>,
) {
    tokio::spawn(async move {
        info!(queue_item_id, db_session_id, "workflow stream reader started");
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        let mut completed_ok = false;
        let mut error_msg: Option<String> = None;

        loop {
            match message_rx.recv().await {
                Some(Ok(sdk_msg)) => {
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
                            completed_ok = true;
                            WsSessionPersistence::mark_completed_static(
                                &write_pool,
                                db_session_id,
                            )
                            .await;
                            WsEnvelope::new(
                                "workflow",
                                "agent_stream",
                                serde_json::json!({
                                    "queue_item_id": queue_item_id,
                                    "session_id": db_session_id,
                                    "type": "result",
                                }),
                            )
                        }
                        _ => {
                            let block = serde_json::to_value(&sdk_msg).unwrap_or_default();
                            WsEnvelope::new(
                                "workflow",
                                "agent_stream",
                                serde_json::json!({
                                    "queue_item_id": queue_item_id,
                                    "session_id": db_session_id,
                                    "blocks": [block],
                                }),
                            )
                        }
                    };

                    if sender
                        .send(Message::Text(String::from(envelope).into()))
                        .is_err()
                    {
                        warn!(
                            queue_item_id,
                            "WS sender closed, stopping workflow stream reader"
                        );
                        break;
                    }
                }
                Some(Err(e)) => {
                    error!(queue_item_id, error = %e, "workflow SDK stream error");
                    error_msg = Some(e.to_string());
                    WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
                    let err_env = WsEnvelope::new(
                        "workflow",
                        "agent_stream",
                        serde_json::json!({
                            "queue_item_id": queue_item_id,
                            "session_id": db_session_id,
                            "type": "error",
                            "error": e.to_string(),
                        }),
                    );
                    let _ = sender.send(Message::Text(String::from(err_env).into()));
                    break;
                }
                None => {
                    if completed_ok {
                        info!(queue_item_id, "workflow SDK stream closed after result");
                    } else {
                        warn!(queue_item_id, "workflow SDK stream closed unexpectedly without result");
                        error_msg = Some("Agent stream closed unexpectedly without result".to_string());
                    }
                    break;
                }
            }
        }

        // Post-stream cleanup: remove query handle
        queries.remove(&queue_item_id);

        // Post-stream callbacks — delegate to the real engine from the registry
        if completed_ok {
            if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
                engine.on_item_completed(queue_item_id, None).await;
            } else {
                // Fallback: engine gone (disconnect?), do minimal cleanup
                active_items.remove(&queue_item_id);
                if let Err(e) = repo::mark_item_completed(&write_pool, queue_item_id, None).await {
                    error!(queue_item_id, error = %e, "failed to mark item completed (no engine)");
                }
            }
        } else if let Some(err) = error_msg {
            if let Some(engine) = crate::domain::ws_session::handler::workflow::get_engine(feature_id) {
                engine.on_item_error(queue_item_id, &err).await;
            } else {
                active_items.remove(&queue_item_id);
                if let Err(e) = repo::mark_item_error(&write_pool, queue_item_id, Some(&err)).await {
                    error!(queue_item_id, error = %e, "failed to mark item error (no engine)");
                }
            }
        }
    });
}

impl Drop for WorkflowEngine {
    fn drop(&mut self) {
        // Safety net: cancel background tasks when the engine is dropped.
        let _ = self.cancel_tx.send(true);
    }
}
