use serde_json::json;

use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
    RuntimeStreamEvent, RuntimeUsage,
};

pub(super) fn summary_stream_events(message: &opencode_sdk_rs::Message) -> Vec<RuntimeEvent> {
    let mut events = vec![RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(message.session_id.clone()),
            usage: usage_from_message(message),
            context_window: None,
            raw: json!({
                "type": "stream_event",
                "session_id": message.session_id,
                "parent_tool_use_id": serde_json::Value::Null,
                "event": {
                    "type": "message_start",
                    "message": { "model": message.model.clone() },
                },
            }),
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::MessageStart {
                model: message.model.clone(),
                input_tokens: None,
            },
            parent_tool_use_id: None,
        },
    )];
    let mut index = 0;
    for part in &message.parts {
        let Some((block, delta, raw_block, raw_delta)) = summary_part_events(part) else {
            continue;
        };
        events.push(summary_block_start(
            &message.session_id,
            index,
            block,
            raw_block,
        ));
        events.push(summary_block_delta(
            &message.session_id,
            index,
            delta,
            raw_delta,
        ));
        events.push(summary_block_stop(&message.session_id, index));
        index += 1;
    }
    events
}

fn usage_from_message(message: &opencode_sdk_rs::Message) -> Option<RuntimeUsage> {
    message.tokens.as_ref().map(|tokens| RuntimeUsage {
        input_tokens: tokens.total_input(),
        output_tokens: tokens.output,
    })
}

fn summary_part_events(
    part: &opencode_sdk_rs::MessagePart,
) -> Option<(
    RuntimeContentBlock,
    RuntimeContentDelta,
    serde_json::Value,
    serde_json::Value,
)> {
    match part {
        opencode_sdk_rs::MessagePart::Text { text, .. } => Some((
            RuntimeContentBlock::Text {
                text: String::new(),
            },
            RuntimeContentDelta::Text { text: text.clone() },
            json!({ "type": "text", "text": "" }),
            json!({ "type": "text_delta", "text": text }),
        )),
        opencode_sdk_rs::MessagePart::Thinking { thinking, .. } => Some((
            RuntimeContentBlock::Thinking {
                thinking: String::new(),
            },
            RuntimeContentDelta::Thinking {
                thinking: thinking.clone(),
            },
            json!({ "type": "thinking", "thinking": "" }),
            json!({ "type": "thinking_delta", "thinking": thinking }),
        )),
        _ => None,
    }
}

fn summary_block_start(
    session_id: &str,
    index: u32,
    block: RuntimeContentBlock,
    raw_block: serde_json::Value,
) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            context_window: None,
            raw: json!({
                "type": "stream_event",
                "session_id": session_id,
                "parent_tool_use_id": serde_json::Value::Null,
                "event": {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": raw_block,
                },
            }),
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStart {
                index: u64::from(index),
                block,
            },
            parent_tool_use_id: None,
        },
    )
}

fn summary_block_delta(
    session_id: &str,
    index: u32,
    delta: RuntimeContentDelta,
    raw_delta: serde_json::Value,
) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            context_window: None,
            raw: json!({
                "type": "stream_event",
                "session_id": session_id,
                "parent_tool_use_id": serde_json::Value::Null,
                "event": {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": raw_delta,
                },
            }),
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockDelta {
                index: u64::from(index),
                delta,
            },
            parent_tool_use_id: None,
        },
    )
}

fn summary_block_stop(session_id: &str, index: u32) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.to_string()),
            usage: None,
            context_window: None,
            raw: json!({
                "type": "stream_event",
                "session_id": session_id,
                "parent_tool_use_id": serde_json::Value::Null,
                "event": { "type": "content_block_stop", "index": index },
            }),
        },
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStop {
                index: u64::from(index),
            },
            parent_tool_use_id: None,
        },
    )
}
