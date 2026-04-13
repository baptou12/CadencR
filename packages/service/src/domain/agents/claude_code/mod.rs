use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;

use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeAssistantMessage, RuntimeContentBlock,
    RuntimeContentDelta, RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
    RuntimeInitEvent, RuntimeMcpServerConfig, RuntimeMcpServerStatus, RuntimeMessageRx,
    RuntimePermissionMode, RuntimeSpawnConfig, RuntimeStreamEvent, RuntimeToolPermissionHandler,
    RuntimeToolPermissionRequest, RuntimeToolPermissionResult, RuntimeUsage,
    RuntimeUserContentBlock, RuntimeUserMessage,
};
use super::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

pub struct ClaudeCodeAdapter;

pub static CLAUDE_CODE_ADAPTER: ClaudeCodeAdapter = ClaudeCodeAdapter;

pub struct ClaudeCodeSession {
    query: claude_agent_sdk_rs::Query,
}

impl ClaudeCodeSession {
    #[cfg(test)]
    pub(crate) fn from_query(query: claude_agent_sdk_rs::Query) -> Self {
        Self { query }
    }
}

struct ClaudeCanUseToolAdapter {
    inner: std::sync::Arc<dyn RuntimeToolPermissionHandler>,
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

fn map_permission_mode(mode: RuntimePermissionMode) -> claude_agent_sdk_rs::PermissionMode {
    match mode {
        RuntimePermissionMode::Default => claude_agent_sdk_rs::PermissionMode::Default,
        RuntimePermissionMode::AcceptEdits => claude_agent_sdk_rs::PermissionMode::AcceptEdits,
        RuntimePermissionMode::BypassPermissions => {
            claude_agent_sdk_rs::PermissionMode::BypassPermissions
        }
        RuntimePermissionMode::Plan => claude_agent_sdk_rs::PermissionMode::Plan,
        RuntimePermissionMode::DontAsk => claude_agent_sdk_rs::PermissionMode::DontAsk,
    }
}

fn map_mcp_server_config(
    config: RuntimeMcpServerConfig,
) -> claude_agent_sdk_rs::mcp::McpServerConfig {
    match config {
        RuntimeMcpServerConfig::Stdio { command, args, env } => {
            claude_agent_sdk_rs::mcp::McpServerConfig::Stdio { command, args, env }
        }
    }
}

fn map_content_block(block: &claude_agent_sdk_rs::types::ContentBlock) -> RuntimeContentBlock {
    match block {
        claude_agent_sdk_rs::types::ContentBlock::Text { text } => {
            RuntimeContentBlock::Text { text: text.clone() }
        }
        claude_agent_sdk_rs::types::ContentBlock::Thinking { thinking, .. } => {
            RuntimeContentBlock::Thinking {
                thinking: thinking.clone(),
            }
        }
        claude_agent_sdk_rs::types::ContentBlock::ToolUse { id, name, input } => {
            RuntimeContentBlock::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            }
        }
        _ => RuntimeContentBlock::Other,
    }
}

fn map_stream_event(event: &claude_agent_sdk_rs::StreamEventData) -> RuntimeStreamEvent {
    match event {
        claude_agent_sdk_rs::StreamEventData::MessageStart { message } => {
            RuntimeStreamEvent::MessageStart {
                model: Some(message.model.clone()),
            }
        }
        claude_agent_sdk_rs::StreamEventData::ContentBlockStart {
            index,
            content_block,
        } => RuntimeStreamEvent::ContentBlockStart {
            index: *index,
            block: map_content_block(content_block),
        },
        claude_agent_sdk_rs::StreamEventData::ContentBlockDelta { index, delta } => {
            let delta = match delta {
                claude_agent_sdk_rs::ContentDelta::TextDelta { text } => {
                    RuntimeContentDelta::Text { text: text.clone() }
                }
                claude_agent_sdk_rs::ContentDelta::ThinkingDelta { thinking } => {
                    RuntimeContentDelta::Thinking {
                        thinking: thinking.clone(),
                    }
                }
                claude_agent_sdk_rs::ContentDelta::InputJsonDelta { partial_json } => {
                    RuntimeContentDelta::InputJson {
                        partial_json: partial_json.clone(),
                    }
                }
            };
            RuntimeStreamEvent::ContentBlockDelta {
                index: *index,
                delta,
            }
        }
        claude_agent_sdk_rs::StreamEventData::ContentBlockStop { index } => {
            RuntimeStreamEvent::ContentBlockStop { index: *index }
        }
        _ => RuntimeStreamEvent::Other,
    }
}

