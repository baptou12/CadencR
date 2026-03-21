//! Workflow engine: orchestrates queue execution through a strategy pattern.
//!
//! The engine is workflow-type-agnostic — it delegates item-specific decisions
//! (agent type, prompts, MCP config) to the WorkflowStrategy trait.

use serde::{Deserialize, Serialize};

/// Discriminated union replacing synthetic negative queue_item_id constants.
/// Pre-queue agents get named variants; real queue items carry their DB id.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type", content = "id")]
pub enum AgentSlot {
    #[serde(rename = "queue_item")]
    QueueItem(i64),
    #[serde(rename = "plan")]
    Plan,
    #[serde(rename = "prd")]
    Prd,
    #[serde(rename = "session")]
    Session,
    #[serde(rename = "refine")]
    Refine,
    #[serde(rename = "review_fixer")]
    ReviewFixer,
}

impl AgentSlot {
    /// Backward-compat: map to the legacy synthetic negative IDs.
    pub fn as_legacy_id(&self) -> i64 {
        match self {
            AgentSlot::Plan => -1,
            AgentSlot::Prd => -2,
            AgentSlot::Session => -3,
            AgentSlot::Refine => -4,
            AgentSlot::ReviewFixer => -5,
            AgentSlot::QueueItem(id) => *id,
        }
    }

    pub fn is_queue_item(&self) -> bool {
        matches!(self, AgentSlot::QueueItem(_))
    }

    pub fn agent_type_str(&self) -> Option<&'static str> {
        match self {
            AgentSlot::Plan => Some("plan"),
            AgentSlot::Prd => Some("prd"),
            AgentSlot::Session => Some("session"),
            AgentSlot::Refine => Some("refine"),
            AgentSlot::ReviewFixer => Some("review-fixer"),
            AgentSlot::QueueItem(_) => None,
        }
    }

    pub fn sdk_agent_type(&self) -> Option<AgentType> {
        match self {
            AgentSlot::Plan | AgentSlot::Refine => Some(AgentType::Plan),
            AgentSlot::Prd => Some(AgentType::Prd),
            AgentSlot::Session => Some(AgentType::Session),
            AgentSlot::ReviewFixer => Some(AgentType::Execute),
            AgentSlot::QueueItem(_) => None,
        }
    }

    pub fn system_prompt(&self) -> Option<&'static str> {
        match self {
            AgentSlot::Plan | AgentSlot::Refine => Some(Prompts::plan()),
            AgentSlot::Prd => Some(Prompts::prd()),
            AgentSlot::Session => Some(Prompts::session()),
            _ => None,
        }
    }
}

impl From<i64> for AgentSlot {
    fn from(id: i64) -> Self {
        match id {
            -1 => AgentSlot::Plan,
            -2 => AgentSlot::Prd,
            -3 => AgentSlot::Session,
            -4 => AgentSlot::Refine,
            -5 => AgentSlot::ReviewFixer,
            other => AgentSlot::QueueItem(other),
        }
    }
}

impl std::fmt::Display for AgentSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentSlot::Plan => write!(f, "plan"),
            AgentSlot::Prd => write!(f, "prd"),
            AgentSlot::Session => write!(f, "session"),
            AgentSlot::Refine => write!(f, "refine"),
            AgentSlot::ReviewFixer => write!(f, "review_fixer"),
            AgentSlot::QueueItem(id) => write!(f, "queue_item({})", id),
        }
    }
}

/// Synthetic queue_item_id constants — DEPRECATED, use AgentSlot variants instead.
pub const PLAN_ITEM_ID: i64 = -1;
pub const PRD_ITEM_ID: i64 = -2;
pub const SESSION_ITEM_ID: i64 = -3;
pub const REFINE_ITEM_ID: i64 = -4;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dashmap::{DashMap, DashSet};
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use axum::extract::ws::Message;
use claude_agent_sdk_rs::{
    CanUseTool, Options, PermissionMode, PermissionRequest, PermissionResult, Query, SdkError,
    SdkMessage, SystemMessage,
};

use crate::domain::features::models::{QueueItem, WorkflowType};
use crate::domain::features::repository as repo;
use crate::domain::mcp::servers::{AgentType, mcp_server_name};
use crate::domain::workflow::prompts::Prompts;
use crate::domain::workflow::strategies::{self, WorkflowStrategy};
use crate::domain::ws_session::handler::mcp_spawn::build_mcp_server_config;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::permissions;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;

pub type WsSender = mpsc::UnboundedSender<Message>;

/// Map an agent type string to an AgentSlot.
fn agent_type_str_to_slot(agent_type: &str) -> Option<AgentSlot> {
    match agent_type {
        "plan" => Some(AgentSlot::Plan),
        "prd" => Some(AgentSlot::Prd),
        "session" => Some(AgentSlot::Session),
        "refine" => Some(AgentSlot::Refine),
        "review-fixer" | "review_fixer" => Some(AgentSlot::ReviewFixer),
        _ => None,
    }
}

/// Helper to serialize a typed payload to serde_json::Value.
fn to_value<T: serde::Serialize>(v: T) -> serde_json::Value {
    serde_json::to_value(v).unwrap()
}

