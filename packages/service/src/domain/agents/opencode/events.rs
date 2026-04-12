use serde_json::Value;

use super::questions::build_question_tool_input;
use crate::domain::agents::adapter::{
    RuntimeAssistantMessage, RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent,
    RuntimeEventKind, RuntimeEventMetadata, RuntimeInitEvent, RuntimeStreamEvent, RuntimeUsage,
    RuntimeUserContentBlock, RuntimeUserMessage,
};

pub fn assistant_fallback_event(message: &opencode_sdk_rs::Message) -> RuntimeEvent {
    let model = message.model.clone();
    let content = message
        .parts
        .iter()
        .map(message_part_to_runtime_block)
        .collect::<Vec<RuntimeContentBlock>>();
    let raw_content = message
        .parts
        .iter()
        .map(message_part_to_json)
        .collect::<Vec<Value>>();
    let raw = serde_json::json!({
        "type": "assistant",
        "session_id": message.session_id,
        "parent_tool_use_id": Value::Null,
        "message": {
            "model": model,
            "content": raw_content,
        }
    });
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(message.session_id.clone()),
            usage: runtime_usage_from_tokens(message.tokens.as_ref()),
            raw,
        },
        RuntimeEventKind::AssistantMessage {
            message: RuntimeAssistantMessage { model, content },
            parent_tool_use_id: None,
        },
    )
}

pub fn message_start_event(
    session_id: &str,
    model: Option<String>,
    usage: Option<RuntimeUsage>,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": Value::Null,
        "event": {
            "type": "message_start",
            "message": { "model": model.clone() },
        }
    });
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage,
            raw,
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::MessageStart { model },
            parent_tool_use_id: None,
        },
    )
}

pub fn stream_start_event(
    session_id: &str,
    index: u32,
    block: RuntimeContentBlock,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": Value::Null,
        "event": {
            "type": "content_block_start",
            "index": index,
            "content_block": runtime_content_block_to_json(&block),
        }
    });
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            raw,
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStart { index, block },
            parent_tool_use_id: None,
        },
    )
}

pub fn stream_delta_event(
    session_id: &str,
    index: u32,
    delta: RuntimeContentDelta,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": Value::Null,
        "event": {
            "type": "content_block_delta",
            "index": index,
            "delta": runtime_delta_to_json(&delta),
        }
    });
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            raw,
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockDelta { index, delta },
            parent_tool_use_id: None,
        },
    )
}

pub fn stream_stop_event(session_id: &str, index: u32) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": Value::Null,
        "event": {
            "type": "content_block_stop",
            "index": index,
        }
    });
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            raw,
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStop { index },
            parent_tool_use_id: None,
        },
    )
}

pub fn result_event(session_id: &str, usage: Option<RuntimeUsage>) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage,
            raw: serde_json::json!({ "type": "result", "session_id": session_id }),
        },
        RuntimeEventKind::Result,
    )
}

pub fn init_event(session_id: &str, model: Option<String>) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            raw: serde_json::json!({
                "type": "system",
                "subtype": "init",
                "session_id": session_id,
                "model": model.clone(),
                "mcp_servers": [],
            }),
        },
        RuntimeEventKind::Init(RuntimeInitEvent {
            model,
            mcp_servers: Vec::new(),
        }),
    )
}

pub fn permission_request_event(request: &opencode_sdk_rs::PermissionRequest) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(request.session_id.clone()),
            usage: None,
            raw: serde_json::json!({
                "type": "opencode_permission_request",
                "session_id": request.session_id,
                "request_id": request.id,
                "tool_name": request.tool_name,
                "tool_input": request.tool_input,
                "description": request.description,
            }),
        },
        RuntimeEventKind::Other,
    )
}

pub fn question_request_event(question: &opencode_sdk_rs::Question) -> RuntimeEvent {
    let tool_input = build_question_tool_input(question);
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(question.session_id.clone()),
            usage: None,
            raw: serde_json::json!({
                "type": "opencode_permission_request",
                "session_id": question.session_id,
                "request_id": question.id,
                "tool_name": "AskUserQuestion",
                "tool_input": tool_input,
                "description": "OpenCode question",
            }),
        },
        RuntimeEventKind::Other,
    )
}

