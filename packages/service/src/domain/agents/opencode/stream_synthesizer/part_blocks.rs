use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeContentDelta};

#[derive(Clone)]
pub(super) enum PartBlock {
    Text,
    Thinking,
    ToolUse { id: String, name: String },
}

pub(super) fn part_block_from_message_part(part: &opencode_sdk_rs::MessagePart) -> PartBlock {
    match part {
        opencode_sdk_rs::MessagePart::Text { .. } => PartBlock::Text,
        opencode_sdk_rs::MessagePart::Thinking { .. } => PartBlock::Thinking,
        opencode_sdk_rs::MessagePart::ToolUse { id, name, .. } => PartBlock::ToolUse {
            id: id.clone(),
            name: crate::domain::agents::opencode::tool_names::canonical_cadencr_tool_name(name),
        },
        _ => PartBlock::Text,
    }
}

pub(super) fn runtime_block_from_part_block(part_block: &PartBlock) -> RuntimeContentBlock {
    match part_block {
        PartBlock::Text => RuntimeContentBlock::Text {
            text: String::new(),
        },
        PartBlock::Thinking => RuntimeContentBlock::Thinking {
            thinking: String::new(),
        },
        PartBlock::ToolUse { id, name } => RuntimeContentBlock::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input: serde_json::json!({}),
        },
    }
}

pub(super) fn empty_runtime_block_for_part(
    part: &opencode_sdk_rs::MessagePart,
) -> RuntimeContentBlock {
    runtime_block_from_part_block(&part_block_from_message_part(part))
}

pub(super) fn infer_part_block(field: &str, part_id: &str) -> Option<PartBlock> {
    if matches_text_field(field) {
        return Some(PartBlock::Text);
    }
    if matches_thinking_field(field) {
        return Some(PartBlock::Thinking);
    }
    if matches_input_field(field) {
        return Some(PartBlock::ToolUse {
            id: part_id.to_string(),
            name: "unknown".to_string(),
        });
    }
    None
}

pub(super) fn delta_from_field(
    field: &str,
    delta: &str,
    part_block: Option<&PartBlock>,
) -> Option<RuntimeContentDelta> {
    match part_block {
        Some(PartBlock::Thinking) => {
            return Some(RuntimeContentDelta::Thinking {
                thinking: delta.to_string(),
            });
        }
        Some(PartBlock::ToolUse { .. }) if matches_input_field(field) => {
            return Some(RuntimeContentDelta::InputJson {
                partial_json: delta.to_string(),
            });
        }
        Some(PartBlock::Text) if matches_text_field(field) => {
            return Some(RuntimeContentDelta::Text {
                text: delta.to_string(),
            });
        }
        _ => {}
    }
    if matches_text_field(field) {
        return Some(RuntimeContentDelta::Text {
            text: delta.to_string(),
        });
    }
    if matches_thinking_field(field) {
        return Some(RuntimeContentDelta::Thinking {
            thinking: delta.to_string(),
        });
    }
    if matches_input_field(field) {
        return Some(RuntimeContentDelta::InputJson {
            partial_json: delta.to_string(),
        });
    }
    None
}

pub(super) fn delta_is_empty(delta: &RuntimeContentDelta) -> bool {
    match delta {
        RuntimeContentDelta::Text { text } => text.is_empty(),
        RuntimeContentDelta::Thinking { thinking } => thinking.is_empty(),
        RuntimeContentDelta::InputJson { partial_json } => partial_json.is_empty(),
    }
}

fn matches_text_field(field: &str) -> bool {
    matches!(field, "text" | "content")
}

fn matches_thinking_field(field: &str) -> bool {
    field.starts_with("reasoning")
}

fn matches_input_field(field: &str) -> bool {
    field.contains("input")
}
