use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::ws::Message;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info};

use crate::domain::agents::adapter::{
    RuntimeToolPermissionHandler, RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};
use crate::domain::permission_bridge;
use crate::domain::ws_session::persistence::{
    PendingUserInput, PendingUserInputKind, WsSessionPersistence,
};
use crate::domain::ws_session::protocol::{
    ImagePayload, PermissionDecision, PermissionRequestPayload, SessionErrorPayload, WsEnvelope,
};

use super::super::post_plan_mode::transition_session_to_post_plan_mode;
use super::super::types::SdkSessions;
use super::super::WsSender;

pub(crate) fn build_content_value(text: &str, images: &[ImagePayload]) -> serde_json::Value {
    if images.is_empty() {
        serde_json::Value::String(text.to_string())
    } else {
        let mut blocks: Vec<serde_json::Value> =
            Vec::with_capacity(images.len() + usize::from(!text.is_empty()));
        if !text.is_empty() {
            blocks.push(serde_json::json!({
                "type": "text",
                "text": text
            }));
        }
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

#[cfg(test)]
mod tests {
    use super::{build_content_value, ImagePayload};

    #[test]
    fn content_blocks_match_text_presence() {
        let images = vec![ImagePayload {
            base64: "abc".into(),
            mime_type: "image/png".into(),
        }];
        let image_only = build_content_value("", &images);
        assert_eq!(image_only.as_array().map(Vec::len), Some(1));
        assert_eq!(image_only[0]["type"], "image");
        assert_eq!(image_only[0]["source"]["data"], "abc");
        let content = build_content_value("hello", &images);
        assert_eq!(content.as_array().map(Vec::len), Some(2));
        assert_eq!(content[0]["text"], "hello");
        assert_eq!(content[1]["source"]["data"], "abc");
    }
}

#[derive(Clone)]
pub struct PermissionResponse {
    pub(crate) request_id: String,
    pub(crate) decision: PermissionDecision,
    #[allow(dead_code)]
    pub(crate) option_id: Option<String>,
    pub(crate) feedback: Option<String>,
    pub(crate) updated_input: Option<serde_json::Value>,
    #[allow(dead_code)]
    pub(crate) is_approval_gate: bool,
}

pub(crate) struct WsBridgeCanUseTool {
    pub(crate) sender: WsSender,
    pub(crate) response_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    pub(crate) feature_id: i64,
    pub(crate) db_session_id: i64,
    pub(crate) write_pool: sqlx::SqlitePool,
    pub(crate) session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
    pub(crate) sdk_sessions: SdkSessions,
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

        if request.tool_name == "ExitPlanMode" {
            return self.handle_exit_plan_mode(&request).await;
        }

        self.handle_provider_permission_prompt(&request).await
    }
}

impl WsBridgeCanUseTool {
    async fn handle_exit_plan_mode(
        &self,
        request: &RuntimeToolPermissionRequest,
    ) -> RuntimeToolPermissionResult {
        info!("ExitPlanMode detected, sending permission request and blocking");

        let initial_payload = self.plan_permission_payload(request, request.input.clone());
        WsSessionPersistence::mark_awaiting_user_static(
            &self.write_pool,
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            &PendingUserInput::Permission(&initial_payload),
        )
        .await;

        self.send_permission_payload(initial_payload);

        let enriched_input = self.attach_plan_to_exit_block(request).await;
        if enriched_input != request.input {
            let enriched_payload = self.plan_permission_payload(request, enriched_input);
            WsSessionPersistence::set_pending_user_input_static(
                &self.write_pool,
                self.db_session_id,
                &PendingUserInput::Permission(&enriched_payload),
            )
            .await;
            self.send_permission_payload(enriched_payload);
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
                WsSessionPersistence::mark_agent_resumed_static(
                    &self.write_pool,
                    &self.session_status_tx,
                    self.db_session_id,
                    self.feature_id,
                    PendingUserInputKind::Permission,
                    crate::domain::permission_bridge::status_after_approval(
                        decision,
                        response.feedback.as_deref(),
                    ),
                )
                .await;
                self.apply_exit_plan_decision(request, response).await
            }
            None => {
                WsSessionPersistence::mark_agent_resumed_static(
                    &self.write_pool,
                    &self.session_status_tx,
                    self.db_session_id,
                    self.feature_id,
                    PendingUserInputKind::Permission,
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
                self.transition_to_post_plan_mode().await;
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

    /// Push post-plan permission mode to CLI, DB, and UI in one synchronous path.
    async fn transition_to_post_plan_mode(&self) {
        if let Err(e) = transition_session_to_post_plan_mode(
            &self.sdk_sessions,
            self.db_session_id,
            &self.write_pool,
            &self.sender,
        )
        .await
        {
            error!(
                db_session_id = self.db_session_id,
                error = %e,
                "post-plan-approval: failed to push set_permission_mode to CLI"
            );
            let err = WsEnvelope::new(
                "session",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "SDK_ERROR".into(),
                    message: format!("Failed to apply post-plan permission mode: {e}"),
                    ..Default::default()
                })
                .unwrap(),
            );
            let _ = self.sender.send(Message::Text(String::from(err).into()));
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

    fn plan_permission_payload(
        &self,
        request: &RuntimeToolPermissionRequest,
        tool_input: serde_json::Value,
    ) -> PermissionRequestPayload {
        PermissionRequestPayload {
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input,
            description: Some("Plan is ready for approval".to_string()),
            pattern: None,
            preview: None,
            options: Vec::new(),
        }
    }

    fn send_permission_payload(&self, payload: PermissionRequestPayload) {
        let envelope = WsEnvelope::new(
            "session",
            "permission.request",
            serde_json::to_value(payload).unwrap(),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));
    }

    async fn handle_provider_permission_prompt(
        &self,
        request: &RuntimeToolPermissionRequest,
    ) -> RuntimeToolPermissionResult {
        debug!(tool_name = %request.tool_name, "prompting user for provider-native permission");
        let permission_updates =
            permission_bridge::persistent_permission_updates(&request.permission_updates);

        let payload = PermissionRequestPayload {
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input: request.input.clone(),
            description: Some(permission_bridge::provider_permission_description(request)),
            pattern: None,
            preview: permission_bridge::extract_permission_preview(&request.input),
            options: permission_bridge::build_provider_permission_options(&permission_updates),
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
            &permission_updates,
            &self.session_status_tx,
            self.feature_id,
            &self.write_pool,
            self.db_session_id,
            PendingUserInputKind::Permission,
        )
        .await
    }
}