/// Send a `feature.updated` envelope over the given WebSocket sender.
/// Usable from both `WorkflowEngine` methods and standalone contexts (e.g. `WorkflowPermissionBridge`).
fn send_feature_updated_envelope(sender: &WsSender, feature_id: i64, changed: &[&str]) {
    let payload = FeatureUpdatedPayload {
        feature_id,
        changed: changed.iter().map(|s| s.to_string()).collect(),
    };
    let envelope = WsEnvelope::new("feature", "updated", to_value(payload));
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

use crate::domain::workflow::status::WorkflowStatus;

/// CanUseTool implementation for workflow agents that bridges permission requests
/// to the frontend via workflow.permission.request envelopes.
struct WorkflowPermissionBridge {
    slot: AgentSlot,
    feature_id: i64,
    sender: WsSender,
    response_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<PermissionResponse>>>,
    worktree_path: PathBuf,
    session_cache: Arc<tokio::sync::Mutex<HashSet<String>>>,
    allowed_patterns: Arc<HashSet<String>>,
    read_pool: SqlitePool,
    write_pool: SqlitePool,
    db_session_id: i64,
}

impl WorkflowPermissionBridge {
    /// Fetch plan content as formatted markdown for display in the conversation.
    async fn fetch_plan_content(&self, plan_id: i64) -> Option<String> {
        #[derive(sqlx::FromRow)]
        struct PlanRow {
            title: String,
            summary: Option<String>,
            completion_conditions: Option<String>,
        }
        #[derive(sqlx::FromRow)]
        struct PhaseRow {
            step_number: i64,
            title: String,
            phase_type: Option<String>,
            complexity: Option<i64>,
            prompt: Option<String>,
            commit_message: Option<String>,
            depends_on: Option<String>,
        }

        let plan: PlanRow = sqlx::query_as(
            "SELECT title, summary, completion_conditions FROM plans WHERE id = ?",
        )
        .bind(plan_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()??;

        let phases: Vec<PhaseRow> = sqlx::query_as(
            "SELECT step_number, title, phase_type, complexity, prompt, commit_message, depends_on FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.read_pool)
        .await
        .unwrap_or_default();

        let mut out = format!("# Plan: {}\n", plan.title);
        if let Some(ref s) = plan.summary {
            out.push_str(&format!("\n## Summary\n{s}\n"));
        }
        if let Some(ref s) = plan.completion_conditions {
            out.push_str(&format!("\n## Completion Conditions\n{s}\n"));
        }
        if !phases.is_empty() {
            out.push_str("\n## Phases\n");
            for p in &phases {
                let phase_type = p.phase_type.as_deref().unwrap_or("value");
                let complexity = p.complexity.map(|c| c.to_string()).unwrap_or_else(|| "-".to_string());
                out.push_str(&format!(
                    "\n### Phase {} — {} `[{}]` (complexity: {})\n",
                    p.step_number, p.title, phase_type, complexity,
                ));
                if let Some(ref deps) = p.depends_on {
                    if !deps.is_empty() {
                        out.push_str(&format!("**Depends on:** {deps}\n"));
                    }
                }
                if let Some(ref cm) = p.commit_message {
                    if !cm.is_empty() {
                        out.push_str(&format!("**Commit:** `{cm}`\n"));
                    }
                }
                if let Some(ref prompt) = p.prompt {
                    if !prompt.is_empty() {
                        out.push_str(&format!("\n{prompt}\n"));
                    }
                }
            }
        }
        Some(out)
    }
}

#[async_trait]
impl CanUseTool for WorkflowPermissionBridge {
    async fn can_use_tool(&self, request: PermissionRequest) -> PermissionResult {
        debug!(
            tool_name = %request.tool_name,
            slot = %self.slot,
            "WorkflowPermissionBridge::can_use_tool called"
        );

        // Intercept approval-gate tools (show_plan, show_prd): emit WS event
        // and block on the permission channel until the user approves/rejects.
        // This avoids cross-process coordination — the approval gate runs
        // in the engine process via canUseTool, not in the MCP subprocess.
        let is_show_plan = request.tool_name.contains("show_plan");
        let is_show_prd = !is_show_plan && request.tool_name.contains("show_prd");
        if is_show_plan || is_show_prd {
            let event_name = if is_show_plan { "plan_ready" } else { "prd_ready" };
            info!(
                feature_id = self.feature_id,
                tool_name = %request.tool_name,
                "approval gate detected, emitting {} and blocking", event_name
            );

            let gate_env = WsEnvelope::new(
                "workflow",
                event_name,
                serde_json::to_value(serde_json::json!({
                    "feature_id": self.feature_id,
                    "agent_slot": self.slot,
                }))
                .unwrap(),
            );
            let _ = self.sender.send(Message::Text(String::from(gate_env).into()));

            // Update workflow status to PlanApproval when plan is shown
            if is_show_plan {
                let _ = repo::set_workflow_status(&self.write_pool, self.feature_id, WorkflowStatus::PlanApproval).await;
                let status_env = WsEnvelope::new(
                    "workflow",
                    "status_changed",
                    to_value(WorkflowStatusChangedPayload {
                        feature_id: self.feature_id,
                        status: "plan_approval".to_string(),
                        previous_status: "planning".to_string(),
                    }),
                );
                let _ = self.sender.send(Message::Text(String::from(status_env).into()));
            }

            // Emit the plan content as a synthetic text block so it appears in the
            // agent's conversation before the user decides to approve/reject.
            if is_show_plan {
                if let Ok(Some(plan_id)) = sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
                )
                .bind(self.feature_id)
                .fetch_optional(&self.read_pool)
                .await
                {
                    let plan_content = self.fetch_plan_content(plan_id).await;
                    if let Some(content) = plan_content {
                        let content_env = WsEnvelope::new(
                            "workflow",
                            "plan_content",
                            serde_json::json!({
                                "agent_slot": self.slot,
                                "session_id": self.db_session_id,
                                "content": content,
                            }),
                        );
                        let _ = self.sender.send(Message::Text(String::from(content_env).into()));
                    }
                }
            }

            // Also notify that plan/prd data is ready for fetching
            let changed: &[&str] = if is_show_plan { &["plan", "phases", "progress"] } else { &["prd"] };
            send_feature_updated_envelope(&self.sender, self.feature_id, changed);

            // Block on permission channel — frontend will send approval through
            // the same permission.respond mechanism (or plan.approved/prd.approved).
            let mut rx = self.response_rx.lock().await;
            return match rx.recv().await {
                Some(response) => match response.decision {
                    PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => {
                        PermissionResult::Allow {
                            updated_input: request.input,
                            updated_permissions: None,
                            tool_use_id: Some(request.tool_use_id),
                        }
                    }
                    PermissionDecision::Deny => {
                        let feedback = response
                            .feedback
                            .unwrap_or_else(|| "Plan/PRD rejected by user".to_string());
                        PermissionResult::Deny {
                            message: feedback,
                            interrupt: Some(false),
                            tool_use_id: Some(request.tool_use_id),
                        }
                    }
                },
                None => PermissionResult::Deny {
                    message: "Approval channel closed".to_string(),
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id),
                },
            };
        }

        let force_prompt = permissions::FRONTEND_PROMPT_TOOLS.contains(&request.tool_name.as_str());

        // Server-side resolution
        let cache = self.session_cache.lock().await;
        let resolved = permissions::resolve_permission(
            &request.tool_name,
            &request.input,
            &self.worktree_path,
            &cache,
        );
        drop(cache);

        match resolved {
            permissions::ResolvedPermission::Allow => {
                debug!(tool_name = %request.tool_name, "workflow auto-allowed");
                return PermissionResult::Allow {
                    updated_input: request.input,
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id),
                };
            }
            permissions::ResolvedPermission::Deny { reason } => {
                debug!(tool_name = %request.tool_name, reason = %reason, "workflow auto-denied");
                return PermissionResult::Deny {
                    message: reason,
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id),
                };
            }
            permissions::ResolvedPermission::NeedsPrompt { description, pattern } => {
                // Check allowed_patterns from settings files
                if !force_prompt && self.allowed_patterns.contains(&pattern) {
                    debug!(tool_name = %request.tool_name, pattern = %pattern, "workflow allowed by settings pattern");
                    self.session_cache.lock().await.insert(pattern);
                    return PermissionResult::Allow {
                        updated_input: request.input,
                        updated_permissions: None,
                        tool_use_id: Some(request.tool_use_id),
                    };
                }

                // Bridge to frontend via workflow.permission.request
                debug!(tool_name = %request.tool_name, pattern = %pattern, "workflow prompting user");
                let payload = WorkflowPermissionRequestPayload {
                    feature_id: self.feature_id,
                    agent_slot: self.slot.clone(),
                    request_id: request.tool_use_id.clone(),
                    tool_name: request.tool_name.clone(),
                    tool_input: request.input.clone(),
                    description: Some(description),
                    pattern: Some(pattern.clone()),
                };
                let envelope = WsEnvelope::new(
                    "workflow",
                    "permission.request",
                    serde_json::to_value(payload).unwrap(),
                );
                let _ = self.sender.send(Message::Text(String::from(envelope).into()));

                // Wait for user response
                let original_input = request.input;
                let mut rx: tokio::sync::MutexGuard<'_, mpsc::Receiver<PermissionResponse>> = self.response_rx.lock().await;
                match rx.recv().await {
                    Some(response) => {
                        let input = response.updated_input.unwrap_or(original_input);
                        match response.decision {
                            PermissionDecision::AllowOnce => {
                                if !force_prompt {
                                    self.session_cache.lock().await.insert(pattern);
                                }
                                PermissionResult::Allow {
                                    updated_input: input,
                                    updated_permissions: None,
                                    tool_use_id: Some(request.tool_use_id),
                                }
                            }
                            PermissionDecision::AllowFuture => {
                                self.session_cache.lock().await.insert(pattern.clone());
                                if let Err(e) = permissions::append_to_settings_local(
                                    &self.worktree_path,
                                    &pattern,
                                ) {
                                    error!(error = %e, "failed to persist workflow permission to settings.local.json");
                                }
                                PermissionResult::Allow {
                                    updated_input: input,
                                    updated_permissions: None,
                                    tool_use_id: Some(request.tool_use_id),
                                }
                            }
                            PermissionDecision::Deny => {
                                let message = response
                                    .feedback
                                    .unwrap_or_else(|| "User denied permission".to_string());
                                PermissionResult::Deny {
                                    message,
                                    interrupt: Some(false),
                                    tool_use_id: Some(request.tool_use_id),
                                }
                            }
                        }
                    }
                    None => {
                        PermissionResult::Deny {
                            message: "Permission channel closed".to_string(),
                            interrupt: Some(false),
                            tool_use_id: Some(request.tool_use_id),
                        }
                    }
                }
            }
        }
    }
}

