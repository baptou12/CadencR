//! Permission channel management for workflow agents.
//!
//! Routes permission requests/responses between the frontend and running agents,
//! and implements the `CanUseTool` bridge for approval gates (plan/PRD).

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use dashmap::DashMap;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use axum::extract::ws::Message;

use crate::domain::agents::adapter::{
    RuntimeToolPermissionHandler, RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};
use crate::domain::features::repository as repo;
use crate::domain::permission_bridge::{self, ResolvedAction};
use crate::domain::workflow::engine::{AgentSlot, WsSender};
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::persistence::{
    PendingUserInput, PendingUserInputKind, WsSessionPersistence,
};
use crate::domain::ws_session::protocol::*;

use super::engine::{send_feature_updated_envelope, to_value};

/// Manages permission channels for all active workflow agents.
#[derive(Clone)]
pub struct PermissionRouter {
    pub permission_txs: Arc<DashMap<AgentSlot, mpsc::Sender<PermissionResponse>>>,
}

impl PermissionRouter {
    pub fn new() -> Self {
        Self {
            permission_txs: Arc::new(DashMap::new()),
        }
    }

    /// Register a permission channel for an agent slot.
    pub fn register(&self, slot: AgentSlot, tx: mpsc::Sender<PermissionResponse>) {
        self.permission_txs.insert(slot, tx);
    }

    /// Route a permission response to the correct agent's permission channel.
    pub async fn respond(
        &self,
        slot: AgentSlot,
        response: PermissionResponse,
    ) -> Result<(), String> {
        if let Some(tx) = self.permission_txs.get(&slot) {
            return tx
                .send(response)
                .await
                .map_err(|_| format!("Permission channel closed for slot {slot}"));
        }
        Err(format!(
            "No permission channel for slot {slot} — agent may need restart"
        ))
    }

    /// Remove the permission channel for an agent slot.
    pub fn cleanup(&self, slot: &AgentSlot) {
        self.permission_txs.remove(slot);
    }
}

/// CanUseTool implementation for workflow agents that bridges permission requests
/// to the frontend via workflow.permission.request envelopes.
pub struct WorkflowPermissionBridge {
    pub slot: AgentSlot,
    pub feature_id: i64,
    pub sender: WsSender,
    pub response_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<PermissionResponse>>>,
    pub worktree_path: PathBuf,
    pub session_cache: Arc<tokio::sync::Mutex<HashSet<String>>>,
    pub allowed_patterns: Arc<HashSet<String>>,
    pub write_pool: SqlitePool,
    pub db_session_id: i64,
    pub session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
}

#[async_trait]
impl RuntimeToolPermissionHandler for WorkflowPermissionBridge {
    async fn can_use_tool(
        &self,
        request: RuntimeToolPermissionRequest,
    ) -> RuntimeToolPermissionResult {
        debug!(
            tool_name = %request.tool_name,
            slot = %self.slot,
            "WorkflowPermissionBridge::can_use_tool called"
        );

        if let Some(kind) = ApprovalKind::from_tool_name(&request.tool_name) {
            return self.handle_approval_gate(&request, kind).await;
        }

        // Standard permission resolution via shared bridge
        let action = permission_bridge::resolve_permission_check(
            &request,
            &self.worktree_path,
            &self.session_cache,
            &self.allowed_patterns,
        )
        .await;

        match action {
            ResolvedAction::Resolved(result) => result,
            ResolvedAction::NeedsPrompt {
                description,
                pattern,
                force_prompt,
            } => {
                self.handle_needs_prompt(&request, description, pattern, force_prompt)
                    .await
            }
        }
    }
}

/// Approval gate that `show_plan` / `show_prd` trigger before the tool runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalKind {
    Plan,
    Prd,
}

impl ApprovalKind {
    /// Match on canonical MCP tool names (`mcp__cadencr-plan__show_plan`, etc.).
    /// Substring match covers both Claude Code's canonical form and OpenCode's
    /// sanitized form (`cadencr-plan_show_plan`).
    pub fn from_tool_name(name: &str) -> Option<Self> {
        if name.contains("show_plan") {
            Some(Self::Plan)
        } else if name.contains("show_prd") {
            Some(Self::Prd)
        } else {
            None
        }
    }
}

impl WorkflowPermissionBridge {
    /// Handle approval-gate tools (show_plan, show_prd): emit WS events
    /// and block on the permission channel until the user approves/rejects.
    async fn handle_approval_gate(
        &self,
        request: &RuntimeToolPermissionRequest,
        kind: ApprovalKind,
    ) -> RuntimeToolPermissionResult {
        emit_plan_approval_gate_events(
            self.feature_id,
            &self.slot,
            self.db_session_id,
            &request.tool_use_id,
            Some(&request.tool_use_id),
            &request.input,
            kind,
            &self.sender,
            &self.write_pool,
        )
        .await;

        let result = permission_bridge::wait_for_approval(
            &self.response_rx,
            &request.tool_use_id,
            request.input.clone(),
            "Plan/PRD rejected by user",
        )
        .await;

        // Clear the column that `emit_plan_approval_gate_events` wrote —
        // Prd gates live in `pending_prd_approval`, not `pending_plan_approval`.
        let clear_kind = match kind {
            ApprovalKind::Plan => PendingUserInputKind::PlanApproval,
            ApprovalKind::Prd => PendingUserInputKind::PrdApproval,
        };
        WsSessionPersistence::clear_pending_user_input_static(
            &self.write_pool,
            self.db_session_id,
            clear_kind,
        )
        .await;

        result
    }

