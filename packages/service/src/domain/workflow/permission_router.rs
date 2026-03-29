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
use tracing::{debug, error, info, warn};

use axum::extract::ws::Message;
use claude_agent_sdk_rs::{CanUseTool, PermissionRequest, PermissionResult};

use crate::domain::features::repository as repo;
use crate::domain::workflow::engine::{AgentSlot, WsSender};
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::permissions;
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
    pub async fn respond(&self, slot: AgentSlot, response: PermissionResponse) -> Result<(), String> {
        if let Some(tx) = self.permission_txs.get(&slot) {
            return tx.send(response).await
                .map_err(|_| format!("Permission channel closed for slot {slot}"));
        }
        Err(format!("No permission channel for slot {slot} — agent may need restart"))
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

            // Emit the plan content as a synthetic text block
            if is_show_plan {
                match sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
                )
                .bind(self.feature_id)
                .fetch_optional(&self.read_pool)
                .await
                {
                    Ok(Some(plan_id)) => {
                        let plan_content = self.fetch_plan_content(plan_id).await;
                        match plan_content {
                            Some(content) => {
                                info!(feature_id = self.feature_id, plan_id, content_len = content.len(), "emitting plan_content");
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
                            None => {
                                warn!(feature_id = self.feature_id, plan_id, "fetch_plan_content returned None");
                            }
                        }
                    }
                    Ok(None) => {
                        warn!(feature_id = self.feature_id, "no plan found for feature when emitting plan_content");
                    }
                    Err(e) => {
                        warn!(feature_id = self.feature_id, error = %e, "failed to query plan for plan_content");
                    }
                }
            }

            // Emit the PRD content as a synthetic text block
            if is_show_prd {
                match sqlx::query_scalar::<_, String>(
                    "SELECT prd FROM features WHERE id = ? AND prd IS NOT NULL",
                )
                .bind(self.feature_id)
                .fetch_optional(&self.read_pool)
                .await
                {
                    Ok(Some(prd_content)) => {
                        info!(feature_id = self.feature_id, content_len = prd_content.len(), "emitting prd_content");
                        let content_env = WsEnvelope::new(
                            "workflow",
                            "prd_content",
                            serde_json::json!({
                                "agent_slot": self.slot,
                                "session_id": self.db_session_id,
                                "content": prd_content,
                            }),
                        );
                        let _ = self.sender.send(Message::Text(String::from(content_env).into()));
                    }
                    Ok(None) => {
                        warn!(feature_id = self.feature_id, "no PRD found for feature when emitting prd_content");
                    }
                    Err(e) => {
                        warn!(feature_id = self.feature_id, error = %e, "failed to query PRD for prd_content");
                    }
                }
            }

            // Also notify that plan/prd data is ready for fetching
            let changed: &[&str] = if is_show_plan { &["plan", "phases", "progress"] } else { &["prd"] };
            send_feature_updated_envelope(&self.sender, self.feature_id, changed);

            // Block on permission channel
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
                PermissionResult::Allow {
                    updated_input: request.input,
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id),
                }
            }
            permissions::ResolvedPermission::Deny { reason } => {
                debug!(tool_name = %request.tool_name, reason = %reason, "workflow auto-denied");
                PermissionResult::Deny {
                    message: reason,
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id),
                }
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
                let is_ask_user_question = request.tool_name == "AskUserQuestion";
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

                // Persist pending question data so it survives navigation/refresh
                if is_ask_user_question {
                    let pq_json = serde_json::json!({
                        "tool_name": &request.tool_name,
                        "tool_input": &request.input,
                        "request_id": &request.tool_use_id,
                        "pattern": &pattern,
                    });
                    let _ = sqlx::query(
                        "UPDATE agent_sessions SET pending_questions = ? WHERE id = ?"
                    )
                    .bind(pq_json.to_string())
                    .bind(self.db_session_id)
                    .execute(&self.write_pool)
                    .await;
                }

                // Broadcast turn → askUser
                crate::domain::ws_session::persistence::WsSessionPersistence::broadcast_turn_state(
                    &self.turn_state_tx, self.feature_id, "askUser",
                );

                // Wait for user response
                let original_input = request.input;
                let mut rx: tokio::sync::MutexGuard<'_, mpsc::Receiver<PermissionResponse>> = self.response_rx.lock().await;
                match rx.recv().await {
                    Some(response) => {
                        // Clear persisted pending questions now that user has responded
                        if is_ask_user_question {
                            let _ = sqlx::query(
                                "UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?"
                            )
                            .bind(self.db_session_id)
                            .execute(&self.write_pool)
                            .await;
                        }

                        // Broadcast turn → claude (user responded)
                        crate::domain::ws_session::persistence::WsSessionPersistence::broadcast_turn_state(
                            &self.turn_state_tx, self.feature_id, "claude",
                        );
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
