use super::SyntheticRowFields;
use crate::domain::sessions::models::AgentMessageRow;

pub(crate) fn should_hydrate_opencode_tool_calls(messages: &[AgentMessageRow]) -> bool {
    messages.iter().any(|message| {
        message.message_type == "tool_call"
            && parse_pending_placeholder(&message.content).unwrap_or(false)
    })
}

pub(super) fn synthetic_row_from_part(
    message: &opencode_sdk_rs::Message,
    part: &opencode_sdk_rs::MessagePart,
) -> Option<SyntheticRowFields> {
    let model = message.model.clone();
    match part {
        opencode_sdk_rs::MessagePart::Text { text, .. } => Some(SyntheticRowFields {
            message_type: "text".to_string(),
            content: text.clone(),
            tool_name: None,
            tool_use_id: None,
            model,
        }),
        opencode_sdk_rs::MessagePart::Thinking { thinking, .. } => Some(SyntheticRowFields {
            message_type: "thinking".to_string(),
            content: thinking.clone(),
            tool_name: None,
            tool_use_id: None,
            model: None,
        }),
        opencode_sdk_rs::MessagePart::ToolUse {
            id, name, input, ..
        } => Some(SyntheticRowFields {
            message_type: "tool_call".to_string(),
            content: serde_json::to_string(input).unwrap_or_default(),
            tool_name: Some(name.clone()),
            tool_use_id: Some(id.clone()),
            model: None,
        }),
        opencode_sdk_rs::MessagePart::ToolResult {
            tool_use_id,
            is_error,
            content,
            ..
        } => Some(SyntheticRowFields {
            message_type: if *is_error {
                "tool_error".to_string()
            } else {
                "tool_result".to_string()
            },
            content: serialize_tool_result_content(content),
            tool_name: None,
            tool_use_id: Some(tool_use_id.clone()),
            model: None,
        }),
        opencode_sdk_rs::MessagePart::StepFinish { .. }
        | opencode_sdk_rs::MessagePart::Other(_) => None,
    }
}

pub(super) fn parse_pending_placeholder(content: &str) -> Option<bool> {
    let parsed = serde_json::from_str::<serde_json::Value>(content).ok()?;
    let object = parsed.as_object()?;
    let status = object.get("status")?.as_str()?;
    Some(object.len() == 1 && status == "pending")
}

fn serialize_tool_result_content(content: &serde_json::Value) -> String {
    content
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| serde_json::to_string(content).unwrap_or_default())
}