    /// Handle a NeedsPrompt result: persist the gate (write + broadcast
    /// askUser), send the workflow envelope, and delegate to
    /// `wait_and_apply_decision` which owns clear + terminal broadcast.
    async fn handle_needs_prompt(
        &self,
        request: &RuntimeToolPermissionRequest,
        description: String,
        pattern: String,
        force_prompt: bool,
    ) -> RuntimeToolPermissionResult {
        debug!(tool_name = %request.tool_name, pattern = %pattern, "workflow prompting user");
        let is_ask_user_question = request.tool_name == "AskUserQuestion";
        let clear_kind = if is_ask_user_question {
            PendingUserInputKind::Question
        } else {
            PendingUserInputKind::Permission
        };

        // Persist pending-input gate + broadcast "askUser". For
        // AskUserQuestion the DB payload mirrors the legacy
        // `{tool_name, tool_input, request_id, pattern}` shape so workflow
        // restore code (engine/reconnect) can keep reading it.
        if is_ask_user_question {
            let pq_json = serde_json::json!({
                "tool_name": &request.tool_name,
                "tool_input": &request.input,
                "request_id": &request.tool_use_id,
                "pattern": &pattern,
            });
            WsSessionPersistence::mark_awaiting_user_static(
                &self.write_pool,
                &self.session_status_tx,
                self.db_session_id,
                self.feature_id,
                &PendingUserInput::Question(&pq_json),
            )
            .await;
        } else {
            // For regular permissions we persist the envelope-shaped payload
            // directly (same as the ws-session Claude Code path).
            let perm_payload = PermissionRequestPayload {
                request_id: request.tool_use_id.clone(),
                tool_name: request.tool_name.clone(),
                tool_input: request.input.clone(),
                description: Some(description.clone()),
                pattern: Some(pattern.clone()),
                preview: permission_bridge::extract_permission_preview(&request.input),
                options: permission_bridge::build_default_permission_options(Some(&pattern)),
            };
            WsSessionPersistence::mark_awaiting_user_static(
                &self.write_pool,
                &self.session_status_tx,
                self.db_session_id,
                self.feature_id,
                &PendingUserInput::Permission(&perm_payload),
            )
            .await;
        }

        // Send workflow-specific permission request envelope
        let payload = WorkflowPermissionRequestPayload {
            feature_id: self.feature_id,
            agent_slot: self.slot.clone(),
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input: request.input.clone(),
            description: Some(description),
            pattern: Some(pattern.clone()),
            preview: permission_bridge::extract_permission_preview(&request.input),
            options: permission_bridge::build_default_permission_options(Some(&pattern)),
        };
        let envelope = WsEnvelope::new(
            "workflow",
            "permission.request",
            serde_json::to_value(&payload).unwrap(),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));

        // Delegates clear + terminal-turn broadcast back to the helper.
        permission_bridge::wait_and_apply_decision(
            &self.response_rx,
            &request.tool_use_id,
            request.input.clone(),
            &pattern,
            force_prompt,
            &self.worktree_path,
            &self.session_cache,
            &self.session_status_tx,
            self.feature_id,
            &self.write_pool,
            self.db_session_id,
            clear_kind,
        )
        .await
    }
}

/// Emit the approval-gate WS events for `show_plan` / `show_prd` and persist
/// `pending_plan_approval` for restart survival. Shared by the Claude Code
/// `can_use_tool` bridge and the OpenCode stream-reader intercept.
///
/// Does **not** block — callers are responsible for waiting on the user's
/// decision (Claude Code via `wait_for_approval`, OpenCode via OpenCode's own
/// permission-reply RPC triggered by the frontend).
pub async fn emit_plan_approval_gate_events(
    feature_id: i64,
    slot: &AgentSlot,
    db_session_id: i64,
    tool_use_id: &str,
    request_id: Option<&str>,
    tool_input: &serde_json::Value,
    kind: ApprovalKind,
    sender: &WsSender,
    pool: &SqlitePool,
) -> Option<String> {
    let event_name = match kind {
        ApprovalKind::Plan => "plan_ready",
        ApprovalKind::Prd => "prd_ready",
    };
    info!(
        feature_id,
        ?kind,
        "approval gate detected, emitting {event_name}"
    );

    let gate_env = WsEnvelope::new(
        "workflow",
        event_name,
        serde_json::json!({
            "feature_id": feature_id,
            "agent_slot": slot,
        }),
    );
    let _ = sender.send(Message::Text(String::from(gate_env).into()));

    let content = match kind {
        ApprovalKind::Plan => {
            emit_plan_approval_status(sender, pool, feature_id).await;
            emit_plan_content(sender, pool, feature_id, slot, db_session_id).await
        }
        ApprovalKind::Prd => emit_prd_content(sender, pool, feature_id, slot, db_session_id).await,
    };

    if let Some(ref plan_md) = content {
        persist_pending_approval(pool, db_session_id, kind, tool_input, plan_md, request_id).await;
        attach_plan_to_tool_call(pool, db_session_id, tool_use_id, plan_md).await;
    }

    let changed: &[&str] = match kind {
        ApprovalKind::Plan => &["plan", "phases", "progress"],
        ApprovalKind::Prd => &["prd"],
    };
    send_feature_updated_envelope(sender, feature_id, changed);

    content
}

