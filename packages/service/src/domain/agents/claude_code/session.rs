use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;

use super::events::normalize_event;
use super::prompt_receipts::ClaudePromptReceipts;
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMcpServerConfig, RuntimeMessageRx,
    RuntimePermissionMode, RuntimePermissionUpdate, RuntimeToolPermissionHandler,
    RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};

pub struct ClaudeCodeSession {
    pub(super) query: claude_agent_sdk_rs::Query,
    pub(super) prompt_receipts: std::sync::Arc<ClaudePromptReceipts>,
}

impl ClaudeCodeSession {
    #[cfg(test)]
    pub(crate) fn from_query(query: claude_agent_sdk_rs::Query) -> Self {
        Self {
            query,
            prompt_receipts: std::sync::Arc::new(ClaudePromptReceipts::default()),
        }
    }
}

pub(super) struct ClaudeCanUseToolAdapter {
    pub(super) inner: std::sync::Arc<dyn RuntimeToolPermissionHandler>,
}

#[async_trait]
impl claude_agent_sdk_rs::CanUseTool for ClaudeCanUseToolAdapter {
    async fn can_use_tool(
        &self,
        request: claude_agent_sdk_rs::PermissionRequest,
    ) -> claude_agent_sdk_rs::PermissionResult {
        match self
            .inner
            .can_use_tool(RuntimeToolPermissionRequest {
                tool_name: request.tool_name,
                tool_use_id: request.tool_use_id,
                permission_updates: request
                    .suggestions
                    .unwrap_or_default()
                    .into_iter()
                    .map(|update| RuntimePermissionUpdate { data: update.data })
                    .collect(),
                blocked_path: request.blocked_path,
                decision_reason: request.decision_reason,
                input: request.input,
            })
            .await
        {
            RuntimeToolPermissionResult::Allow {
                updated_input,
                updated_permissions,
                tool_use_id,
            } => claude_agent_sdk_rs::PermissionResult::Allow {
                updated_input,
                updated_permissions: updated_permissions.map(|updates| {
                    updates
                        .into_iter()
                        .map(|update| claude_agent_sdk_rs::PermissionUpdate { data: update.data })
                        .collect()
                }),
                tool_use_id,
            },
            RuntimeToolPermissionResult::Deny {
                message,
                interrupt,
                tool_use_id,
            } => claude_agent_sdk_rs::PermissionResult::Deny {
                message,
                interrupt,
                tool_use_id,
            },
        }
    }
}

pub(super) fn map_permission_mode(
    mode: RuntimePermissionMode,
) -> claude_agent_sdk_rs::PermissionMode {
    match mode {
        RuntimePermissionMode::Default => claude_agent_sdk_rs::PermissionMode::Default,
        RuntimePermissionMode::AcceptEdits => claude_agent_sdk_rs::PermissionMode::AcceptEdits,
        RuntimePermissionMode::BypassPermissions => {
            claude_agent_sdk_rs::PermissionMode::BypassPermissions
        }
        RuntimePermissionMode::Plan => claude_agent_sdk_rs::PermissionMode::Plan,
        RuntimePermissionMode::Auto => claude_agent_sdk_rs::PermissionMode::Auto,
        RuntimePermissionMode::DontAsk => claude_agent_sdk_rs::PermissionMode::DontAsk,
        RuntimePermissionMode::OpenCodeAgent(_) => claude_agent_sdk_rs::PermissionMode::Default,
    }
}

pub(super) fn map_mcp_server_config(
    config: RuntimeMcpServerConfig,
) -> claude_agent_sdk_rs::mcp::McpServerConfig {
    match config {
        RuntimeMcpServerConfig::Stdio { command, args, env } => {
            claude_agent_sdk_rs::mcp::McpServerConfig::Stdio { command, args, env }
        }
    }
}

