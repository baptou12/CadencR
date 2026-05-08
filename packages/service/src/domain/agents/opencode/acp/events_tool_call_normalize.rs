//! Pure helpers that translate ACP-flavoured tool-call payloads to the
//! shape Cadencr's frontend renderers expect. Split out of
//! `events_tool_call.rs` so each module stays under the 400-line ceiling.

use serde_json::{json, Value};

/// Rename ACP-flavoured edit-tool keys to the canonical Anthropic-style
/// keys the Cadencr frontend's diff renderer expects. Operates only on
/// known edit tool names so other tool inputs pass through unchanged.
pub(super) fn normalize_edit_input(tool_name: &str, mut input: Value) -> Value {
    if !matches!(tool_name, "Edit" | "MultiEdit" | "Write") {
        return input;
    }
    let Some(map) = input.as_object_mut() else {
        return input;
    };
    rename_key(map, "oldText", "old_string");
    rename_key(map, "newText", "new_string");
    rename_key(map, "filePath", "file_path");
    if !map.contains_key("file_path") {
        if let Some(path) = map.remove("path") {
            map.insert("file_path".to_string(), path);
        }
    }
    input
}

fn rename_key(map: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    if map.contains_key(to) {
        return;
    }
    if let Some(value) = map.remove(from) {
        map.insert(to.to_string(), value);
    }
}

/// Reduce ACP `ToolCallContent[]` to a shape the Cadencr frontend can
/// render directly:
/// - All text-bearing blocks → joined string (BashBlock, TaskAgentBlock,
///   generic text results all expect a plain string).
/// - Otherwise, pass the array through unchanged so structured variants
///   (`diff`, `terminal`, `image`, …) reach the frontend untouched.
///
/// OpenCode wraps text in a `{type:"content", content:{type:"text", text}}`
/// envelope rather than the bare `{type:"text", text}` ACP defines, so we
/// unwrap recursively before deciding whether the array is text-only.
pub(super) fn flatten_tool_result_content(content: &[Value]) -> Value {
    let texts: Option<Vec<String>> = content.iter().map(unwrap_text_block).collect();
    if let Some(texts) = texts {
        if !texts.is_empty() {
            return Value::String(texts.join("\n"));
        }
    }
    json!(content)
}

/// Pull a plain text payload out of a single ACP content block. Returns
/// `None` for non-text variants (diff, terminal, image, …) so the caller
/// can fall back to passing the array through unchanged.
fn unwrap_text_block(block: &Value) -> Option<String> {
    let kind = block.get("type").and_then(Value::as_str)?;
    match kind {
        "text" => block
            .get("text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        // OpenCode's `{type:"content", content: {...}}` envelope. The inner
        // `content` is itself a content block; recurse to unwrap it.
        "content" => block
            .get("content")
            .and_then(|inner| unwrap_text_block(inner)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{flatten_tool_result_content, normalize_edit_input};
    use serde_json::{json, Value};

    #[test]
    fn normalize_rewrites_acp_edit_keys() {
        let normalized = normalize_edit_input(
            "Edit",
            json!({ "path": "/x", "oldText": "a", "newText": "b" }),
        );
        assert_eq!(normalized["file_path"], "/x");
        assert_eq!(normalized["old_string"], "a");
        assert_eq!(normalized["new_string"], "b");
        assert!(normalized.get("path").is_none());
        assert!(normalized.get("oldText").is_none());
        assert!(normalized.get("newText").is_none());
    }

    #[test]
    fn normalize_leaves_existing_canonical_keys_untouched() {
        let normalized = normalize_edit_input(
            "Edit",
            json!({ "file_path": "/x", "old_string": "a", "new_string": "b" }),
        );
        assert_eq!(normalized["file_path"], "/x");
        assert_eq!(normalized["old_string"], "a");
        assert_eq!(normalized["new_string"], "b");
    }

    #[test]
    fn normalize_skips_non_edit_tools() {
        let raw = json!({ "path": "/x", "command": "ls" });
        let normalized = normalize_edit_input("Bash", raw.clone());
        assert_eq!(normalized, raw);
    }

    #[test]
    fn normalize_returns_non_object_inputs_unchanged() {
        let normalized = normalize_edit_input("Edit", Value::Null);
        assert!(normalized.is_null());
    }

    #[test]
    fn flatten_collapses_text_only_blocks_into_a_string() {
        let payload = flatten_tool_result_content(&[
            json!({ "type": "text", "text": "line one" }),
            json!({ "type": "text", "text": "line two" }),
        ]);
        assert_eq!(payload, json!("line one\nline two"));
    }

    #[test]
    fn flatten_passes_structured_blocks_through() {
        let blocks = vec![json!({ "type": "diff", "path": "/x", "newText": "x" })];
        let payload = flatten_tool_result_content(&blocks);
        assert!(payload.is_array());
        assert_eq!(payload[0]["type"], "diff");
    }

    #[test]
    fn flatten_returns_empty_array_for_empty_input() {
        let payload = flatten_tool_result_content(&[]);
        assert!(payload.is_array());
        assert_eq!(payload.as_array().unwrap().len(), 0);
    }

    #[test]
    fn flatten_unwraps_opencode_content_envelope() {
        // OpenCode emits `{type:"content", content:{type:"text", text:"..."}}`
        // instead of the bare `{type:"text"}` ACP defines. Without the
        // unwrap, the FE sees a JSON-stringified array instead of plain
        // BashBlock output.
        let payload = flatten_tool_result_content(&[json!({
            "type": "content",
            "content": { "type": "text", "text": "(no output)" }
        })]);
        assert_eq!(payload, json!("(no output)"));
    }

    #[test]
    fn flatten_handles_mixed_envelope_and_bare_text() {
        let payload = flatten_tool_result_content(&[
            json!({ "type": "content", "content": { "type": "text", "text": "first" } }),
            json!({ "type": "text", "text": "second" }),
        ]);
        assert_eq!(payload, json!("first\nsecond"));
    }
}