async fn persist_pending_approval(
    pool: &SqlitePool,
    db_session_id: i64,
    kind: ApprovalKind,
    tool_input: &serde_json::Value,
    plan_md: &str,
    request_id: Option<&str>,
) {
    let mut enriched = tool_input.clone();
    enriched["plan"] = serde_json::Value::String(plan_md.to_string());
    if let Some(request_id) = request_id {
        enriched["request_id"] = serde_json::Value::String(request_id.to_string());
    }
    let input = match kind {
        ApprovalKind::Plan => PendingUserInput::PlanApproval(&enriched),
        ApprovalKind::Prd => PendingUserInput::PrdApproval(&enriched),
    };
    WsSessionPersistence::set_pending_user_input_static(pool, db_session_id, &input).await;
}

async fn emit_plan_approval_status(sender: &WsSender, write_pool: &SqlitePool, feature_id: i64) {
    let _ = repo::set_workflow_status(write_pool, feature_id, WorkflowStatus::PlanApproval).await;
    let status_env = WsEnvelope::new(
        "workflow",
        "status_changed",
        to_value(WorkflowStatusChangedPayload {
            feature_id,
            status: "plan_approval".to_string(),
            previous_status: "planning".to_string(),
        }),
    );
    let _ = sender.send(Message::Text(String::from(status_env).into()));
}

async fn emit_plan_content(
    sender: &WsSender,
    read_pool: &SqlitePool,
    feature_id: i64,
    slot: &AgentSlot,
    db_session_id: i64,
) -> Option<String> {
    let content = fetch_plan_content(read_pool, feature_id).await?;
    info!(
        feature_id,
        content_len = content.len(),
        "emitting plan_content"
    );
    let env = WsEnvelope::new(
        "workflow",
        "plan_content",
        serde_json::json!({
            "agent_slot": slot,
            "session_id": db_session_id,
            "content": content,
        }),
    );
    let _ = sender.send(Message::Text(String::from(env).into()));
    Some(content)
}

async fn emit_prd_content(
    sender: &WsSender,
    read_pool: &SqlitePool,
    feature_id: i64,
    slot: &AgentSlot,
    db_session_id: i64,
) -> Option<String> {
    match sqlx::query_scalar::<_, String>(
        "SELECT prd FROM features WHERE id = ? AND prd IS NOT NULL",
    )
    .bind(feature_id)
    .fetch_optional(read_pool)
    .await
    {
        Ok(Some(prd_content)) => {
            info!(
                feature_id,
                content_len = prd_content.len(),
                "emitting prd_content"
            );
            let env = WsEnvelope::new(
                "workflow",
                "prd_content",
                serde_json::json!({
                    "agent_slot": slot,
                    "session_id": db_session_id,
                    "content": prd_content,
                }),
            );
            let _ = sender.send(Message::Text(String::from(env).into()));
            Some(prd_content)
        }
        Ok(None) => {
            warn!(feature_id, "no PRD found when emitting prd_content");
            None
        }
        Err(e) => {
            warn!(feature_id, error = %e, "failed to query PRD");
            None
        }
    }
}

async fn fetch_plan_content(read_pool: &SqlitePool, feature_id: i64) -> Option<String> {
    #[derive(sqlx::FromRow)]
    struct PlanRow {
        id: i64,
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
        "SELECT id, title, summary, completion_conditions \
         FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(feature_id)
    .fetch_optional(read_pool)
    .await
    .ok()??;

    let phases: Vec<PhaseRow> = sqlx::query_as(
        "SELECT step_number, title, phase_type, complexity, prompt, commit_message, depends_on \
         FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
    )
    .bind(plan.id)
    .fetch_all(read_pool)
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
            let pt = p.phase_type.as_deref().unwrap_or("value");
            let cx = p
                .complexity
                .map(|c| c.to_string())
                .unwrap_or_else(|| "-".to_string());
            out.push_str(&format!(
                "\n### Phase {} — {} `[{}]` (complexity: {})\n",
                p.step_number, p.title, pt, cx,
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

async fn attach_plan_to_tool_call(
    write_pool: &SqlitePool,
    db_session_id: i64,
    tool_use_id: &str,
    plan_md: &str,
) {
    let enriched_str = serde_json::json!({ "plan": plan_md }).to_string();
    crate::domain::features::repository::retry_update_agent_message_content(
        write_pool,
        db_session_id,
        tool_use_id,
        &enriched_str,
        &crate::domain::features::repository::ToolCallFilter::MessageType("tool_call".to_string()),
    )
    .await;
}
