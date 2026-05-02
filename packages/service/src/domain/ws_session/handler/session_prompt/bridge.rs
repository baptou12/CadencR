use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::ws::Message;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info, warn};

use crate::domain::agents::adapter::{
    RuntimeToolPermissionHandler, RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};
use crate::domain::permission_bridge::{self, ResolvedAction};
use crate::domain::ws_session::persistence::{
    PendingUserInput, PendingUserInputKind, WsSessionPersistence,
};
use crate::domain::ws_session::protocol::{
    ImagePayload, PermissionDecision, PermissionRequestPayload, WsEnvelope,
};

use super::super::WsSender;

pub(crate) fn build_content_value(text: &str, images: &[ImagePayload]) -> serde_json::Value {
    if images.is_empty() {
        serde_json::Value::String(text.to_string())
    } else {
        let mut blocks: Vec<serde_json::Value> = Vec::with_capacity(1 + images.len());
        blocks.push(serde_json::json!({
            "type": "text",
            "text": text
        }));
        for img in images {
            blocks.push(serde_json::json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.mime_type,
                    "data": img.base64
                }
            }));
        }
        serde_json::Value::Array(blocks)
    }
}

pub(crate) fn build_persist_content(text: &str, images: &[ImagePayload]) -> String {
    if images.is_empty() {
        text.to_string()
    } else {
        let content = build_content_value(text, images);
        serde_json::to_string(&content).unwrap_or_else(|_| text.to_string())
    }
}

#[derive(Clone)]
pub struct PermissionResponse {
    pub(crate) request_id: String,
    pub(crate) decision: PermissionDecision,
    pub(crate) feedback: Option<String>,
    pub(crate) updated_input: Option<serde_json::Value>,
    pub(crate) is_approval_gate: bool,
}

pub(super) struct WsBridgeCanUseTool {
    pub(super) sender: WsSender,
    pub(super) response_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    pub(super) worktree_path: PathBuf,
    pub(super) session_cache: Arc<Mutex<HashSet<String>>>,
    pub(super) allowed_patterns: Arc<HashSet<String>>,
    pub(super) feature_id: i64,
    pub(super) db_session_id: i64,
    pub(super) write_pool: sqlx::SqlitePool,
    pub(super) session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
}