#[async_trait]
impl AgentRuntimeSession for ClaudeCodeSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        let mut source_rx = self.query.take_message_rx();
        let (tx, rx) = mpsc::channel(64);
        let prompt_receipts = std::sync::Arc::clone(&self.prompt_receipts);

        tokio::spawn(async move {
            while let Some(msg) = source_rx.recv().await {
                if let Ok(sdk_msg) = &msg {
                    if let Some(event) = acknowledge_user_prompt_receipt(sdk_msg, &prompt_receipts)
                    {
                        if tx.send(Ok(event)).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    if is_unmatched_replay_user_message(sdk_msg) {
                        continue;
                    }
                }

                let mapped = msg.map(normalize_event).map_err(RuntimeError::from);
                if tx.send(mapped).await.is_err() {
                    break;
                }
            }
        });

        rx
    }

    async fn session_id(&self) -> Option<String> {
        self.query.session_id().await
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        self.query
            .stream_input(content)
            .await
            .map_err(RuntimeError::from)
    }

    async fn stream_input_with_client_message_id(
        &self,
        content: Value,
        client_message_id: Option<String>,
    ) -> Result<(), RuntimeError> {
        let Some(client_message_id) = client_message_id else {
            return self.stream_input(content).await;
        };

        self.prompt_receipts
            .enqueue(client_message_id.clone(), &content);
        let result = self
            .query
            .stream_input(content)
            .await
            .map_err(RuntimeError::from);
        if result.is_err() {
            self.prompt_receipts.discard(&client_message_id);
        }
        result
    }

    async fn interrupt(&self) -> Result<(), RuntimeError> {
        self.query.interrupt().await.map_err(RuntimeError::from)
    }

    async fn close(&mut self) {
        self.query.close().await;
    }

    async fn set_model(&self, model: &str) -> Result<(), RuntimeError> {
        self.query
            .set_model(model)
            .await
            .map_err(RuntimeError::from)
    }

    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        self.query
            .set_permission_mode(map_permission_mode(mode))
            .await
            .map_err(RuntimeError::from)
    }

    fn pid(&self) -> Option<u32> {
        self.query.pid()
    }
}

pub(super) fn acknowledge_user_prompt_receipt(
    msg: &claude_agent_sdk_rs::SdkMessage,
    prompt_receipts: &ClaudePromptReceipts,
) -> Option<RuntimeEvent> {
    let claude_agent_sdk_rs::SdkMessage::User { message, .. } = msg else {
        return None;
    };
    prompt_receipts.acknowledge_replay(message)
}

pub(super) fn is_unmatched_replay_user_message(msg: &claude_agent_sdk_rs::SdkMessage) -> bool {
    matches!(
        msg,
        claude_agent_sdk_rs::SdkMessage::User {
            is_replay: Some(true),
            ..
        }
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        acknowledge_user_prompt_receipt, is_unmatched_replay_user_message, map_permission_mode,
    };
    use crate::domain::agents::adapter::RuntimePermissionMode;
    use crate::domain::agents::claude_code::prompt_receipts::ClaudePromptReceipts;

    #[test]
    fn acknowledges_matching_plain_user_echo_as_prompt_receipt() {
        let receipts = ClaudePromptReceipts::default();
        receipts.enqueue("client-1".to_string(), &json!("And the lint please"));
        let msg = claude_agent_sdk_rs::SdkMessage::User {
            uuid: None,
            session_id: "session-1".to_string(),
            message: json!({
                "role": "user",
                "content": "And the lint please"
            }),
            parent_tool_use_id: None,
            is_synthetic: None,
            tool_use_result: None,
            is_replay: None,
        };

        let event = acknowledge_user_prompt_receipt(&msg, &receipts).expect("receipt");

        assert_eq!(event.prompt_received_client_message_id(), Some("client-1"));
        assert!(!is_unmatched_replay_user_message(&msg));
    }

    #[test]
    fn suppresses_unmatched_explicit_replay_user_echo() {
        let msg = claude_agent_sdk_rs::SdkMessage::User {
            uuid: None,
            session_id: "session-1".to_string(),
            message: json!({
                "role": "user",
                "content": "something else"
            }),
            parent_tool_use_id: None,
            is_synthetic: None,
            tool_use_result: None,
            is_replay: Some(true),
        };

        assert!(is_unmatched_replay_user_message(&msg));
    }

    #[test]
    fn map_permission_mode_covers_all_variants() {
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::Default),
            claude_agent_sdk_rs::PermissionMode::Default
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::AcceptEdits),
            claude_agent_sdk_rs::PermissionMode::AcceptEdits
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::BypassPermissions),
            claude_agent_sdk_rs::PermissionMode::BypassPermissions
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::Plan),
            claude_agent_sdk_rs::PermissionMode::Plan
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::Auto),
            claude_agent_sdk_rs::PermissionMode::Auto
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::DontAsk),
            claude_agent_sdk_rs::PermissionMode::DontAsk
        );
    }
}