fn map_user_message(message: &Value) -> RuntimeUserMessage {
    let content = message
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    if item.get("type").and_then(Value::as_str) == Some("tool_result") {
                        RuntimeUserContentBlock::ToolResult {
                            tool_use_id: item
                                .get("tool_use_id")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned),
                            is_error: item
                                .get("is_error")
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                            content: item.get("content").cloned().unwrap_or(Value::Null),
                        }
                    } else {
                        RuntimeUserContentBlock::Other
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    RuntimeUserMessage { content }
}

fn normalize_event(msg: claude_agent_sdk_rs::SdkMessage) -> RuntimeEvent {
    let metadata = RuntimeEventMetadata {
        session_id: msg.session_id().map(ToOwned::to_owned),
        usage: msg.usage().map(|usage| RuntimeUsage {
            input_tokens: usage.input_tokens
                + usage.cache_creation_input_tokens.unwrap_or(0)
                + usage.cache_read_input_tokens.unwrap_or(0),
            output_tokens: usage.output_tokens,
        }),
        raw: serde_json::to_value(&msg).unwrap_or_default(),
    };

    let kind = match msg {
        claude_agent_sdk_rs::SdkMessage::System(claude_agent_sdk_rs::SystemMessage::Init {
            model,
            mcp_servers,
            ..
        }) => RuntimeEventKind::Init(RuntimeInitEvent {
            model: Some(model),
            mcp_servers: mcp_servers
                .into_iter()
                .map(|server| RuntimeMcpServerStatus {
                    name: server.name,
                    status: server.status,
                })
                .collect(),
        }),
        claude_agent_sdk_rs::SdkMessage::System(
            claude_agent_sdk_rs::SystemMessage::CompactBoundary { .. },
        ) => RuntimeEventKind::CompactBoundary,
        claude_agent_sdk_rs::SdkMessage::Assistant {
            message,
            parent_tool_use_id,
            ..
        } => RuntimeEventKind::AssistantMessage {
            message: RuntimeAssistantMessage {
                model: Some(message.model),
                content: message.content.iter().map(map_content_block).collect(),
            },
            parent_tool_use_id,
        },
        claude_agent_sdk_rs::SdkMessage::User {
            message,
            parent_tool_use_id,
            ..
        } => RuntimeEventKind::UserMessage {
            message: map_user_message(&message),
            parent_tool_use_id,
        },
        claude_agent_sdk_rs::SdkMessage::StreamEvent {
            event,
            parent_tool_use_id,
            ..
        } => RuntimeEventKind::StreamEvent {
            event: map_stream_event(&event),
            parent_tool_use_id,
        },
        claude_agent_sdk_rs::SdkMessage::ToolUseSummary { data, .. } => {
            RuntimeEventKind::ToolUseSummary { data }
        }
        claude_agent_sdk_rs::SdkMessage::Result { .. } => RuntimeEventKind::Result,
        _ => RuntimeEventKind::Other,
    };

    RuntimeEvent::new(metadata, kind)
}