pub fn user_message_event(message: &opencode_sdk_rs::Message) -> RuntimeEvent {
    let content = message
        .parts
        .iter()
        .map(|part| match part {
            opencode_sdk_rs::MessagePart::ToolResult {
                tool_use_id,
                is_error,
                content,
                ..
            } => RuntimeUserContentBlock::ToolResult {
                tool_use_id: Some(tool_use_id.clone()),
                is_error: *is_error,
                content: content.clone(),
            },
            _ => RuntimeUserContentBlock::Other,
        })
        .collect::<Vec<RuntimeUserContentBlock>>();
    let raw = serde_json::json!({
        "type": "user",
        "session_id": message.session_id,
        "parent_tool_use_id": Value::Null,
        "message": {
            "content": message.parts.iter().map(message_part_to_json).collect::<Vec<Value>>(),
        }
    });
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(message.session_id.clone()),
            usage: None,
            raw,
        },
        RuntimeEventKind::UserMessage {
            message: RuntimeUserMessage { content },
            parent_tool_use_id: None,
        },
    )
}

fn runtime_usage_from_tokens(tokens: Option<&opencode_sdk_rs::TokenUsage>) -> Option<RuntimeUsage> {
    tokens.map(|tokens| RuntimeUsage {
        input_tokens: tokens.total_input(),
        output_tokens: tokens.output,
    })
}

pub fn message_part_to_runtime_block(part: &opencode_sdk_rs::MessagePart) -> RuntimeContentBlock {
    match part {
        opencode_sdk_rs::MessagePart::Text { text, .. } => {
            RuntimeContentBlock::Text { text: text.clone() }
        }
        opencode_sdk_rs::MessagePart::Thinking { thinking, .. } => RuntimeContentBlock::Thinking {
            thinking: thinking.clone(),
        },
        opencode_sdk_rs::MessagePart::ToolUse {
            id, name, input, ..
        } => RuntimeContentBlock::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
        },
        _ => RuntimeContentBlock::Other,
    }
}

fn runtime_content_block_to_json(block: &RuntimeContentBlock) -> Value {
    match block {
        RuntimeContentBlock::Text { text } => serde_json::json!({ "type": "text", "text": text }),
        RuntimeContentBlock::Thinking { thinking } => {
            serde_json::json!({ "type": "thinking", "thinking": thinking })
        }
        RuntimeContentBlock::ToolUse { id, name, input } => {
            serde_json::json!({ "type": "tool_use", "id": id, "name": name, "input": input })
        }
        RuntimeContentBlock::Other => serde_json::json!({ "type": "unknown" }),
    }
}

fn runtime_delta_to_json(delta: &RuntimeContentDelta) -> Value {
    match delta {
        RuntimeContentDelta::Text { text } => {
            serde_json::json!({ "type": "text_delta", "text": text })
        }
        RuntimeContentDelta::Thinking { thinking } => {
            serde_json::json!({ "type": "thinking_delta", "thinking": thinking })
        }
        RuntimeContentDelta::InputJson { partial_json } => {
            serde_json::json!({ "type": "input_json_delta", "partial_json": partial_json })
        }
    }
}

fn message_part_to_json(part: &opencode_sdk_rs::MessagePart) -> Value {
    match part {
        opencode_sdk_rs::MessagePart::Text { id, text } => {
            serde_json::json!({ "type": "text", "id": id, "text": text })
        }
        opencode_sdk_rs::MessagePart::Thinking { id, thinking } => {
            serde_json::json!({ "type": "thinking", "id": id, "thinking": thinking })
        }
        opencode_sdk_rs::MessagePart::ToolUse {
            id, name, input, ..
        } => {
            serde_json::json!({ "type": "tool_use", "id": id, "name": name, "input": input })
        }
        opencode_sdk_rs::MessagePart::ToolResult {
            id,
            tool_use_id,
            is_error,
            content,
        } => {
            serde_json::json!({
                "type": "tool_result",
                "id": id,
                "tool_use_id": tool_use_id,
                "is_error": is_error,
                "content": content,
            })
        }
        opencode_sdk_rs::MessagePart::Other(raw) => raw.clone(),
    }
}
