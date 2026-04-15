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
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub db_session_id: i64,
    pub turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
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

        // Intercept approval-gate tools (show_plan, show_prd)
        let is_show_plan = request.tool_name.contains("show_plan");
        let is_show_prd = !is_show_plan && request.tool_name.contains("show_prd");
        if is_show_plan || is_show_prd {
            return self.handle_approval_gate(&request, is_show_plan).await;
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

impl WorkflowPermissionBridge {
    /// Handle approval-gate tools (show_plan, show_prd): emit WS events
    /// and block on the permission channel until the user approves/rejects.
    async fn handle_approval_gate(
        &self,
        request: &RuntimeToolPermissionRequest,
        is_show_plan: bool,
    ) -> RuntimeToolPermissionResult {
        let event_name = if is_show_plan {
            "plan_ready"
        } else {
            "prd_ready"
        };
        info!(
            feature_id = self.feature_id,
            tool_name = %request.tool_name,
            "approval gate detected, emitting {} and blocking", event_name
        );

        let gate_env = WsEnvelope::new(
            "workflow",
            event_name,
            serde_json::json!({
                "feature_id": self.feature_id,
                "agent_slot": self.slot,
            }),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(gate_env).into()));

        let content = if is_show_plan {
            self.emit_plan_approval_status().await;
            self.emit_plan_content().await
        } else {
            self.emit_prd_content().await
        };

        // Persist plan/PRD content to pending_plan_approval so it survives app restart
        if let Some(ref plan_md) = content {
            let mut enriched = request.input.clone();
            enriched["plan"] = serde_json::Value::String(plan_md.clone());
            let json = serde_json::to_string(&enriched).unwrap_or_else(|_| "{}".to_string());
            if let Err(e) =
                sqlx::query("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
                    .bind(&json)
                    .bind(self.db_session_id)
                    .execute(&self.write_pool)
                    .await
            {
                warn!(session_id = self.db_session_id, error = %e, "failed to persist pending_plan_approval");
            }
        }

        self.attach_plan_to_tool_call(request, content).await;

        let changed: &[&str] = if is_show_plan {
            &["plan", "phases", "progress"]
        } else {
            &["prd"]
        };
        send_feature_updated_envelope(&self.sender, self.feature_id, changed);

        let result = permission_bridge::wait_for_approval(
            &self.response_rx,
            &request.tool_use_id,
            request.input.clone(),
            "Plan/PRD rejected by user",
        )
        .await;

        if let Err(e) =
            sqlx::query("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?")
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await
        {
            warn!(session_id = self.db_session_id, error = %e, "failed to clear pending_plan_approval");
        }

        result
    }

    /// Handle a NeedsPrompt result: send workflow-specific envelope, persist
    /// AskUserQuestion data, and wait for user decision.
    async fn handle_needs_prompt(
        &self,
        request: &RuntimeToolPermissionRequest,
        description: String,
        pattern: String,
        force_prompt: bool,
    ) -> RuntimeToolPermissionResult {
        debug!(tool_name = %request.tool_name, pattern = %pattern, "workflow prompting user");
        let is_ask_user_question = request.tool_name == "AskUserQuestion";

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

        // Persist pending question data so it survives navigation/refresh
        if is_ask_user_question {
            let pq_json = serde_json::json!({
                "tool_name": &request.tool_name,
                "tool_input": &request.input,
                "request_id": &request.tool_use_id,
                "pattern": &pattern,
            });
            let _ = sqlx::query("UPDATE agent_sessions SET pending_questions = ? WHERE id = ?")
                .bind(pq_json.to_string())
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
        } else {
            let _ = sqlx::query("UPDATE agent_sessions SET pending_permission = ? WHERE id = ?")
                .bind(serde_json::to_string(&payload).unwrap_or_default())
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
        }

        // Wait for user decision (shared logic handles turn state + decision)
        let result = permission_bridge::wait_and_apply_decision(
            &self.response_rx,
            &request.tool_use_id,
            request.input.clone(),
            &pattern,
            force_prompt,
            &self.worktree_path,
            &self.session_cache,
            &self.turn_state_tx,
            self.feature_id,
        )
        .await;

        // Clear persisted pending questions after user responds
        if is_ask_user_question {
            let _ = sqlx::query("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?")
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
        } else {
            let _ = sqlx::query("UPDATE agent_sessions SET pending_permission = NULL WHERE id = ?")
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
        }

        result
    }

    async fn emit_plan_approval_status(&self) {
        let _ = repo::set_workflow_status(
            &self.write_pool,
            self.feature_id,
            WorkflowStatus::PlanApproval,
        )
        .await;
        let status_env = WsEnvelope::new(
            "workflow",
            "status_changed",
            to_value(WorkflowStatusChangedPayload {
                feature_id: self.feature_id,
                status: "plan_approval".to_string(),
                previous_status: "planning".to_string(),
            }),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(status_env).into()));
    }

    async fn emit_plan_content(&self) -> Option<String> {
        let plan_id = match sqlx::query_scalar::<_, i64>(
            "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        {
            Ok(Some(id)) => id,
            Ok(None) => {
                warn!(
                    feature_id = self.feature_id,
                    "no plan found when emitting plan_content"
                );
                return None;
            }
            Err(e) => {
                warn!(feature_id = self.feature_id, error = %e, "failed to query plan");
                return None;
            }
        };

        match self.fetch_plan_content(plan_id).await {
            Some(content) => {
                info!(
                    feature_id = self.feature_id,
                    plan_id,
                    content_len = content.len(),
                    "emitting plan_content"
                );
                let env = WsEnvelope::new(
                    "workflow",
                    "plan_content",
                    serde_json::json!({
                        "agent_slot": self.slot,
                        "session_id": self.db_session_id,
                        "content": content,
                    }),
                );
                let _ = self.sender.send(Message::Text(String::from(env).into()));
                Some(content)
            }
            None => {
                warn!(
                    feature_id = self.feature_id,
                    plan_id, "fetch_plan_content returned None"
                );
                None
            }
        }
    }

    async fn emit_prd_content(&self) -> Option<String> {
        match sqlx::query_scalar::<_, String>(
            "SELECT prd FROM features WHERE id = ? AND prd IS NOT NULL",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        {
            Ok(Some(prd_content)) => {
                info!(
                    feature_id = self.feature_id,
                    content_len = prd_content.len(),
                    "emitting prd_content"
                );
                let env = WsEnvelope::new(
                    "workflow",
                    "prd_content",
                    serde_json::json!({
                        "agent_slot": self.slot,
                        "session_id": self.db_session_id,
                        "content": prd_content,
                    }),
                );
                let _ = self.sender.send(Message::Text(String::from(env).into()));
                Some(prd_content)
            }
            Ok(None) => {
                warn!(
                    feature_id = self.feature_id,
                    "no PRD found when emitting prd_content"
                );
                None
            }
            Err(e) => {
                warn!(feature_id = self.feature_id, error = %e, "failed to query PRD");
                None
            }
        }
    }

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

        let plan: PlanRow =
            sqlx::query_as("SELECT title, summary, completion_conditions FROM plans WHERE id = ?")
                .bind(plan_id)
                .fetch_optional(&self.read_pool)
                .await
                .ok()??;

        let phases: Vec<PhaseRow> = sqlx::query_as(
            "SELECT step_number, title, phase_type, complexity, prompt, commit_message, depends_on \
             FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
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

    /// Persist plan/PRD content into the tool_call row so the frontend can
    /// render it after app restart.
    async fn attach_plan_to_tool_call(
        &self,
        request: &RuntimeToolPermissionRequest,
        content: Option<String>,
    ) {
        if let Some(plan_md) = content {
            let enriched = serde_json::json!({ "plan": plan_md });
            let enriched_str = enriched.to_string();
            crate::domain::features::repository::retry_update_agent_message_content(
                &self.write_pool,
                self.db_session_id,
                &request.tool_use_id,
                &enriched_str,
                &crate::domain::features::repository::ToolCallFilter::MessageType(
                    "tool_call".to_string(),
                ),
            )
            .await;
        }
    }
}
