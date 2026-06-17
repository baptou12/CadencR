use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;

use super::events::normalize_event;
use super::prompt_receipts::ClaudePromptReceipts;
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMcpServerConfig,
    RuntimeMcpServerStatus, RuntimeMessageRx, RuntimePermissionMode, RuntimePermissionUpdate,
    RuntimeStreamEvent, RuntimeToolPermissionHandler, RuntimeToolPermissionRequest,
    RuntimeToolPermissionResult,
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
            'messages: while let Some(msg) = source_rx.recv().await {
                match msg {
                    Ok(sdk_msg) => {
                        if let Some(event) =
                            acknowledge_user_prompt_receipt(&sdk_msg, &prompt_receipts)
                        {
                            if tx.send(Ok(event)).await.is_err() {
                                break;
                            }
                            continue;
                        }
                        if is_unmatched_replay_user_message(&sdk_msg) {
                            continue;
                        }
                        let mapped = normalize_event(sdk_msg);
                        for event in
                            acknowledge_turn_boundary_prompt_receipts(&mapped, &prompt_receipts)
                        {
                            if tx.send(Ok(event)).await.is_err() {
                                break 'messages;
                            }
                        }
                        if tx.send(Ok(mapped)).await.is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        if tx.send(Err(RuntimeError::from(error))).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });

        rx
    }

    async fn session_id(&self) -> Option<String> {
        self.query.session_id().await
    }

    async fn available_mcp_servers(&self) -> Result<Vec<RuntimeMcpServerStatus>, RuntimeError> {
        Ok(self
            .query
            .available_mcp_servers()
            .await
            .map_err(RuntimeError::from)?
            .into_iter()
            .map(|server| RuntimeMcpServerStatus {
                name: server.name,
                status: server.status,
            })
            .collect())
    }

    async fn refresh_mcp_servers(&self) -> Result<Vec<RuntimeMcpServerStatus>, RuntimeError> {
        Ok(self
            .query
            .refresh_mcp_server_status()
            .await
            .map_err(RuntimeError::from)?
            .into_iter()
            .map(|server| RuntimeMcpServerStatus {
                name: server.name,
                status: server.status,
            })
            .collect())
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

/// Drain every outstanding prompt receipt at a turn boundary: assistant
/// `message_start` (Claude is responding, so it saw what we sent) or `Result`
/// (turn end, including interrupt). The `Result` anchor is the deterministic
/// fallback — an interrupt can drop both normal ack signals (text-matched
/// replay, next `message_start`), leaving the receipt and its frontend
/// "pending" decoration stuck until an app restart. Draining all is safe
/// because a receipt only exists for the current turn (it is enqueued at
/// stream time, after the prior turn's `Result`).
pub(super) fn acknowledge_turn_boundary_prompt_receipts(
    event: &RuntimeEvent,
    prompt_receipts: &ClaudePromptReceipts,
) -> Vec<RuntimeEvent> {
    let is_response_start = matches!(
        event.stream_event(),
        Some(RuntimeStreamEvent::MessageStart { .. })
    );
    if !is_response_start && !event.is_result() {
        return Vec::new();
    }
    prompt_receipts.acknowledge_all_pending()
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
        acknowledge_turn_boundary_prompt_receipts, acknowledge_user_prompt_receipt,
        is_unmatched_replay_user_message, map_permission_mode,
    };
    use crate::domain::agents::adapter::{
        RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimePermissionMode,
    };
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
    fn acknowledges_pending_prompts_when_claude_starts_next_response() {
        let receipts = ClaudePromptReceipts::default();
        receipts.enqueue("client-1".to_string(), &json!("And the ts-check"));
        receipts.enqueue("client-2".to_string(), &json!("Resume please"));
        let msg = claude_agent_sdk_rs::SdkMessage::StreamEvent {
            uuid: "u1".to_string(),
            session_id: "session-1".to_string(),
            parent_tool_use_id: None,
            event: claude_agent_sdk_rs::StreamEventData::MessageStart {
                message: claude_agent_sdk_rs::messages::MessageStartBody {
                    id: "msg-1".to_string(),
                    model: "claude-sonnet-4-20250514".to_string(),
                    usage: None,
                    msg_type: Some("message".to_string()),
                },
            },
        };

        let event = crate::domain::agents::claude_code::events::normalize_event(msg);
        let events = acknowledge_turn_boundary_prompt_receipts(&event, &receipts);

        let ids: Vec<_> = events
            .iter()
            .filter_map(|event| event.prompt_received_client_message_id())
            .collect();
        assert_eq!(ids, vec!["client-1", "client-2"]);
        assert!(acknowledge_turn_boundary_prompt_receipts(&event, &receipts).is_empty());
    }

    #[test]
    fn acknowledges_pending_prompts_when_turn_ends() {
        // A steering prompt sent right before an interrupt: the turn ends with a
        // `Result` and no further `message_start` arrives, so the turn-end drain
        // is the only thing that resolves the receipt. Without it the frontend
        // block stays pending until the app restarts.
        let receipts = ClaudePromptReceipts::default();
        receipts.enqueue(
            "client-1".to_string(),
            &json!("interrupted steering prompt"),
        );
        let event = RuntimeEvent::new(RuntimeEventMetadata::default(), RuntimeEventKind::Result);
        let events = acknowledge_turn_boundary_prompt_receipts(&event, &receipts);

        let ids: Vec<_> = events
            .iter()
            .filter_map(|event| event.prompt_received_client_message_id())
            .collect();
        assert_eq!(ids, vec!["client-1"]);
        assert!(acknowledge_turn_boundary_prompt_receipts(&event, &receipts).is_empty());
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