#[async_trait]
impl AgentRuntimeSession for ClaudeCodeSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        let mut source_rx = self.query.take_message_rx();
        let (tx, rx) = mpsc::channel(64);

        tokio::spawn(async move {
            while let Some(msg) = source_rx.recv().await {
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

#[async_trait]
impl AgentRuntimeAdapter for ClaudeCodeAdapter {
    fn is_valid_resume_session_id(&self, session_id: &str) -> bool {
        uuid::Uuid::parse_str(session_id).is_ok()
    }

    fn resolve_resume_session_id(&self, runtime_session_id: Option<&str>) -> Option<String> {
        runtime_session_id
            .filter(|sid| uuid::Uuid::parse_str(sid).is_ok())
            .map(ToOwned::to_owned)
    }

    fn catalog_entry(&self) -> ProviderCatalogEntry {
        ProviderCatalogEntry {
            id: "claude_code".to_string(),
            label: "Claude Code".to_string(),
            status: ProviderStatus::Available,
            models: crate::api::MODELS
                .iter()
                .map(|(id, label, context_window)| ModelCatalogEntry {
                    id: (*id).to_string(),
                    label: (*label).to_string(),
                    context_window: *context_window,
                })
                .collect(),
            default_model: Some(crate::api::DEFAULT_MODEL.to_string()),
        }
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        let options = claude_agent_sdk_rs::Options {
            cwd: config.cwd,
            permission_mode: config.permission_mode.map(map_permission_mode),
            model: config.model,
            system_prompt: config.system_prompt,
            resume: config.resume_session_id,
            mcp_servers: config.mcp_servers.map(|servers| {
                servers
                    .into_iter()
                    .map(|(name, cfg)| (name, map_mcp_server_config(cfg)))
                    .collect()
            }),
            can_use_tool: config.permission_handler.map(|handler| {
                Box::new(ClaudeCanUseToolAdapter { inner: handler })
                    as Box<dyn claude_agent_sdk_rs::CanUseTool>
            }),
            ..claude_agent_sdk_rs::Options::default()
        };

        let query = claude_agent_sdk_rs::query(content, options)
            .await
            .map_err(RuntimeError::from)?;
        Ok(Box::new(ClaudeCodeSession { query }))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{map_permission_mode, normalize_event, ClaudeCodeAdapter};
    use crate::domain::agents::adapter::{
        AgentRuntimeAdapter, RuntimeContentDelta, RuntimePermissionMode, RuntimeStreamEvent,
    };

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
            map_permission_mode(RuntimePermissionMode::DontAsk),
            claude_agent_sdk_rs::PermissionMode::DontAsk
        );
    }

    #[test]
    fn adapter_resume_id_validation_is_uuid_only() {
        let adapter = ClaudeCodeAdapter;
        assert!(adapter.is_valid_resume_session_id("11111111-1111-4111-8111-111111111111"));
        assert!(!adapter.is_valid_resume_session_id("ses_27f586910ffeUNaKL2l5UARerl"));
    }

    #[test]
    fn normalize_event_maps_stream_text_delta() {
        let message: claude_agent_sdk_rs::SdkMessage = serde_json::from_value(json!({
            "type": "stream_event",
            "uuid": "u1",
            "session_id": "s1",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "hello" }
            }
        }))
        .expect("valid stream event");

        let event = normalize_event(message);
        match event.stream_event() {
            Some(RuntimeStreamEvent::ContentBlockDelta {
                index,
                delta: RuntimeContentDelta::Text { text },
            }) => {
                assert_eq!(*index, 0);
                assert_eq!(text, "hello");
            }
            other => panic!("unexpected stream mapping: {other:?}"),
        }
    }

    #[test]
    fn normalize_event_maps_result_to_result_kind() {
        let message: claude_agent_sdk_rs::SdkMessage = serde_json::from_value(json!({
            "type": "result",
            "subtype": "success",
            "uuid": "u2",
            "session_id": "s2",
            "duration_ms": 1,
            "duration_api_ms": 1,
            "is_error": false,
            "num_turns": 1,
            "result": "ok",
            "total_cost_usd": 0.0,
            "usage": { "input_tokens": 1, "output_tokens": 1 }
        }))
        .expect("valid result event");

        let event = normalize_event(message);
        assert!(event.is_result());
    }
}