#[async_trait]
impl RuntimeToolPermissionHandler for WsBridgeCanUseTool {
    async fn can_use_tool(
        &self,
        request: RuntimeToolPermissionRequest,
    ) -> RuntimeToolPermissionResult {
        debug!(
            tool_name = %request.tool_name,
            tool_use_id = %request.tool_use_id,
            "WsBridgeCanUseTool::can_use_tool called"
        );

        // EnterPlanMode: persist permission_mode = 'plan' to DB
        if request.tool_name == "EnterPlanMode" {
            let _ = sqlx::query("UPDATE agent_sessions SET permission_mode = 'plan' WHERE id = ?")
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
            return RuntimeToolPermissionResult::Allow {
                updated_input: request.input,
                updated_permissions: None,
                tool_use_id: Some(request.tool_use_id),
            };
        }

        // Intercept ExitPlanMode: persist to DB, send plan_approval event, and block until user responds.
        if request.tool_name == "ExitPlanMode" {
            return self.handle_exit_plan_mode(&request).await;
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

impl WsBridgeCanUseTool {
    async fn handle_exit_plan_mode(
        &self,
        request: &RuntimeToolPermissionRequest,
    ) -> RuntimeToolPermissionResult {
        if let Some(result) = self.check_stored_approval(request).await {
            return result;
        }

        info!("ExitPlanMode detected, sending plan_approval and blocking");

        WsSessionPersistence::mark_awaiting_user_static(
            &self.write_pool,
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            &PendingUserInput::PlanApproval(&request.input),
        )
        .await;

        self.send_plan_permission_request(request, request.input.clone());

        let enriched_input = self.attach_plan_to_exit_block(request).await;
        if enriched_input != request.input {
            // Enriched retry: refresh the DB payload without re-broadcasting
            // askUser (still the same gate).
            WsSessionPersistence::set_pending_user_input_static(
                &self.write_pool,
                self.db_session_id,
                &PendingUserInput::PlanApproval(&enriched_input),
            )
            .await;
            self.send_plan_permission_request(request, enriched_input);
        }

        let mut rx = self.response_rx.lock().await;
        match rx.recv().await {
            Some(response) => {
                let decision = response.decision.clone();
                if response.request_id != request.tool_use_id {
                    debug!(
                        expected_request_id = %request.tool_use_id,
                        received_request_id = %response.request_id,
                        "permission response request_id mismatch, applying latest response",
                    );
                }
                // Plan-approval gate: a Deny *with* feedback hands the turn
                // back to the agent (user is asking for a revision). Bare
                // Denies terminate the turn like any other rejection.
                WsSessionPersistence::mark_agent_resumed_static(
                    &self.write_pool,
                    &self.session_status_tx,
                    self.db_session_id,
                    self.feature_id,
                    PendingUserInputKind::PlanApproval,
                    crate::domain::permission_bridge::status_after_approval(
                        decision,
                        response.feedback.as_deref(),
                    ),
                )
                .await;
                self.apply_exit_plan_decision(request, response).await
            }
            None => {
                // Channel closed before a response. Clear the DB gate AND
                // broadcast Idle so any subscribed client still showing
                // Question drops back to idle.
                WsSessionPersistence::mark_agent_resumed_static(
                    &self.write_pool,
                    &self.session_status_tx,
                    self.db_session_id,
                    self.feature_id,
                    PendingUserInputKind::PlanApproval,
                    crate::domain::session_status::AgentStatus::Idle,
                )
                .await;
                RuntimeToolPermissionResult::Deny {
                    message: "Plan approval channel closed".to_string(),
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id.clone()),
                }
            }
        }
    }

    async fn check_stored_approval(
        &self,
        request: &RuntimeToolPermissionRequest,
    ) -> Option<RuntimeToolPermissionResult> {
        #[derive(sqlx::FromRow)]
        struct ApprovalRow {
            plan_approval_result: Option<String>,
        }
        let row = sqlx::query_as::<_, ApprovalRow>(
            "SELECT plan_approval_result FROM agent_sessions WHERE id = ?",
        )
        .bind(self.db_session_id)
        .fetch_optional(&self.write_pool)
        .await
        .ok()??;

        let result_str = row.plan_approval_result.as_ref()?;
        let result = serde_json::from_str::<serde_json::Value>(result_str).ok()?;

        // plan_approval_result is a sibling column (not a pending_* gate) —
        // clear it directly; the PlanApproval gate goes through the helper.
        if let Err(e) =
            sqlx::query("UPDATE agent_sessions SET plan_approval_result = NULL WHERE id = ?")
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await
        {
            warn!(session_id = self.db_session_id, error = %e, "failed to clear plan_approval_result");
        }
        WsSessionPersistence::clear_pending_user_input_static(
            &self.write_pool,
            self.db_session_id,
            PendingUserInputKind::PlanApproval,
        )
        .await;

        let approved = result
            .get("approved")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if approved {
            info!("ExitPlanMode: using stored approval result (approved)");
            Some(RuntimeToolPermissionResult::Allow {
                updated_input: request.input.clone(),
                updated_permissions: None,
                tool_use_id: Some(request.tool_use_id.clone()),
            })
        } else {
            let feedback = result
                .get("feedback")
                .and_then(|v| v.as_str())
                .unwrap_or("User requested changes to the plan.")
                .to_string();
            info!("ExitPlanMode: using stored approval result (denied)");
            Some(RuntimeToolPermissionResult::Deny {
                message: feedback,
                interrupt: Some(false),
                tool_use_id: Some(request.tool_use_id.clone()),
            })
        }
    }

    async fn apply_exit_plan_decision(
        &self,
        request: &RuntimeToolPermissionRequest,
        response: PermissionResponse,
    ) -> RuntimeToolPermissionResult {
        match response.decision {
            PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => {
                let p = WsSessionPersistence::with_session_id(
                    self.write_pool.clone(),
                    self.feature_id,
                    Some(self.db_session_id),
                );
                p.persist_user_message("Plan approved.").await;
                let _ = sqlx::query(
                    "UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE id = ?",
                )
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
                RuntimeToolPermissionResult::Allow {
                    updated_input: request.input.clone(),
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id.clone()),
                }
            }
            PermissionDecision::Deny => {
                let feedback = response
                    .feedback
                    .unwrap_or_else(|| "User requested changes to the plan.".to_string());
                let p = WsSessionPersistence::with_session_id(
                    self.write_pool.clone(),
                    self.feature_id,
                    Some(self.db_session_id),
                );
                p.persist_user_message(&feedback).await;
                RuntimeToolPermissionResult::Deny {
                    message: feedback,
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id.clone()),
                }
            }
        }
    }