pub struct WorkflowEngine {
    pub feature_id: i64,
    pub workflow_type: WorkflowType,
    pub strategy: Box<dyn WorkflowStrategy>,
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub ws_sender: WsSender,
    pub autonomy_level: AtomicU8,
    pub max_parallel: usize,
    /// AgentSlot → db_session_id
    pub active_items: Arc<DashMap<AgentSlot, i64>>,
    /// AgentSlot → Query handle (for interrupt/stream_input)
    pub queries: Arc<DashMap<AgentSlot, Arc<tokio::sync::Mutex<Query>>>>,
    /// AgentSlot → permission response sender (for bridging permissions to agents)
    pub permission_txs: Arc<DashMap<AgentSlot, mpsc::Sender<PermissionResponse>>>,
    /// Unix timestamp (seconds) of last activity — updated on advance/completion/error.
    pub last_activity: AtomicU64,
    /// Items that were explicitly interrupted (to distinguish from normal completion).
    pub interrupted_items: Arc<DashSet<AgentSlot>>,
    /// AgentSlot → Claude Code session ID (for --resume after interrupt)
    pub paused_sessions: Arc<DashMap<AgentSlot, String>>,
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
        let strategy = strategies::get_strategy(&workflow_type)
            .expect("WorkflowEngine::new called with unsupported workflow type");
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
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
            permission_txs: Arc::new(DashMap::new()),
            interrupted_items: Arc::new(DashSet::new()),
            paused_sessions: Arc::new(DashMap::new()),
            last_activity: AtomicU64::new(now_secs),
            cancel_tx,
            cancel_rx,
        }
    }

    /// Spawn a plan agent for this feature. The plan agent runs outside the queue
    /// and uses a synthetic queue_item_id of -1 for streaming.
    pub async fn spawn_plan_agent(&self, description: &str) -> Result<i64, String> {
        self.set_status(WorkflowStatus::Planning).await;
        // Check if a PRD exists — if so, use PRD-specific preamble
        let prd: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT prd FROM features WHERE id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read feature PRD: {e}"))?
        .flatten();

        let (preamble, desc) = if let Some(ref prd_content) = prd {
            if !prd_content.is_empty() {
                (
                    "Please create a detailed implementation plan based on the following Product Requirements Document (PRD):\n\n",
                    prd_content.as_str(),
                )
            } else {
                ("Please create a detailed implementation plan for the following feature:\n\n", description)
            }
        } else {
            ("Please create a detailed implementation plan for the following feature:\n\n", description)
        };

        let plan_instructions = "Start by exploring the codebase to understand the project structure and existing patterns. \
            Then ask me clarifying questions. Finally, build the phased plan using the tools, call show_plan, and ask for my approval.";

        let enriched_prompt = format!(
            "{preamble}{desc}\n\n{plan_instructions}"
        );

        self.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            &enriched_prompt,
            AgentSlot::Plan,
        )
        .await
    }

    /// Spawn a PRD agent for this feature.
    pub async fn spawn_prd_agent(&self, description: &str) -> Result<i64, String> {
        self.set_status(WorkflowStatus::Prd).await;
        let prd_instructions = "Use the MCP tools to build the PRD. Call create_prd to store the initial PRD content, \
            then call show_prd to present it for approval. If rejected, use edit_prd for targeted changes \
            (or create_prd for full rewrites), then call show_prd again. Once approved, call mark_agent_done.";

        let enriched_prompt = format!(
            "Please create a comprehensive PRD for the following feature:\n\n{description}\n\n{prd_instructions}"
        );

        self.spawn_pre_queue_agent(
            AgentType::Prd,
            "prd",
            Prompts::prd(),
            &enriched_prompt,
            AgentSlot::Prd,
        )
        .await
    }

    /// Spawn a session agent for ad-hoc exploration/debugging.
    pub async fn spawn_session_agent(&self, prompt: &str) -> Result<i64, String> {
        self.spawn_pre_queue_agent(
            AgentType::Session,
            "session",
            Prompts::session(),
            prompt,
            AgentSlot::Session,
        )
        .await
    }

    /// Spawn a plan refinement agent that re-runs the plan agent with
    /// context about existing phases.
    pub async fn spawn_refine_agent(&self, description: &str) -> Result<i64, String> {
        let refinement_prompt = match self.build_refine_context(description).await {
            Ok(prompt) => prompt,
            Err(e) => {
                warn!(feature_id = self.feature_id, error = %e, "failed to build refine context, using simple prompt");
                format!(
                    "The user wants to refine the existing plan.\n\n\
                     User's refinement request:\n{description}\n\n\
                     Please update the plan accordingly — add, modify, or remove phases as needed."
                )
            }
        };

        self.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            &refinement_prompt,
            AgentSlot::Refine,
        )
        .await
    }

    /// Build a rich refinement context matching the legacy `buildRefineContext()`.
    /// Includes plan summary, codebase context, all existing phases with status,
    /// and refinement instructions with correct step numbering.
    async fn build_refine_context(&self, description: &str) -> Result<String, String> {
        // Fetch the plan
        let plan: Option<(i64, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT id, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch plan: {e}"))?;

        let (plan_id, summary, context) = plan.ok_or("No plan found for this feature — cannot refine without an existing plan.")?;

        // Fetch all phases with status/notes
        let phases: Vec<(i64, String, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT step_number, title, status, implementation_notes, phase_type FROM phases \
             WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch phases: {e}"))?;

        let max_step = phases.iter().map(|(s, _, _, _, _)| *s).max().unwrap_or(0);

        let mut parts: Vec<String> = Vec::new();
        if let Some(ref s) = summary {
            if !s.is_empty() {
                parts.push(format!("**Plan Summary:** {s}"));
            }
        }
        if let Some(ref c) = context {
            if !c.is_empty() {
                parts.push(format!("**Codebase Context:** {c}"));
            }
        }

        if !phases.is_empty() {
            parts.push("\n## Existing Phases:".to_string());
            for (step, title, status, notes, phase_type) in &phases {
                let mut line = format!("Step {step}. [{}] {title}", status.to_uppercase());
                if let Some(pt) = phase_type {
                    line.push_str(&format!(" ({pt})"));
                }
                if let Some(n) = notes {
                    if !n.is_empty() {
                        line.push_str(&format!("\n   Notes: {n}"));
                    }
                }
                parts.push(line);
            }
        }

        let refine_instructions = format!(
            "\n## Refinement Instructions\n\
             This is a REFINEMENT of an existing plan (Plan ID: {plan_id}). The phases listed above already exist.\n\
             - Do NOT recreate or duplicate completed phases.\n\
             - Add NEW phases to extend the plan based on the user's request below.\n\
             - Use step numbers starting from {}.\n\
             - You may also update or remove existing DRAFT or PENDING phases if needed.\n\
             - After building the new phases, call show_plan for approval, then finalize_plan.",
            max_step + 1,
        );

        Ok(format!(
            "{}\n{refine_instructions}\n\n## User's Refinement Request\n{description}",
            parts.join("\n"),
        ))
    }

    /// Shared logic for spawning plan/PRD agents (pre-queue agents).
    async fn spawn_pre_queue_agent(
        &self,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: &str,
        initial_prompt: &str,
        slot: AgentSlot,
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
        self.permission_txs.insert(slot.clone(), perm_tx);
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
        };

        // 5. Build options and spawn
        let mut options = Options {
            cwd,
            permission_mode: Some(PermissionMode::AcceptEdits),
            system_prompt: if system_prompt.is_empty() {
                None
            } else {
                // Inject feature_id context so the agent knows its feature
                // and can use MCP tools without guessing IDs
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

        // Persist the initial user prompt and send it to the frontend so it's visible
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

                // Store Query handle for interrupt support (skip PID persist for synthetic IDs)
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                self.queries.insert(slot.clone(), query_handle);

                // Track in active items
                self.active_items.insert(slot.clone(), db_session_id);

                // Spawn stream reader (reuses the same workflow stream reader)
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

                // Send agent started envelope
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

    /// Update the last_activity timestamp to now.
    fn touch_activity(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_activity.store(now, Ordering::Relaxed);
    }

    /// Transition the workflow to a new status, persisting to DB and notifying the frontend.
    /// Logs a warning and continues if the transition is invalid (to avoid blocking the workflow).
    pub async fn set_status(&self, new_status: WorkflowStatus) {
        let current = repo::get_workflow_status(&self.read_pool, self.feature_id)
            .await
            .unwrap_or(WorkflowStatus::Idle);

        if current == new_status {
            return;
        }

        match repo::set_workflow_status(&self.write_pool, self.feature_id, new_status).await {
            Ok(_) => {
                info!(feature_id = self.feature_id, from = %current, to = %new_status, "workflow status changed");
            }
            Err(e) => {
                // Force-set on invalid transition to avoid getting stuck
                warn!(feature_id = self.feature_id, from = %current, to = %new_status, error = %e, "invalid transition, force-setting");
                let _ = repo::force_workflow_status(&self.write_pool, self.feature_id, new_status).await;
            }
        }

        // Notify frontend
        let envelope = WsEnvelope::new(
            "workflow",
            "status_changed",
            to_value(WorkflowStatusChangedPayload {
                feature_id: self.feature_id,
                status: new_status.to_string(),
                previous_status: current.to_string(),
            }),
        );
        let _ = self.ws_sender.send(Message::Text(String::from(envelope).into()));
    }

    /// Check if all queue items are completed/skipped and no active items remain.
    /// If so, transition to Completed status.
    async fn check_workflow_completion(&self) {
        if !self.active_items.is_empty() {
            return;
        }
        if let Ok(items) = repo::get_queue_for_feature(&self.read_pool, self.feature_id).await {
            if !items.is_empty() && items.iter().all(|i| i.status == "completed" || i.status == "skipped") {
                self.set_status(WorkflowStatus::Completed).await;
            }
        }
    }

    /// Advance the workflow: unblock ready items and start them up to capacity.
    pub async fn advance(&self) -> Result<(), String> {
        self.touch_activity();
        let running = self.active_items.len();

        if running >= self.max_parallel {
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

        let capacity = self.max_parallel - running;
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

        // Send differential item update
        self.send_item_update(item_id).await;

        // 2. Delegate to strategy
        let agent_type = self.strategy.agent_type_for_item(&item.item_type)?;
        let autonomy = self.autonomy_level.load(Ordering::Relaxed);
        let system_prompt = self.strategy.build_system_prompt(&self.read_pool, &item, autonomy).await?;
        let feature_title = self.get_feature_title().await.unwrap_or_default();
        let initial_prompt = self
            .strategy
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
        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!("No working directory found for feature {}. Was ensure_worktree called?", self.feature_id)
        })?;

        // 6. Set up permission bridge
        let slot = AgentSlot::QueueItem(item_id);
        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResponse>(16);
        self.permission_txs.insert(slot.clone(), perm_tx);
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
        };

        // 7. Build Options and spawn
        let mut options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::AcceptEdits),
            system_prompt: if system_prompt.is_empty() { None } else { Some(system_prompt) },
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        // Persist the initial user prompt and send it to the frontend so it's visible
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

                // Persist PID for interrupt fallback (survives reconnect/restart)
                if let Some(pid) = real_query.pid() {
                    if let Err(e) = repo::update_item_pid(&self.write_pool, item_id, pid as i64).await {
                        warn!(item_id, error = %e, "failed to persist agent PID");
                    }
                }

                // Store Query handle for interrupt support
                let query_handle = Arc::new(tokio::sync::Mutex::new(real_query));
                self.queries.insert(slot.clone(), query_handle);

                // Track in active items
                self.active_items.insert(slot.clone(), db_session_id);

                // Spawn workflow stream reader
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

                // Send item_started envelope
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
                self.on_item_error(AgentSlot::QueueItem(item_id), &e.to_string()).await;
                Err(format!("SDK spawn failed: {e}"))
            }
        }
    }

    /// Called when a queue item completes successfully.
    pub async fn on_item_completed(&self, slot: AgentSlot, result: Option<&str>) {
        // If this item was interrupted, treat as paused instead of completed
        if self.interrupted_items.remove(&slot).is_some() {
            self.on_item_paused(slot).await;
            return;
        }

        self.touch_activity();
        info!(feature_id = self.feature_id, slot = %slot, "queue item completed");

        self.active_items.remove(&slot);
        self.queries.remove(&slot);
        self.permission_txs.remove(&slot);
        self.paused_sessions.remove(&slot);

        let legacy_id = slot.as_legacy_id();
        if let Err(e) = repo::mark_item_completed(&self.write_pool, legacy_id, result).await {
            error!(slot = %slot, error = %e, "failed to mark item completed");
        }

        // Send differential item update (only for real queue items)
        if let AgentSlot::QueueItem(item_id) = &slot {
            self.send_item_update(*item_id).await;
        }

        // Send item_completed envelope
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

        // Notify frontend when pre-queue agents (plan/prd) complete
        if matches!(slot, AgentSlot::Plan) {
            self.send_feature_updated(&["plan", "phases", "progress"]);
        } else if matches!(slot, AgentSlot::Prd) {
            self.send_feature_updated(&["prd"]);
        }

        // Part A: If a "review" item just completed, check for new phases and re-populate
        if let AgentSlot::QueueItem(item_id) = &slot {
            if let Ok(Some(item)) = repo::get_queue_item(&self.read_pool, *item_id).await {
                // Notify frontend for item types that affect plan progress/phases
                if matches!(item.item_type.as_str(), "execute" | "review") {
                    self.send_feature_updated(&["progress", "phases"]);
                }
                if item.item_type == "review" {
                    if let Err(e) = self.re_populate_queue_for_new_phases().await {
                        warn!(feature_id = self.feature_id, error = %e, "re-populate after review failed");
                    }
                }
            }
        }

        // Autonomy-based advancement
        match self.autonomy_level.load(Ordering::Relaxed) {
            3 => {
                if let Err(e) = self.advance().await {
                    error!(error = %e, "advance after completion failed");
                }
            }
            2 => {
                // Advance if next ready items share the same group_index
                if let Ok(ready) = repo::unblock_ready_items(&self.write_pool, self.feature_id).await {
                    if !ready.is_empty() {
                        let current_group = if let AgentSlot::QueueItem(id) = &slot {
                            self.get_current_group_index(*id).await
                        } else {
                            None
                        };
                        let same_group = ready.iter().all(|r| r.group_index == current_group);
                        if same_group {
                            // Same group — start them directly without re-querying
                            let capacity = self.max_parallel - self.active_items.len();
                            for item in ready.into_iter().take(capacity) {
                                if let Err(e) = self.start_item(item).await {
                                    error!(error = %e, "failed to start queue item");
                                }
                            }
                        } else {
                            self.set_status(WorkflowStatus::Paused).await;
                            let envelope = WsEnvelope::new(
                                "workflow",
                                "paused",
                                to_value(WorkflowPausedPayload {
                                    feature_id: self.feature_id,
                                    reason: "group_boundary".into(),
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
                self.set_status(WorkflowStatus::Paused).await;
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

        // Check if all items are completed after advancement
        self.check_workflow_completion().await;
    }

    /// Called when a queue item is paused (interrupted by user).
    /// Keeps the session alive so it can be resumed later.
    async fn on_item_paused(&self, slot: AgentSlot) {
        self.touch_activity();
        info!(feature_id = self.feature_id, slot = %slot, "queue item paused (interrupted)");

        // Session ID was already captured in interrupt_item (before stream reader removes query handle)
        // Don't remove active_items or permission_txs — we want to resume
        // Query handle is already removed by the stream reader at this point

        // Mark as paused in DB (only for real queue items)
        if let AgentSlot::QueueItem(item_id) = &slot {
            let _ = sqlx::query("UPDATE workflow_queue SET status = 'paused' WHERE id = ?")
                .bind(item_id)
                .execute(&self.write_pool)
                .await;
            self.send_item_update(*item_id).await;
        }

        // Mark the agent session as paused and persist claude_session_id for resume across restarts
        if let Some(db_session_id) = self.active_items.get(&slot) {
            let db_sid = *db_session_id;
            WsSessionPersistence::mark_paused_static(&self.write_pool, db_sid).await;

            // Persist the claude_session_id from in-memory paused_sessions to DB
            // so it survives engine recreation on page navigation / reconnect
            if let Some(cc_sid_ref) = self.paused_sessions.get(&slot) {
                let cc_sid = cc_sid_ref.clone();
                debug!(slot = %slot, db_session_id = db_sid, cc_session_id = %cc_sid, "persisting claude_session_id to DB for resume");
                WsSessionPersistence::persist_claude_session_id_static(&self.write_pool, db_sid, &cc_sid).await;
            }
        }
    }

    /// Called when a queue item errors.
    pub async fn on_item_error(&self, slot: AgentSlot, error: &str) {
        // If this item was interrupted, treat as paused instead of error
        if self.interrupted_items.remove(&slot).is_some() {
            self.on_item_paused(slot).await;
            return;
        }

        self.touch_activity();
        warn!(feature_id = self.feature_id, slot = %slot, error, "queue item errored");

        self.active_items.remove(&slot);
        self.queries.remove(&slot);
        self.permission_txs.remove(&slot);
        self.paused_sessions.remove(&slot);

        let legacy_id = slot.as_legacy_id();
        if let Err(e) = repo::mark_item_error(&self.write_pool, legacy_id, Some(error)).await {
            error!(slot = %slot, error = %e, "failed to mark item error");
        }

        // Send differential item update (only for real queue items)
        if let AgentSlot::QueueItem(item_id) = &slot {
            self.send_item_update(*item_id).await;
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

        // Set Error status if no other items are still running
        if self.active_items.is_empty() {
            self.set_status(WorkflowStatus::Error).await;
        }
    }

    /// Interrupt a running queue item.
    /// Fast path: use in-memory Query handle. Fallback: PID from DB.
    pub async fn interrupt_item(&self, slot: AgentSlot) -> Result<(), String> {
        // Mark as interrupted so the stream reader treats completion as pause
        self.interrupted_items.insert(slot.clone());

        // Capture Claude Code session ID NOW while the query handle still exists
        // (the stream reader will remove the handle before on_item_paused runs)
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            if let Some(cc_session_id) = q.session_id().await {
                debug!(slot = %slot, cc_session_id = %cc_session_id, "captured Claude session ID for resume");
                self.paused_sessions.insert(slot.clone(), cc_session_id);
            }
            return q.interrupt().await.map_err(|e| format!("Interrupt failed: {e}"));
        }
        // Fallback: PID from DB (handles refresh + restart) — only for real queue items
        if let AgentSlot::QueueItem(item_id) = &slot {
            return self.interrupt_by_pid(*item_id).await;
        }
        Err(format!("No query handle for slot {slot}"))
    }

    /// PID-based interrupt fallback. Used when no in-memory Query handle exists
    /// (e.g., after reconnect/restart).
    ///
    /// # Safety note on PID reuse
    /// There is an inherent TOCTOU race with PID-based signals: between reading the PID
    /// from the DB and sending the signal, the process could exit and the PID could be
    /// reassigned to an unrelated process. This is mitigated by:
    /// 1. Preferring the in-memory Query handle path (interrupt_item tries that first).
    /// 2. This being a last-resort fallback that logs a warning.
    /// The risk is low in practice because PID reuse on modern systems cycles through
    /// a large PID space, and the window between DB read and kill() is very short.
    async fn interrupt_by_pid(&self, queue_item_id: i64) -> Result<(), String> {
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
                    // Process already dead — mark item as error
                    self.on_item_error(AgentSlot::QueueItem(queue_item_id), "Agent process no longer running").await;
                    Err("Process already exited".into())
                } else {
                    Err(format!("kill({pid}, SIGINT) failed: {err}"))
                }
            }
        } else {
            Err(format!("No query handle or PID for item {queue_item_id}"))
        }
    }

    /// Route a permission response to the correct agent's permission channel.
    pub async fn respond_permission(&self, slot: AgentSlot, response: PermissionResponse) -> Result<(), String> {
        if let Some(tx) = self.permission_txs.get(&slot) {
            return tx.send(response).await
                .map_err(|_| format!("Permission channel closed for slot {slot}"));
        }
        Err(format!("No permission channel for slot {slot} — agent may need restart"))
    }

    /// Send a follow-up prompt to a running workflow agent.
    /// If the agent was paused (interrupted), this will resume it by spawning
    /// a new Claude Code process with `--resume`.
    pub async fn send_prompt(&self, slot: AgentSlot, text: &str, _images: Option<Vec<String>>) -> Result<(), String> {
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
            return self.resume_item(slot, &cc_session_id, text).await;
        }

        // Fallback: check DB for a claude_session_id we can resume with
        // (handles the case where paused_sessions wasn't populated, e.g. page refresh)
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
                    return self.resume_item(slot, &cc_sid, text).await;
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
            ).await.map(|_| ());
        }

        Err(format!("No query handle for slot {slot} — agent may need restart"))
    }

    /// Resume a paused agent by spawning a new Claude Code process with `--resume`.
    async fn resume_item(&self, slot: AgentSlot, cc_session_id: &str, prompt: &str) -> Result<(), String> {
        let db_session_id = self.active_items.get(&slot)
            .map(|r| *r)
            .ok_or_else(|| format!("No active session for slot {slot}"))?;

        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!("No working directory found for feature {}", self.feature_id)
        })?;

        // Determine agent type for MCP config
        let agent_type = slot.sdk_agent_type().unwrap_or(AgentType::Execute);
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);

        // Set up permission bridge
        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResponse>(16);
        self.permission_txs.insert(slot.clone(), perm_tx);
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
        };

        // Build options with --resume
        let mut options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::AcceptEdits),
            resume: Some(cc_session_id.to_string()),
            mcp_servers: Some(mcp_servers),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        // Use the user's prompt if non-empty, otherwise just resume
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

                // Update queue item status back to running
                if let AgentSlot::QueueItem(item_id) = &slot {
                    let _ = sqlx::query("UPDATE workflow_queue SET status = 'running' WHERE id = ?")
                        .bind(item_id)
                        .execute(&self.write_pool)
                        .await;
                    self.send_item_update(*item_id).await;
                }

                // Update agent session status
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

    /// Retry a failed queue item.
    pub async fn retry_item(&self, item_id: i64) -> Result<(), String> {
        info!(feature_id = self.feature_id, item_id, "retrying queue item");

        sqlx::query("UPDATE workflow_queue SET status = 'ready', started_at = NULL, ended_at = NULL, result = NULL WHERE id = ?")
            .bind(item_id)
            .execute(&self.write_pool)
            .await
            .map_err(|e| format!("Failed to reset item for retry: {e}"))?;

        // Send differential item update
        self.send_item_update(item_id).await;

        self.advance().await
    }

    /// Skip a queue item and unblock dependents.
    pub async fn skip_item(&self, item_id: i64) -> Result<(), String> {
        info!(feature_id = self.feature_id, item_id, "skipping queue item");

        repo::mark_item_skipped(&self.write_pool, item_id)
            .await
            .map_err(|e| e.to_string())?;

        self.active_items.remove(&AgentSlot::QueueItem(item_id));

        // Send differential item update
        self.send_item_update(item_id).await;

        let envelope = WsEnvelope::new(
            "workflow",
            "item_skipped",
            to_value(WorkflowItemSkippedPayload {
                feature_id: self.feature_id,
                agent_slot: AgentSlot::QueueItem(item_id),
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

    /// Get the feature's working directory.
    /// Prefers worktree_path from feature_settings if set, otherwise falls back to project directory.
    async fn get_feature_cwd(&self) -> Option<PathBuf> {
        // Check for worktree_path in feature_settings first
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
        // Fall back to project directory
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT p.path FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
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
                    active_items.remove(&AgentSlot::QueueItem(item_id));

                    if let Err(e) = repo::mark_item_error(&write_pool, item_id, Some("Agent timed out")).await {
                        error!(item_id, error = %e, "failed to mark timed-out item");
                        continue;
                    }

                    let envelope = WsEnvelope::new(
                        "workflow",
                        "item_error",
                        to_value(WorkflowItemErrorPayload {
                            feature_id,
                            agent_slot: AgentSlot::QueueItem(item_id),
                            error: "Agent timed out".into(),
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

        // Restore paused pre-queue agents from DB so they can be resumed via prompt.send.
        // Look for agent_sessions that were running/paused and have a claude_session_id.
        let resumable_sessions: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT id, agent_type, claude_session_id FROM agent_sessions \
             WHERE feature_id = ? AND claude_session_id IS NOT NULL \
             AND status IN ('running', 'paused') \
             ORDER BY id DESC",
        )
        .bind(self.feature_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| e.to_string())?;

        // Resolve slots once, populate in-memory state, and collect for notification
        let mut restored: Vec<(AgentSlot, i64, String, String)> = Vec::new(); // (slot, db_session_id, agent_type, cc_session_id)
        for (db_session_id, agent_type, cc_session_id) in &resumable_sessions {
            let Some(slot) = agent_type_str_to_slot(agent_type) else {
                continue; // regular queue items handled separately
            };
            info!(
                feature_id = self.feature_id,
                db_session_id,
                agent_type = agent_type.as_str(),
                cc_session_id = cc_session_id.as_str(),
                slot = %slot,
                "restoring paused pre-queue agent for resume"
            );
            self.paused_sessions.insert(slot.clone(), cc_session_id.clone());
            self.active_items.insert(slot.clone(), *db_session_id);
            WsSessionPersistence::mark_paused_static(&self.write_pool, *db_session_id).await;
            restored.push((slot, *db_session_id, agent_type.clone(), cc_session_id.clone()));
        }

        // Mark any queue items that were "running" as error (stale from server restart)
        sqlx::query(
            "UPDATE workflow_queue SET status = 'error', result = 'Stale after reconnect', ended_at = datetime('now'), pid = NULL WHERE feature_id = ? AND status = 'running'",
        )
        .bind(self.feature_id)
        .execute(&self.write_pool)
        .await
        .map_err(|e| e.to_string())?;

        // Send full queue update with DB-stored status
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

        Ok(())
    }

    /// Broadcast a `feature.updated` event to the frontend.
    /// `changed` lists which aspects changed (e.g. "plan", "prd", "phases", "title", "settings", "progress").
    pub fn send_feature_updated(&self, changed: &[&str]) {
        send_feature_updated_envelope(&self.ws_sender, self.feature_id, changed);
    }

    async fn send_item_update(&self, item_id: i64) {
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

    /// Send the initial user message to the frontend as an `agent_user_message` event.
    /// This lets the UI display the first prompt that was sent to the agent.
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

    /// After a review item completes, check if the review agent created new phases
    /// (via create_phase MCP tool). If so, add new queue items for those phases.
    async fn re_populate_queue_for_new_phases(&self) -> Result<(), String> {
        // Get the plan for this feature
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

        // Get all phases for the plan
        let all_phases: Vec<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id, title, depends_on FROM phases WHERE plan_id = ? ORDER BY order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read phases: {e}"))?;

        // Get phase_ids already in the queue
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

        // Add a new review item after the fix phases
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

        // Make the new review depend on all the new fix items
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

        // Send full queue update to frontend
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

        // Send review_verdict envelope so frontend knows
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

    /// Spawn a review fixer agent for manual fix requests.
    pub async fn spawn_review_fixer_agent(&self, comments: &str) -> Result<i64, String> {
        let system_prompt = "You are a code review fixer. The user has reviewed a diff and provided comments. \
            Fix the issues described in the comments. Make minimal, focused changes.";

        self.spawn_pre_queue_agent(
            AgentType::Execute,
            "review-fixer",
            system_prompt,
            comments,
            AgentSlot::ReviewFixer,
        )
        .await
    }

    /// Mark a running agent as done (clean shutdown). Used for ad-hoc/session agents.
    pub async fn mark_done(&self, slot: AgentSlot) -> Result<(), String> {
        if let Some(query) = self.queries.get(&slot) {
            let q = query.lock().await;
            let _ = q.interrupt().await;
        }

        self.active_items.remove(&slot);
        self.queries.remove(&slot);
        self.permission_txs.remove(&slot);

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
}

/// Spawn a background task that reads agent stream messages and forwards them
/// via the workflow domain, then triggers engine callbacks on completion/error.
fn spawn_workflow_stream_reader(
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
        // Track which feature aspects need refreshing after the current tool call completes.
        // Set from Assistant messages (tool_use blocks), cleared when User message (tool_result) arrives.
        let mut pending_feature_update: Option<Vec<&'static str>> = None;

        loop {
            match message_rx.recv().await {
                Some(Ok(sdk_msg)) => {
                    // Capture claude_session_id from the first message that has one
                    if needs_session_id_capture {
                        if let Some(cli_sid) = sdk_msg.session_id() {
                            if !cli_sid.is_empty() {
                                needs_session_id_capture = false;
                                debug!(slot = %slot, db_session_id, claude_session_id = %cli_sid, "persisting CLI session_id to DB");
                                WsSessionPersistence::persist_claude_session_id_static(
                                    &write_pool, db_session_id, cli_sid,
                                ).await;
                                // Notify frontend so it can display/track the session ID
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
                            // Interrupt the running CLI process so it doesn't continue without tools
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

                    if sender
                        .send(Message::Text(String::from(envelope).into()))
                        .is_err()
                    {
                        warn!(
                            slot = %slot,
                            "WS sender closed, stopping workflow stream reader"
                        );
                        break;
                    }

                    // Result received — agent is done. Break immediately so we
                    // run the post-stream callbacks (on_item_completed). Without
                    // this, the loop blocks on message_rx.recv() forever because
                    // the CLI process may not exit (mark_agent_done is a no-op
                    // in MCP subprocess mode).
                    if completed_ok {
                        debug!(slot = %slot, "breaking out of stream loop after Result");
                        break;
                    }

                    // Live-refresh: detect plan/phase-modifying tool calls via the
                    // Assistant→User message pair. The Assistant message contains
                    // tool_use blocks (tool about to run); the User message contains
                    // the tool_result (tool finished). We collect which fields changed
                    // from the Assistant and emit feature.updated on the User message.
                    match &sdk_msg {
                        SdkMessage::Assistant { message, .. } => {
                            use claude_agent_sdk_rs::types::ContentBlock;
                            let mut fields: Vec<&'static str> = Vec::new();
                            for block in &message.content {
                                if let ContentBlock::ToolUse { name, .. } = block {
                                    if name.contains("create_phase") || name.contains("finalize_phases") {
                                        fields.extend_from_slice(&["phases", "progress"]);
                                    } else if name.contains("finalize_plan") {
                                        fields.extend_from_slice(&["plan", "phases", "progress"]);
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
                            // Tool result arrived — the tool has finished executing.
                            if let Some(fields) = pending_feature_update.take() {
                                send_feature_updated_envelope(&sender, feature_id, &fields);
                            }
                        }
                        SdkMessage::ToolUseSummary { ref data, .. } => {
                            // Fallback: some tool calls may emit summaries directly
                            if let Some(tool_name) = data.get("tool_name").and_then(|v| v.as_str()) {
                                let changed: Option<&[&str]> = match tool_name {
                                    t if t.contains("create_phase") || t.contains("finalize_phases") => {
                                        Some(&["phases", "progress"])
                                    }
                                    t if t.contains("finalize_plan") => {
                                        Some(&["plan", "phases", "progress"])
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

impl Drop for WorkflowEngine {
    fn drop(&mut self) {
        // Safety net: cancel background tasks when the engine is dropped.
        let _ = self.cancel_tx.send(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    /// Helper: create in-memory SQLite pool for tests.
    async fn test_pool() -> SqlitePool {
        SqlitePool::connect("sqlite::memory:").await.unwrap()
    }

    /// Helper: create a WorkflowEngine with in-memory pools and a dummy WsSender.
    async fn test_engine() -> (WorkflowEngine, mpsc::UnboundedReceiver<Message>) {
        let pool = test_pool().await;
        let (tx, rx) = mpsc::unbounded_channel();
        let engine = WorkflowEngine::new(
            1,
            WorkflowType::FeatureBuild,
            pool.clone(),
            pool,
            tx,
            2,
        );
        (engine, rx)
    }

    // ── 1. Constants ──

    #[test]
    fn test_synthetic_item_ids_are_negative() {
        assert!(PLAN_ITEM_ID < 0);
        assert!(PRD_ITEM_ID < 0);
        assert!(SESSION_ITEM_ID < 0);
        assert!(REFINE_ITEM_ID < 0);
    }

    #[test]
    fn test_synthetic_item_ids_are_distinct() {
        let ids = [PLAN_ITEM_ID, PRD_ITEM_ID, SESSION_ITEM_ID, REFINE_ITEM_ID];
        let unique: std::collections::HashSet<i64> = ids.iter().copied().collect();
        assert_eq!(unique.len(), ids.len(), "Synthetic IDs must be unique");
    }

    // ── 2. WorkflowEngine creation and initialization ──

    #[tokio::test]
    async fn test_engine_creation_defaults() {
        let (engine, _rx) = test_engine().await;

        assert_eq!(engine.feature_id, 1);
        assert_eq!(engine.workflow_type, WorkflowType::FeatureBuild);
        assert_eq!(engine.max_parallel, 2);
        assert_eq!(engine.autonomy_level.load(Ordering::Relaxed), 3);
        assert!(engine.active_items.is_empty());
        assert!(engine.queries.is_empty());
        assert!(engine.permission_txs.is_empty());
        assert!(engine.interrupted_items.is_empty());
        assert!(engine.paused_sessions.is_empty());
    }

    #[tokio::test]
    async fn test_engine_last_activity_initialized() {
        let (engine, _rx) = test_engine().await;
        let activity = engine.last_activity.load(Ordering::Relaxed);
        // Should be a reasonable recent timestamp (after 2020)
        assert!(activity > 1_577_836_800, "last_activity should be a recent Unix timestamp");
    }

    #[tokio::test]
    async fn test_engine_touch_activity_updates_timestamp() {
        let (engine, _rx) = test_engine().await;
        let before = engine.last_activity.load(Ordering::Relaxed);
        // touch_activity should update to current time (same second or later)
        engine.touch_activity();
        let after = engine.last_activity.load(Ordering::Relaxed);
        assert!(after >= before);
    }

    // ── 3. Strategy registry ──

    #[test]
    fn test_strategy_feature_build() {
        let strategy = strategies::get_strategy(&WorkflowType::FeatureBuild);
        assert!(strategy.is_ok());
        assert_eq!(strategy.unwrap().workflow_type(), WorkflowType::FeatureBuild);
    }

    // ── 4. DashMap-based state tracking (queue ordering, active items) ──

    #[tokio::test]
    async fn test_active_items_tracking() {
        let (engine, _rx) = test_engine().await;

        // Simulate tracking active items
        engine.active_items.insert(AgentSlot::QueueItem(10), 100);
        engine.active_items.insert(AgentSlot::QueueItem(20), 200);

        assert_eq!(engine.active_items.len(), 2);
        assert_eq!(*engine.active_items.get(&AgentSlot::QueueItem(10)).unwrap(), 100);
        assert_eq!(*engine.active_items.get(&AgentSlot::QueueItem(20)).unwrap(), 200);

        // Remove one
        engine.active_items.remove(&AgentSlot::QueueItem(10));
        assert_eq!(engine.active_items.len(), 1);
        assert!(engine.active_items.get(&AgentSlot::QueueItem(10)).is_none());
    }

    #[tokio::test]
    async fn test_interrupted_items_tracking() {
        let (engine, _rx) = test_engine().await;

        engine.interrupted_items.insert(AgentSlot::QueueItem(42));
        assert!(engine.interrupted_items.contains(&AgentSlot::QueueItem(42)));

        // remove returns Some if it was present
        let removed = engine.interrupted_items.remove(&AgentSlot::QueueItem(42));
        assert!(removed.is_some());

        // Double remove returns None
        let removed_again = engine.interrupted_items.remove(&AgentSlot::QueueItem(42));
        assert!(removed_again.is_none());
    }

    #[tokio::test]
    async fn test_paused_sessions_tracking() {
        let (engine, _rx) = test_engine().await;

        engine.paused_sessions.insert(AgentSlot::QueueItem(5), "session-abc".to_string());
        assert_eq!(*engine.paused_sessions.get(&AgentSlot::QueueItem(5)).unwrap(), "session-abc");

        // Remove returns the value
        let removed = engine.paused_sessions.remove(&AgentSlot::QueueItem(5));
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().1, "session-abc");
    }

    // ── 5. Permission channel routing ──

    #[tokio::test]
    async fn test_respond_permission_no_channel() {
        let (engine, _rx) = test_engine().await;

        let response = PermissionResponse {
            decision: PermissionDecision::AllowOnce,
            feedback: None,
            updated_input: None,
        };
        let result = engine.respond_permission(AgentSlot::QueueItem(999), response).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No permission channel"));
    }

    #[tokio::test]
    async fn test_respond_permission_with_channel() {
        let (engine, _rx) = test_engine().await;

        let (tx, mut perm_rx) = mpsc::channel::<PermissionResponse>(16);
        engine.permission_txs.insert(AgentSlot::QueueItem(42), tx);

        let response = PermissionResponse {
            decision: PermissionDecision::AllowOnce,
            feedback: None,
            updated_input: None,
        };
        let result = engine.respond_permission(AgentSlot::QueueItem(42), response).await;
        assert!(result.is_ok());

        // Verify the response was received
        let received = perm_rx.recv().await.unwrap();
        assert!(matches!(received.decision, PermissionDecision::AllowOnce));
    }

    // ── 6. Capacity check (advance logic) ──

    #[tokio::test]
    async fn test_advance_at_capacity_is_noop() {
        let (engine, _rx) = test_engine().await;
        // max_parallel is 2, fill active_items to capacity
        engine.active_items.insert(AgentSlot::QueueItem(1), 100);
        engine.active_items.insert(AgentSlot::QueueItem(2), 200);

        // advance should return Ok but not start new items (no DB so nothing to query)
        // Since there's no workflow_queue table, it would error on unblock_ready_items,
        // but at-capacity check happens first
        let result = engine.advance().await;
        assert!(result.is_ok());
    }

    // ── 7. to_value helper ──

    #[test]
    fn test_to_value_string() {
        let v = to_value("hello");
        assert_eq!(v, serde_json::Value::String("hello".to_string()));
    }

    #[test]
    fn test_to_value_struct() {
        let v = to_value(serde_json::json!({"key": 42}));
        assert_eq!(v["key"], 42);
    }

    // ── 8. WorkflowType round-trip ──

    #[test]
    fn test_workflow_type_as_str() {
        assert_eq!(WorkflowType::FeatureBuild.as_str(), "feature_build");
    }

    #[test]
    fn test_workflow_type_from_str() {
        assert_eq!(
            WorkflowType::from_str("feature_build").unwrap(),
            WorkflowType::FeatureBuild
        );
        assert!(WorkflowType::from_str("unknown").is_err());
    }

    // ── 9. Cancel signal ──

    #[tokio::test]
    async fn test_cancel_signal() {
        let (engine, _rx) = test_engine().await;
        let mut cancel_rx = engine.cancel_rx.clone();

        assert!(!*cancel_rx.borrow());
        engine.cancel();
        // After cancel, the receiver should see true
        cancel_rx.changed().await.unwrap();
        assert!(*cancel_rx.borrow());
    }

    // ── 10. Drop triggers cancel ──

    #[tokio::test]
    async fn test_drop_triggers_cancel() {
        let pool = test_pool().await;
        let (tx, _rx) = mpsc::unbounded_channel();
        let engine = WorkflowEngine::new(1, WorkflowType::FeatureBuild, pool.clone(), pool, tx, 1);
        let mut cancel_rx = engine.cancel_rx.clone();

        drop(engine);
        cancel_rx.changed().await.unwrap();
        assert!(*cancel_rx.borrow());
    }

    // ── 11. Agent type mapping via strategy ──

    #[tokio::test]
    async fn test_strategy_agent_type_mapping() {
        let (engine, _rx) = test_engine().await;

        assert!(matches!(engine.strategy.agent_type_for_item("execute"), Ok(AgentType::Execute)));
        assert!(matches!(engine.strategy.agent_type_for_item("qa"), Ok(AgentType::Qa)));
        assert!(matches!(engine.strategy.agent_type_for_item("review"), Ok(AgentType::Review)));
        assert!(engine.strategy.agent_type_for_item("bogus").is_err());
    }

    // ── 12. Autonomy level atomic updates ──

    #[tokio::test]
    async fn test_autonomy_level_update() {
        let (engine, _rx) = test_engine().await;

        assert_eq!(engine.autonomy_level.load(Ordering::Relaxed), 3);
        engine.autonomy_level.store(1, Ordering::Relaxed);
        assert_eq!(engine.autonomy_level.load(Ordering::Relaxed), 1);
        engine.autonomy_level.store(2, Ordering::Relaxed);
        assert_eq!(engine.autonomy_level.load(Ordering::Relaxed), 2);
    }

    // ── 13. QueueItem construction helper for testing ──

    fn make_queue_item(id: i64, item_type: &str, status: &str, order: i64, group: Option<i64>) -> QueueItem {
        QueueItem {
            id,
            feature_id: 1,
            workflow_type: "feature_build".to_string(),
            item_type: item_type.to_string(),
            phase_id: Some(id * 10),
            status: status.to_string(),
            order_index: order,
            group_index: group,
            config: None,
            agent_session_id: None,
            result: None,
            created_at: None,
            started_at: None,
            ended_at: None,
            pid: None,
        }
    }

    #[test]
    fn test_queue_item_ordering() {
        let items = vec![
            make_queue_item(3, "execute", "ready", 2, Some(1)),
            make_queue_item(1, "execute", "ready", 0, Some(0)),
            make_queue_item(2, "execute", "blocked", 1, Some(0)),
            make_queue_item(4, "review", "blocked", 3, Some(2)),
        ];

        // Items should be sortable by order_index for queue priority
        let mut sorted = items.clone();
        sorted.sort_by_key(|i| i.order_index);
        assert_eq!(sorted[0].id, 1);
        assert_eq!(sorted[1].id, 2);
        assert_eq!(sorted[2].id, 3);
        assert_eq!(sorted[3].id, 4);
    }

    #[test]
    fn test_queue_item_group_index_parallel_identification() {
        let items = vec![
            make_queue_item(1, "execute", "ready", 0, Some(0)),
            make_queue_item(2, "execute", "ready", 1, Some(0)),
            make_queue_item(3, "execute", "blocked", 2, Some(1)),
        ];

        // Items in the same group can run in parallel
        let group_0: Vec<_> = items.iter().filter(|i| i.group_index == Some(0)).collect();
        assert_eq!(group_0.len(), 2);

        let group_1: Vec<_> = items.iter().filter(|i| i.group_index == Some(1)).collect();
        assert_eq!(group_1.len(), 1);
    }

    #[test]
    fn test_queue_item_status_transitions() {
        // Verify valid status strings used throughout the engine
        let valid_statuses = ["ready", "blocked", "running", "completed", "error", "skipped", "paused"];
        for status in &valid_statuses {
            let item = make_queue_item(1, "execute", status, 0, Some(0));
            assert_eq!(item.status, *status);
        }
    }

    // ── 14. Topological sort integration (re-exported from populate) ──

    #[test]
    fn test_topological_sort_with_workflow_phases() {
        use crate::domain::workflow::populate::topological_sort;

        // Simulate: setup(1) -> core(2) -> tests(3), setup(1) -> tests(3)
        let nodes = vec![1, 2, 3];
        let edges = vec![(1, 2), (1, 3), (2, 3)];
        let result = topological_sort(&nodes, &edges).unwrap();

        let groups: std::collections::HashMap<i64, usize> = result.iter().copied().collect();
        assert_eq!(groups[&1], 0); // setup at depth 0
        assert_eq!(groups[&2], 1); // core at depth 1
        assert_eq!(groups[&3], 2); // tests at depth 2

        // Verify topological ordering
        let pos: std::collections::HashMap<i64, usize> = result
            .iter()
            .enumerate()
            .map(|(i, &(id, _))| (id, i))
            .collect();
        assert!(pos[&1] < pos[&2]);
        assert!(pos[&1] < pos[&3]);
        assert!(pos[&2] < pos[&3]);
    }

    #[test]
    fn test_topological_sort_cycle_detection() {
        use crate::domain::workflow::populate::topological_sort;

        let nodes = vec![1, 2];
        let edges = vec![(1, 2), (2, 1)];
        assert!(topological_sort(&nodes, &edges).is_err());
    }

    #[test]
    fn test_topological_sort_independent_phases() {
        use crate::domain::workflow::populate::topological_sort;

        // All phases independent — all should be group 0
        let nodes = vec![10, 20, 30];
        let edges = vec![];
        let result = topological_sort(&nodes, &edges).unwrap();
        for &(_, group) in &result {
            assert_eq!(group, 0);
        }
    }

    // ── AgentSlot tests ──

    #[test]
    fn test_agent_slot_agent_type_str() {
        assert_eq!(AgentSlot::Plan.agent_type_str(), Some("plan"));
        assert_eq!(AgentSlot::Prd.agent_type_str(), Some("prd"));
        assert_eq!(AgentSlot::Session.agent_type_str(), Some("session"));
        assert_eq!(AgentSlot::Refine.agent_type_str(), Some("refine"));
        assert_eq!(AgentSlot::ReviewFixer.agent_type_str(), Some("review-fixer"));
        assert_eq!(AgentSlot::QueueItem(42).agent_type_str(), None);
    }

    #[test]
    fn test_agent_type_str_to_slot_mapping() {
        assert_eq!(agent_type_str_to_slot("plan"), Some(AgentSlot::Plan));
        assert_eq!(agent_type_str_to_slot("prd"), Some(AgentSlot::Prd));
        assert_eq!(agent_type_str_to_slot("session"), Some(AgentSlot::Session));
        assert_eq!(agent_type_str_to_slot("refine"), Some(AgentSlot::Refine));
        assert_eq!(agent_type_str_to_slot("review-fixer"), Some(AgentSlot::ReviewFixer));
        assert_eq!(agent_type_str_to_slot("review_fixer"), Some(AgentSlot::ReviewFixer));
        assert_eq!(agent_type_str_to_slot("execute"), None);
        assert_eq!(agent_type_str_to_slot(""), None);
    }

    #[test]
    fn test_agent_slot_roundtrip_via_legacy_id() {
        for slot in &[AgentSlot::Plan, AgentSlot::Prd, AgentSlot::Session, AgentSlot::Refine, AgentSlot::ReviewFixer] {
            let id = slot.as_legacy_id();
            let back = AgentSlot::from(id);
            assert_eq!(&back, slot);
        }
        // QueueItem roundtrips too
        assert_eq!(AgentSlot::from(42), AgentSlot::QueueItem(42));
    }

    #[test]
    fn test_agent_slot_sdk_agent_type() {
        assert!(matches!(AgentSlot::Plan.sdk_agent_type(), Some(AgentType::Plan)));
        assert!(matches!(AgentSlot::Refine.sdk_agent_type(), Some(AgentType::Plan)));
        assert!(matches!(AgentSlot::Prd.sdk_agent_type(), Some(AgentType::Prd)));
        assert!(matches!(AgentSlot::Session.sdk_agent_type(), Some(AgentType::Session)));
        assert!(matches!(AgentSlot::ReviewFixer.sdk_agent_type(), Some(AgentType::Execute)));
        assert!(AgentSlot::QueueItem(42).sdk_agent_type().is_none());
    }

    #[test]
    fn test_agent_slot_system_prompt() {
        assert!(AgentSlot::Plan.system_prompt().is_some());
        assert!(AgentSlot::Prd.system_prompt().is_some());
        assert!(AgentSlot::Session.system_prompt().is_some());
        assert!(AgentSlot::Refine.system_prompt().is_some());
        assert!(AgentSlot::ReviewFixer.system_prompt().is_none());
        assert!(AgentSlot::QueueItem(42).system_prompt().is_none());
    }

    #[test]
    fn test_agent_slot_is_queue_item() {
        assert!(!AgentSlot::Plan.is_queue_item());
        assert!(AgentSlot::QueueItem(1).is_queue_item());
    }

    #[test]
    fn test_agent_slot_display() {
        assert_eq!(format!("{}", AgentSlot::Plan), "plan");
        assert_eq!(format!("{}", AgentSlot::QueueItem(42)), "queue_item(42)");
    }

    // ── restore_on_reconnect ──

    /// Helper: create an engine with real schema for DB-backed tests.
    async fn test_engine_with_schema() -> (WorkflowEngine, mpsc::UnboundedReceiver<Message>) {
        let pool = test_pool().await;
        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT,
                status TEXT DEFAULT 'draft', type TEXT DEFAULT 'feature'
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL DEFAULT 'session',
                status TEXT NOT NULL DEFAULT 'idle',
                claude_session_id TEXT,
                model TEXT, permission_mode TEXT,
                has_file_changes INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                context_window INTEGER NOT NULL DEFAULT 200000,
                started_at TEXT, ended_at TEXT
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE workflow_queue (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER NOT NULL,
                workflow_type TEXT NOT NULL DEFAULT 'feature_build',
                item_type TEXT NOT NULL,
                phase_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                order_index INTEGER NOT NULL,
                group_index INTEGER,
                config JSON,
                agent_session_id INTEGER,
                result JSON,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME, ended_at DATETIME, pid INTEGER
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE workflow_dependencies (
                item_id INTEGER NOT NULL,
                depends_on_id INTEGER NOT NULL,
                PRIMARY KEY (item_id, depends_on_id)
            )"#,
        ).execute(&pool).await.unwrap();

        let (tx, rx) = mpsc::unbounded_channel();
        let engine = WorkflowEngine::new(
            1,
            WorkflowType::FeatureBuild,
            pool.clone(),
            pool,
            tx,
            2,
        );
        (engine, rx)
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_populates_paused_sessions() {
        let (engine, mut rx) = test_engine_with_schema().await;

        // Insert a paused plan session with a claude_session_id
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'plan', 'paused', 'cc-resume-123')"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        // paused_sessions should have the plan agent's session ID
        assert!(engine.paused_sessions.contains_key(&AgentSlot::Plan));
        assert_eq!(*engine.paused_sessions.get(&AgentSlot::Plan).unwrap(), "cc-resume-123");

        // active_items should map AgentSlot::Plan to the db session id
        assert!(engine.active_items.contains_key(&AgentSlot::Plan));

        // Should have sent queue_update + agent_paused messages
        let mut got_queue_update = false;
        let mut got_agent_paused = false;
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("queue_update") { got_queue_update = true; }
                if text_str.contains("agent_paused") && text_str.contains("cc-resume-123") {
                    got_agent_paused = true;
                }
            }
        }
        assert!(got_queue_update, "should have sent queue_update");
        assert!(got_agent_paused, "should have sent agent_paused with claude_session_id");
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_ignores_sessions_without_claude_session_id() {
        let (engine, _rx) = test_engine_with_schema().await;

        // Insert a running session WITHOUT claude_session_id
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'plan', 'running')"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        // paused_sessions should be empty — no claude_session_id to resume with
        assert!(engine.paused_sessions.is_empty());
        assert!(engine.active_items.is_empty());
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_marks_stale_queue_items_as_error() {
        let (engine, _rx) = test_engine_with_schema().await;

        // Insert a running queue item
        sqlx::query(
            "INSERT INTO workflow_queue (feature_id, item_type, status, order_index) VALUES (1, 'execute', 'running', 0)"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        // Queue item should now be 'error'
        let row: (String,) = sqlx::query_as(
            "SELECT status FROM workflow_queue WHERE feature_id = 1"
        ).fetch_one(&engine.read_pool).await.unwrap();
        assert_eq!(row.0, "error");
    }

    #[tokio::test]
    async fn test_restore_on_reconnect_ignores_other_features() {
        let (engine, _rx) = test_engine_with_schema().await;

        // Insert a paused session for a DIFFERENT feature
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (999, 'plan', 'paused', 'other-feature')"
        ).execute(&engine.write_pool).await.unwrap();

        engine.restore_on_reconnect().await.unwrap();

        // Should not restore sessions from other features
        assert!(engine.paused_sessions.is_empty());
    }

    #[tokio::test]
    async fn test_send_prompt_returns_error_for_unknown_positive_item() {
        let (engine, _rx) = test_engine().await;

        // Positive queue_item_id with no query handle or paused session
        let result = engine.send_prompt(AgentSlot::QueueItem(999), "hello", None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No query handle"));
    }

    #[tokio::test]
    async fn test_send_prompt_uses_paused_session_for_resume() {
        let (engine, _rx) = test_engine_with_schema().await;

        // Create a session and populate paused_sessions + active_items
        let db_id: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'plan', 'paused', 'cc-resume-456') RETURNING id"
        ).fetch_one(&engine.write_pool).await.unwrap();

        engine.paused_sessions.insert(AgentSlot::Plan, "cc-resume-456".to_string());
        engine.active_items.insert(AgentSlot::Plan, db_id);

        // send_prompt will try to resume via the SDK — we can't test the full
        // SDK flow here, but we can verify the paused_session was consumed
        let _ = engine.send_prompt(AgentSlot::Plan, "continue", None).await;

        // The paused session should have been removed (consumed by resume attempt)
        assert!(!engine.paused_sessions.contains_key(&AgentSlot::Plan));
    }

    // ── on_item_completed sends feature.updated for pre-queue agents ──

    #[tokio::test]
    async fn test_on_item_completed_plan_sends_feature_updated() {
        let (engine, mut rx) = test_engine_with_schema().await;

        // Insert a feature row so mark_item_completed doesn't fail
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
            .execute(&engine.write_pool).await.unwrap();

        engine.on_item_completed(AgentSlot::Plan, Some("done")).await;

        let mut got_item_completed = false;
        let mut got_feature_updated = false;
        let mut updated_fields: Vec<String> = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("item_completed") {
                    got_item_completed = true;
                }
                if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                    got_feature_updated = true;
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text_str) {
                        if let Some(changed) = v["payload"]["changed"].as_array() {
                            updated_fields = changed.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                        }
                    }
                }
            }
        }
        assert!(got_item_completed, "should send item_completed");
        assert!(got_feature_updated, "should send feature.updated for plan agent");
        assert!(updated_fields.contains(&"plan".to_string()));
        assert!(updated_fields.contains(&"phases".to_string()));
        assert!(updated_fields.contains(&"progress".to_string()));
    }

    #[tokio::test]
    async fn test_on_item_completed_prd_sends_feature_updated() {
        let (engine, mut rx) = test_engine_with_schema().await;

        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
            .execute(&engine.write_pool).await.unwrap();

        engine.on_item_completed(AgentSlot::Prd, None).await;

        let mut got_feature_updated = false;
        let mut updated_fields: Vec<String> = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                    got_feature_updated = true;
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text_str) {
                        if let Some(changed) = v["payload"]["changed"].as_array() {
                            updated_fields = changed.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                        }
                    }
                }
            }
        }
        assert!(got_feature_updated, "should send feature.updated for prd agent");
        assert_eq!(updated_fields, vec!["prd"]);
    }

    #[tokio::test]
    async fn test_on_item_completed_regular_item_no_feature_updated() {
        let (engine, mut rx) = test_engine_with_schema().await;

        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
            .execute(&engine.write_pool).await.unwrap();

        // Regular queue item should NOT trigger feature.updated
        engine.on_item_completed(AgentSlot::QueueItem(42), Some("done")).await;

        let mut got_feature_updated = false;
        while let Ok(msg) = rx.try_recv() {
            if let Message::Text(text) = msg {
                let text_str: &str = &text;
                if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                    got_feature_updated = true;
                }
            }
        }
        assert!(!got_feature_updated, "regular items should NOT send feature.updated");
    }

    // ── send_feature_updated_envelope helper ──

    #[test]
    fn test_send_feature_updated_envelope_format() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        send_feature_updated_envelope(&tx, 123, &["plan", "phases"]);

        let msg = rx.try_recv().unwrap();
        if let Message::Text(text) = msg {
            let v: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(v["domain"], "feature");
            assert_eq!(v["action"], "updated");
            assert_eq!(v["payload"]["feature_id"], 123);
            let changed: Vec<String> = v["payload"]["changed"].as_array().unwrap()
                .iter().filter_map(|v| v.as_str().map(String::from)).collect();
            assert_eq!(changed, vec!["plan", "phases"]);
        } else {
            panic!("expected Text message");
        }
    }
}
