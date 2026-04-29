use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeAssistantMessage, RuntimeCompactMetadata, RuntimeContentBlock, RuntimeContentDelta,
    RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeInitEvent, RuntimeMcpServerStatus,
    RuntimeStreamEvent, RuntimeUsage, RuntimeUserContentBlock, RuntimeUserMessage,
};

pub(super) fn context_window_for_model_from_raw(raw: &Value, model: &str) -> Option<u64> {
    let model_usage = raw.get("modelUsage")?.as_object()?;
    if let Some(context_window) = model_usage
        .get(model)
        .and_then(|entry| entry.get("contextWindow"))
        .and_then(Value::as_u64)
    {
        return Some(context_window);
    }

    if model_usage.len() == 1 {
        return model_usage
            .values()
            .next()
            .and_then(|entry| entry.get("contextWindow"))
            .and_then(Value::as_u64);
    }

    None
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
                input_tokens: message
                    .usage
                    .as_ref()
                    .map(|usage| usage.total_input_tokens()),
            }
        }
        claude_agent_sdk_rs::StreamEventData::ContentBlockStart {
            index,
            content_block,
        } => RuntimeStreamEvent::ContentBlockStart {
            index: u64::from(*index),
            block: map_content_block(content_block),
        },
        claude_agent_sdk_rs::StreamEventData::ContentBlockDelta { index, delta } => {
            RuntimeStreamEvent::ContentBlockDelta {
                index: u64::from(*index),
                delta: match delta {
                    claude_agent_sdk_rs::types::ContentDelta::TextDelta { text } => {
                        RuntimeContentDelta::Text { text: text.clone() }
                    }
                    claude_agent_sdk_rs::types::ContentDelta::ThinkingDelta { thinking } => {
                        RuntimeContentDelta::Thinking {
                            thinking: thinking.clone(),
                        }
                    }
                    claude_agent_sdk_rs::types::ContentDelta::InputJsonDelta { partial_json } => {
                        RuntimeContentDelta::InputJson {
                            partial_json: partial_json.clone(),
                        }
                    }
                },
            }
        }
        claude_agent_sdk_rs::StreamEventData::ContentBlockStop { index } => {
            RuntimeStreamEvent::ContentBlockStop {
                index: u64::from(*index),
            }
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

pub(super) fn normalize_event(msg: claude_agent_sdk_rs::SdkMessage) -> RuntimeEvent {
    let metadata = RuntimeEventMetadata {
        session_id: msg.session_id().map(ToOwned::to_owned),
        usage: msg.usage().map(|usage| RuntimeUsage {
            input_tokens: usage.input_tokens
                + usage.cache_creation_input_tokens.unwrap_or(0)
                + usage.cache_read_input_tokens.unwrap_or(0),
            output_tokens: usage.output_tokens,
        }),
        context_window: msg.result_context_window(),
        raw: serde_json::to_value(&msg).unwrap_or(Value::Null),
    };

    let kind = match msg {
        claude_agent_sdk_rs::SdkMessage::System(system) => match system {
            claude_agent_sdk_rs::messages::SystemMessage::Init {
                model, mcp_servers, ..
            } => RuntimeEventKind::Init(RuntimeInitEvent {
                model: Some(model),
                mcp_servers: mcp_servers
                    .into_iter()
                    .map(|server| RuntimeMcpServerStatus {
                        name: server.name,
                        status: server.status,
                    })
                    .collect(),
                context_window: None,
            }),
            claude_agent_sdk_rs::messages::SystemMessage::CompactBoundary {
                compact_metadata,
                ..
            } => RuntimeEventKind::CompactBoundary {
                metadata: Some(RuntimeCompactMetadata {
                    trigger: Some(compact_metadata.trigger),
                    pre_tokens: Some(compact_metadata.pre_tokens),
                }),
            },
        },
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{context_window_for_model_from_raw, normalize_event};
    use crate::domain::agents::adapter::{RuntimeContentDelta, RuntimeStreamEvent};

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
    fn normalize_event_extracts_context_window_from_result() {
        let msg: claude_agent_sdk_rs::SdkMessage = serde_json::from_value(json!({
            "type": "result",
            "subtype": "success",
            "uuid": "r",
            "session_id": "s",
            "duration_ms": 10,
            "duration_api_ms": 5,
            "is_error": false,
            "num_turns": 1,
            "result": "ok",
            "total_cost_usd": 0.0,
            "usage": { "input_tokens": 1, "output_tokens": 1 },
            "permission_denials": [],
            "modelUsage": {
                "claude-opus-4-7[1m]": { "contextWindow": 1000000 }
            }
        }))
        .unwrap();
        let event = normalize_event(msg);
        assert_eq!(event.context_window(), Some(1_000_000));
    }

    #[test]
    fn context_window_for_model_from_raw_uses_single_entry_for_default_alias() {
        let raw = json!({
            "type": "result",
            "modelUsage": {
                "claude-opus-4-7[1m]": { "contextWindow": 1_000_000 }
            }
        });

        assert_eq!(
            context_window_for_model_from_raw(&raw, "default"),
            Some(1_000_000)
        );
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
