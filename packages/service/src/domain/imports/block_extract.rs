//! Helpers that turn one JSONL `user` / `assistant` envelope into a flat
//! list of provider-neutral [`ImportedMessage`] rows. Kept separate from
//! `claude_code_jsonl` so the parser file stays under the project's
//! file-length cap; behavioral coverage lives next to `parse_session_file`.

use super::claude_code_jsonl::ImportedMessage;

pub(super) fn extract_user_messages(
    value: &serde_json::Value,
    timestamp: Option<&str>,
    messages: &mut Vec<ImportedMessage>,
    first_user_text: &mut Option<String>,
) {
    let Some(msg) = value.get("message") else {
        return;
    };
    match msg.get("content") {
        Some(serde_json::Value::String(text)) => {
            if first_user_text.is_none() && !text.trim().is_empty() {
                *first_user_text = Some(text.clone());
            }
            messages.push(ImportedMessage {
                role: "user".into(),
                content: text.clone(),
                message_type: "text".into(),
                tool_name: None,
                tool_use_id: None,
                model: None,
                created_at: timestamp.map(String::from),
            });
        }
        Some(serde_json::Value::Array(blocks)) => {
            for block in blocks {
                push_user_block(block, timestamp, messages);
            }
        }
        _ => {}
    }
}

fn push_user_block(
    block: &serde_json::Value,
    timestamp: Option<&str>,
    messages: &mut Vec<ImportedMessage>,
) {
    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if block_type != "tool_result" {
        return;
    }
    let tool_use_id = block
        .get("tool_use_id")
        .and_then(|v| v.as_str())
        .map(String::from);
    let is_error = block
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let content = match block.get("content") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
        None => String::new(),
    };
    messages.push(ImportedMessage {
        role: "tool".into(),
        content,
        message_type: if is_error {
            "tool_error"
        } else {
            "tool_result"
        }
        .into(),
        tool_name: None,
        tool_use_id,
        model: None,
        created_at: timestamp.map(String::from),
    });
}

pub(super) fn extract_assistant_messages(
    value: &serde_json::Value,
    timestamp: Option<&str>,
    messages: &mut Vec<ImportedMessage>,
) {
    let Some(msg) = value.get("message") else {
        return;
    };
    let model = msg.get("model").and_then(|v| v.as_str()).map(String::from);
    let Some(blocks) = msg.get("content").and_then(|v| v.as_array()) else {
        return;
    };
    for block in blocks {
        push_assistant_block(block, model.as_deref(), timestamp, messages);
    }
}

fn push_assistant_block(
    block: &serde_json::Value,
    model: Option<&str>,
    timestamp: Option<&str>,
    messages: &mut Vec<ImportedMessage>,
) {
    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match block_type {
        "text" => push_assistant_text(block, "text", "text", model, timestamp, messages),
        "thinking" => {
            push_assistant_text(block, "thinking", "thinking", model, timestamp, messages)
        }
        "tool_use" => push_assistant_tool_use(block, model, timestamp, messages),
        _ => {}
    }
}

fn push_assistant_text(
    block: &serde_json::Value,
    text_field: &str,
    message_type: &str,
    model: Option<&str>,
    timestamp: Option<&str>,
    messages: &mut Vec<ImportedMessage>,
) {
    let text = block
        .get(text_field)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    messages.push(ImportedMessage {
        role: "assistant".into(),
        content: text,
        message_type: message_type.into(),
        tool_name: None,
        tool_use_id: None,
        model: model.map(String::from),
        created_at: timestamp.map(String::from),
    });
}

fn push_assistant_tool_use(
    block: &serde_json::Value,
    model: Option<&str>,
    timestamp: Option<&str>,
    messages: &mut Vec<ImportedMessage>,
) {
    let tool_name = block.get("name").and_then(|v| v.as_str()).map(String::from);
    let tool_use_id = block.get("id").and_then(|v| v.as_str()).map(String::from);
    let input = block
        .get("input")
        .map(|v| serde_json::to_string(v).unwrap_or_default())
        .unwrap_or_default();
    messages.push(ImportedMessage {
        role: "assistant".into(),
        content: input,
        message_type: "tool_call".into(),
        tool_name,
        tool_use_id,
        model: model.map(String::from),
        created_at: timestamp.map(String::from),
    });
}
