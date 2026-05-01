use serde_json::Value;

use super::event_items::{stream_start_event, tool_result_event_with_error};
use super::event_json::thread_id;
use super::event_state::IndexState;
use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEvent};

pub(super) fn raw_response_item_events(
    params: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = params.get("item") else {
        return Vec::new();
    };
    match item.get("type").and_then(Value::as_str) {
        Some("function_call") => tool_call_event(
            &params,
            item,
            function_tool_name(item),
            args(item, "arguments"),
            index_state,
        ),
        Some("custom_tool_call") => tool_call_event(
            &params,
            item,
            canonical_tool_name(&string_field(item, "name", "CustomTool")),
            args(item, "input"),
            index_state,
        ),
        Some("tool_search_call") => tool_call_event(
            &params,
            item,
            "ToolSearch".to_string(),
            tool_search_input(item),
            index_state,
        ),
        Some("web_search_call") => tool_call_event(
            &params,
            item,
            "WebSearch".to_string(),
            web_search_input(item),
            index_state,
        ),
        Some("function_call_output" | "custom_tool_call_output" | "tool_search_output") => {
            tool_result_event(&params, item, index_state)
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}

fn tool_call_event(
    params: &Value,
    item: &Value,
    name: String,
    input: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let id = response_item_id(params, item, name.as_str());
    if index_state.has_index(&id) {
        return Vec::new();
    }
    if let Some(alias) = item.get("id").and_then(Value::as_str) {
        if index_state.has_index(alias) {
            let index = index_state.index_for(alias);
            let canonical_id = index_state.canonical_id(alias);
            index_state.alias_index(&id, &canonical_id, index);
            return Vec::new();
        }
    }
    let sid = thread_id(params).to_string();
    let index = index_state.index_for(&id);
    if let Some(alias) = item.get("id").and_then(Value::as_str) {
        index_state.alias_index(alias, &id, index);
    }
    let block = RuntimeContentBlock::ToolUse { id, name, input };
    vec![stream_start_event(&sid, index, block)]
}

fn tool_result_event(
    params: &Value,
    item: &Value,
    index_state: &mut IndexState,
) -> Option<RuntimeEvent> {
    let raw_id = item.get("call_id").and_then(Value::as_str)?;
    let id = index_state.canonical_id(raw_id);
    if !index_state.record_result(raw_id) {
        return None;
    }
    let content = item.get("output").cloned().unwrap_or(Value::Null);
    let is_error = item.get("status").and_then(Value::as_str) == Some("failed");
    Some(tool_result_event_with_error(params, id, content, is_error))
}

fn function_tool_name(item: &Value) -> String {
    let raw_name = string_field(item, "name", "function_call");
    let canonical = canonical_tool_name(&raw_name);
    if canonical != raw_name {
        return canonical;
    }
    match item.get("namespace").and_then(Value::as_str) {
        Some(namespace) if !namespace.is_empty() => format!("{namespace}__{raw_name}"),
        _ => raw_name,
    }
}

fn canonical_tool_name(name: &str) -> String {
    match name {
        "read" | "read_file" | "fs_read" | "fs_read_file" => "Read".to_string(),
        "glob" | "file_glob" | "find_files" => "Glob".to_string(),
        "grep" | "search" | "search_files" | "code_search" => "Grep".to_string(),
        "bash" | "shell" | "exec" | "exec_command" => "Bash".to_string(),
        "web_search" | "web_search_preview" => "WebSearch".to_string(),
        "tool_search" => "ToolSearch".to_string(),
        _ => name.to_string(),
    }
}

fn args(item: &Value, field: &str) -> Value {
    match item.get(field) {
        Some(Value::String(raw)) if raw.trim().is_empty() => serde_json::json!({}),
        Some(Value::String(raw)) => {
            serde_json::from_str::<Value>(raw).unwrap_or_else(|_| serde_json::json!({ field: raw }))
        }
        Some(value) => value.clone(),
        None => serde_json::json!({}),
    }
}

fn tool_search_input(item: &Value) -> Value {
    let mut input = object_field(item, "arguments");
    input.insert(
        "execution".to_string(),
        item.get("execution").cloned().unwrap_or(Value::Null),
    );
    if let Some(status) = item.get("status").cloned() {
        input.insert("status".to_string(), status);
    }
    Value::Object(input)
}

fn web_search_input(item: &Value) -> Value {
    let mut input = serde_json::Map::new();
    if let Some(action) = item.get("action") {
        if let Some(query) = action.get("query").and_then(Value::as_str) {
            input.insert("query".to_string(), Value::String(query.to_string()));
        }
        if let Some(url) = action.get("url").and_then(Value::as_str) {
            input.insert("url".to_string(), Value::String(url.to_string()));
        }
        input.insert("action".to_string(), action.clone());
    }
    if let Some(status) = item.get("status").cloned() {
        input.insert("status".to_string(), status);
    }
    Value::Object(input)
}

fn object_field(item: &Value, field: &str) -> serde_json::Map<String, Value> {
    item.get(field)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn response_item_id(params: &Value, item: &Value, fallback_name: &str) -> String {
    item.get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            let turn_id = params
                .get("turnId")
                .and_then(Value::as_str)
                .unwrap_or_else(|| thread_id(params));
            format!("codex_raw_{turn_id}_{fallback_name}")
        })
}

fn string_field(item: &Value, field: &str, fallback: &str) -> String {
    item.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::raw_response_item_events;
    use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeStreamEvent};
    use crate::domain::agents::codex::event_state::IndexState;

    #[test]
    fn maps_raw_read_function_call_to_visible_tool_use() {
        let mut indexes = IndexState::default();
        let events = raw_response_item_events(
            json!({
                "threadId": "thread",
                "turnId": "turn",
                "item": {
                    "type": "function_call",
                    "call_id": "call_read",
                    "name": "read_file",
                    "arguments": "{\"file_path\":\"src/main.rs\"}"
                }
            }),
            &mut indexes,
        );

        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event()
        else {
            panic!("expected tool start");
        };
        let RuntimeContentBlock::ToolUse { id, name, input } = block else {
            panic!("expected tool use");
        };
        assert_eq!(id, "call_read");
        assert_eq!(name, "Read");
        assert_eq!(input["file_path"], json!("src/main.rs"));
    }

    #[test]
    fn dedupes_raw_tool_call_when_index_already_exists() {
        let mut indexes = IndexState::default();
        indexes.index_for("call_grep");
        let events = raw_response_item_events(
            json!({
                "threadId": "thread",
                "item": {
                    "type": "function_call",
                    "call_id": "call_grep",
                    "name": "grep",
                    "arguments": "{\"pattern\":\"foo\"}"
                }
            }),
            &mut indexes,
        );

        assert!(events.is_empty());
    }

    #[test]
    fn aliases_response_item_id_to_call_id_for_later_dedupe() {
        let mut indexes = IndexState::default();
        let events = raw_response_item_events(
            json!({
                "threadId": "thread",
                "item": {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_read",
                    "name": "read",
                    "arguments": "{\"file_path\":\"src/lib.rs\"}"
                }
            }),
            &mut indexes,
        );
        assert_eq!(events.len(), 1);
        assert!(indexes.has_index("fc_1"));

        let output_events = raw_response_item_events(
            json!({
                "threadId": "thread",
                "item": {
                    "type": "function_call_output",
                    "call_id": "call_read",
                    "output": "ok"
                }
            }),
            &mut indexes,
        );
        assert_eq!(output_events.len(), 1);

        let duplicate_output_events = raw_response_item_events(
            json!({
                "threadId": "thread",
                "item": {
                    "type": "function_call_output",
                    "call_id": "call_read",
                    "output": "ok"
                }
            }),
            &mut indexes,
        );
        assert!(duplicate_output_events.is_empty());
    }

    #[test]
    fn maps_raw_custom_tool_call_input_as_json_when_possible() {
        let mut indexes = IndexState::default();
        let events = raw_response_item_events(
            json!({
                "threadId": "thread",
                "item": {
                    "type": "custom_tool_call",
                    "call_id": "call_glob",
                    "name": "glob",
                    "input": "{\"pattern\":\"**/*.rs\"}"
                }
            }),
            &mut indexes,
        );

        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event()
        else {
            panic!("expected tool start");
        };
        let RuntimeContentBlock::ToolUse { name, input, .. } = block else {
            panic!("expected tool use");
        };
        assert_eq!(name, "Glob");
        assert_eq!(input["pattern"], json!("**/*.rs"));
    }
}