    async fn attach_plan_to_exit_block(
        &self,
        request: &RuntimeToolPermissionRequest,
    ) -> serde_json::Value {
        let plan_path: Option<String> = sqlx::query_scalar(
            "SELECT content FROM agent_messages \
             WHERE session_id = ? AND message_type = 'tool_call' AND tool_name = 'Write' \
             AND content LIKE '%plans/%' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(self.db_session_id)
        .fetch_optional(&self.write_pool)
        .await
        .ok()
        .flatten();

        let plan_content = match plan_path {
            Some(content_json) => {
                let parsed: Option<String> =
                    serde_json::from_str::<serde_json::Value>(&content_json)
                        .ok()
                        .and_then(|v| v.get("file_path")?.as_str().map(String::from));
                match parsed {
                    Some(file_path) => tokio::fs::read_to_string(&file_path).await.ok(),
                    None => None,
                }
            }
            None => None,
        };

        let mut enriched = request.input.clone();
        if let Some(plan_md) = plan_content {
            enriched["plan"] = serde_json::Value::String(plan_md);
            let updated_content = serde_json::to_string(&enriched).unwrap_or_default();
            crate::domain::features::repository::retry_update_agent_message_content(
                &self.write_pool,
                self.db_session_id,
                &request.tool_use_id,
                &updated_content,
                &crate::domain::features::repository::ToolCallFilter::ToolName(
                    "ExitPlanMode".to_string(),
                ),
            )
            .await;
        }
        enriched
    }

    fn send_plan_permission_request(
        &self,
        request: &RuntimeToolPermissionRequest,
        tool_input: serde_json::Value,
    ) {
        let payload = PermissionRequestPayload {
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input,
            description: Some("Plan is ready for approval".to_string()),
            pattern: None,
            preview: None,
            options: Vec::new(),
        };
        let envelope = WsEnvelope::new(
            "session",
            "permission.request",
            serde_json::to_value(payload).unwrap(),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));
    }

    async fn handle_needs_prompt(
        &self,
        request: &RuntimeToolPermissionRequest,
        description: String,
        pattern: String,
        force_prompt: bool,
    ) -> RuntimeToolPermissionResult {
        debug!(tool_name = %request.tool_name, pattern = %pattern, "prompting user");

        let payload = PermissionRequestPayload {
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input: request.input.clone(),
            description: Some(description),
            pattern: Some(pattern.clone()),
            preview: permission_bridge::extract_permission_preview(&request.input),
            options: permission_bridge::build_default_permission_options(Some(&pattern)),
        };
        WsSessionPersistence::mark_awaiting_user_static(
            &self.write_pool,
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            &PendingUserInput::Permission(&payload),
        )
        .await;
        let envelope = WsEnvelope::new(
            "session",
            "permission.request",
            serde_json::to_value(payload).unwrap(),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));

        // `wait_and_apply_decision` owns the clear + terminal-turn broadcast.
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
            PendingUserInputKind::Permission,
        )
        .await
    }
}
