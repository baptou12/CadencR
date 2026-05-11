//! Synthesise `ContentBlockDelta::InputJson` events for ACP
//! `tool_call_update` payloads.
//!
//! ACP's `tool_call` start typically carries an empty `toolInput`; the
//! actual file_path / content / command arrives later inside a
//! `tool_call_update`. The Cadencr FE only renders inline diffs (Write /
//! Edit) and command bubbles (Bash) when the tool block has populated
//! `toolArgs`, so this module derives an input JSON from the update body
//! and emits a single `input_json_delta` the FE can merge into the
//! existing tool block.

use serde_json::{json, Value};

use crate::domain::agents::adapter::{RuntimeContentDelta, RuntimeEvent, RuntimeEventMetadata};
use crate::domain::agents::opencode::events::stream_delta_event as http_stream_delta_event;

use super::events_stream_blocks::EventIndexer;
use super::provider_hooks::AcpProviderHooks;

/// Tools whose toolArgs the FE renders as a structured block — file diffs,
/// command bubbles, sub-agent panels. Anything else falls under the generic
/// ToolCallBlock so we can skip the input-delta synthesis for them.
pub(super) fn is_structured_input_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Write"
            | "Edit"
            | "MultiEdit"
            | "NotebookEdit"
            | "ApplyPatch"
            | "Bash"
            | "Task"
            | "Agent"
            | "TodoWrite"
    )
}

/// Build a `ContentBlockDelta::InputJson` for an ACP `tool_call_update`
/// if it carries fresh tool input. Returns `None` for tool kinds whose
/// FE renderer doesn't depend on toolArgs.
pub(super) fn synthesize_input_delta_event(
    tool_call_id: &str,
    index: u64,
    body: &Value,
    parent_tool_use_id: Option<String>,
    indexer: &EventIndexer,
    metadata: RuntimeEventMetadata,
    hooks: &dyn AcpProviderHooks,
) -> Option<RuntimeEvent> {
    let tool_name = indexer.tool_name_for(tool_call_id)?.to_string();
    if !is_structured_input_tool(&tool_name) {
        return None;
    }
    // Per the official ACP schema (`ToolCall.rawInput`), `rawInput` is the
    // spec-canonical opaque agent input. `toolInput` is a legacy non-spec
    // field some adapters (and our terminal enrichment) write into for
    // back-compat — only fall back to it when `rawInput` is empty/missing.
    let raw_input = body
        .get("rawInput")
        .filter(|v| !is_empty_value(v))
        .or_else(|| body.get("toolInput"))
        .cloned();
    let derived_input = match raw_input {
        Some(value) if !is_empty_value(&value) => value,
        _ => derive_input_from_content(&tool_name, body)?,
    };
    let normalized = hooks.normalize_tool_input(&tool_name, derived_input);
    let partial_json = serde_json::to_string(&normalized).ok()?;
    // Build the event via the shared Claude-shape helper so the WS bridge
    // ships an `input_json_delta` envelope the FE can merge into the
    // existing tool block. See events_tool_call.rs for the rationale.
    let event = http_stream_delta_event(
        metadata.session_id.as_deref().unwrap_or(""),
        index,
        RuntimeContentDelta::InputJson { partial_json },
        parent_tool_use_id.as_deref(),
    );
    Some(event)
}

/// Treat `null`, `{}`, and `[]` as "no input present". Used by both the
/// `tool_call` start path and the update path to decide whether to fall
/// back to a legacy field or content-derived synthesis.
pub(super) fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Object(map) => map.is_empty(),
        Value::Array(arr) => arr.is_empty(),
        _ => false,
    }
}

/// Walk the ACP `content[]` array and synthesise a canonical tool input.
///
/// Two shapes are supported:
///
/// - **Diff content** (Edit/Write/MultiEdit/ApplyPatch). Used when the agent
///   sends the actual file payload only inside the update's content rather
///   than a top-level `rawInput`.
///   - `Write`: stop at the first diff → `{file_path, content}`.
///   - `Edit` / `ApplyPatch`: stop at the first diff →
///     `{file_path, old_string, new_string}`.
///   - `MultiEdit`: walk every diff and emit
///     `{file_path, edits: [{old_string, new_string}, …]}`. The first diff's
///     path is canonical (ACP MultiEdit groups edits per file).
///
/// - **Sub-agent prompt content** (Task/Agent). Defensive fallback for
///   adapters that deliver `{description, prompt}` only via `content[]`
///   instead of `rawInput`. The current OpenCode wire delivers these via
///   `rawInput`, but the spec § 6 flagged content-only as a possible
///   variant — this keeps the sub-agent panel header populated either way.
pub(super) fn derive_input_from_content(tool_name: &str, body: &Value) -> Option<Value> {
    if matches!(tool_name, "Task" | "Agent") {
        return derive_subagent_input_from_content(body);
    }
    if !matches!(tool_name, "Write" | "Edit" | "MultiEdit" | "ApplyPatch") {
        return None;
    }
    let content = body.get("content").and_then(Value::as_array)?;
    let diffs: Vec<DiffEntry> = content.iter().filter_map(extract_diff_entry).collect();
    if diffs.is_empty() {
        return None;
    }
    if tool_name == "MultiEdit" {
        let file_path = diffs[0].path.clone();
        let edits: Vec<Value> = diffs
            .into_iter()
            .map(|d| {
                json!({
                    "old_string": d.old_text,
                    "new_string": d.new_text,
                })
            })
            .collect();
        return Some(json!({
            "file_path": file_path,
            "edits": edits,
        }));
    }
    let first = diffs.into_iter().next()?;
    if tool_name == "Write" {
        return Some(json!({
            "file_path": first.path,
            "content": first.new_text,
        }));
    }
    Some(json!({
        "file_path": first.path,
        "old_string": first.old_text,
        "new_string": first.new_text,
    }))
}

/// Pull `{description, prompt}` out of a Task/Agent `content[]` entry.
/// Recognised shapes:
///
/// - `content[i]` is an object with `description` / `prompt` string fields.
/// - `content[i]` is `{type: "text", text: "..."}` — treat the text as the
///   prompt and synthesise a description from the first non-empty line.
/// - `content[i]` is `{type: "content", content: {...}}` — recurse into the
///   inner block (matches OpenCode's text-envelope wrapping).
fn derive_subagent_input_from_content(body: &Value) -> Option<Value> {
    let content = body.get("content").and_then(Value::as_array)?;
    for entry in content {
        if let Some(input) = subagent_input_from_entry(entry) {
            return Some(input);
        }
    }
    None
}

fn subagent_input_from_entry(entry: &Value) -> Option<Value> {
    if let (Some(description), Some(prompt)) = (
        entry.get("description").and_then(Value::as_str),
        entry.get("prompt").and_then(Value::as_str),
    ) {
        return Some(json!({
            "description": description,
            "prompt": prompt,
        }));
    }
    let kind = entry.get("type").and_then(Value::as_str)?;
    match kind {
        "text" => entry
            .get("text")
            .and_then(Value::as_str)
            .map(subagent_input_from_text),
        "content" => entry.get("content").and_then(subagent_input_from_entry),
        _ => None,
    }
}

fn subagent_input_from_text(text: &str) -> Value {
    let description = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Sub-agent")
        .to_string();
    json!({
        "description": description,
        "prompt": text,
    })
}

struct DiffEntry {
    path: String,
    old_text: String,
    new_text: String,
}

fn extract_diff_entry(entry: &Value) -> Option<DiffEntry> {
    if entry.get("type").and_then(Value::as_str) != Some("diff") {
        return None;
    }
    let path = entry
        .get("path")
        .or_else(|| entry.get("filePath"))
        .and_then(Value::as_str)?
        .to_string();
    let old_text = entry
        .get("oldText")
        .or_else(|| entry.get("old_string"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let new_text = entry
        .get("newText")
        .or_else(|| entry.get("new_string"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Some(DiffEntry {
        path,
        old_text,
        new_text,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        derive_input_from_content, is_empty_value, is_structured_input_tool,
        synthesize_input_delta_event,
    };
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::adapter::{
        RuntimeContentDelta, RuntimeEventMetadata, RuntimePermissionMode, RuntimeStreamEvent,
    };
    use serde_json::{json, Value};

    struct PlainHooks;
    #[async_trait::async_trait]
    impl AcpProviderHooks for PlainHooks {
        fn normalize_tool_name(&self, raw: &str) -> String {
            raw.to_string()
        }
        fn normalize_tool_input(&self, _: &str, input: Value) -> Value {
            input
        }
        fn flatten_tool_result_content(&self, blocks: &[Value]) -> Value {
            json!(blocks)
        }
        fn mode_for_permission_mode(&self, _: RuntimePermissionMode) -> Option<&'static str> {
            None
        }
    }

    #[test]
    fn is_structured_input_tool_recognises_diff_and_bash_tools() {
        assert!(is_structured_input_tool("Write"));
        assert!(is_structured_input_tool("Edit"));
        assert!(is_structured_input_tool("Bash"));
        assert!(!is_structured_input_tool("Read"));
    }

    #[test]
    fn is_structured_input_tool_recognises_subagent_tools() {
        assert!(is_structured_input_tool("Task"));
        assert!(is_structured_input_tool("Agent"));
    }

    #[test]
    fn is_structured_input_tool_recognises_todowrite() {
        assert!(is_structured_input_tool("TodoWrite"));
    }

    #[test]
    fn is_empty_value_treats_empty_objects_and_arrays_as_empty() {
        assert!(is_empty_value(&Value::Null));
        assert!(is_empty_value(&json!({})));
        assert!(is_empty_value(&json!([])));
        assert!(!is_empty_value(&json!({ "a": 1 })));
        assert!(!is_empty_value(&json!("text")));
    }

    #[test]
    fn derive_input_from_diff_content_synthesises_write_input() {
        let body = json!({
            "content": [
                { "type": "diff", "path": "/x/acp-test.txt", "oldText": "", "newText": "hello" }
            ]
        });
        let derived = derive_input_from_content("Write", &body).unwrap();
        assert_eq!(derived["file_path"], "/x/acp-test.txt");
        assert_eq!(derived["content"], "hello");
        assert!(derived.get("old_string").is_none());
    }

    #[test]
    fn derive_input_from_diff_content_synthesises_edit_input() {
        let body = json!({
            "content": [
                { "type": "diff", "path": "/x/file.txt", "oldText": "a", "newText": "b" }
            ]
        });
        let derived = derive_input_from_content("Edit", &body).unwrap();
        assert_eq!(derived["file_path"], "/x/file.txt");
        assert_eq!(derived["old_string"], "a");
        assert_eq!(derived["new_string"], "b");
    }

    #[test]
    fn derive_input_from_diff_content_collects_all_multi_edit_entries() {
        let body = json!({
            "content": [
                { "type": "diff", "path": "/x/file.txt", "oldText": "a", "newText": "b" },
                { "type": "diff", "path": "/x/file.txt", "oldText": "c", "newText": "d" },
            ]
        });
        let derived = derive_input_from_content("MultiEdit", &body).unwrap();
        assert_eq!(derived["file_path"], "/x/file.txt");
        let edits = derived["edits"].as_array().expect("edits array");
        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0]["old_string"], "a");
        assert_eq!(edits[0]["new_string"], "b");
        assert_eq!(edits[1]["old_string"], "c");
        assert_eq!(edits[1]["new_string"], "d");
    }

    #[test]
    fn derive_input_returns_none_for_non_file_tools() {
        let body = json!({
            "content": [
                { "type": "diff", "path": "/x", "newText": "x" }
            ]
        });
        assert!(derive_input_from_content("Bash", &body).is_none());
        assert!(derive_input_from_content("Read", &body).is_none());
    }

    #[test]
    fn derive_input_pulls_description_and_prompt_for_task() {
        // Defensive: some adapters may eventually deliver Task input via
        // `content[]` with explicit `{description, prompt}` keys instead of
        // `rawInput`. Surface them so the sub-agent panel header still
        // populates.
        let body = json!({
            "content": [
                { "description": "Explore backend", "prompt": "Look at packages/service" }
            ]
        });
        let derived = derive_input_from_content("Task", &body).expect("derived");
        assert_eq!(derived["description"], "Explore backend");
        assert_eq!(derived["prompt"], "Look at packages/service");
        // Same shape works for the alternate `Agent` tool name.
        let derived = derive_input_from_content("Agent", &body).expect("derived");
        assert_eq!(derived["description"], "Explore backend");
    }

    #[test]
    fn derive_input_synthesises_task_input_from_text_block() {
        // Plain text content: the first non-empty line becomes the
        // description and the full text becomes the prompt.
        let body = json!({
            "content": [
                { "type": "text", "text": "Explore backend\n\nDetails follow…" }
            ]
        });
        let derived = derive_input_from_content("Task", &body).expect("derived");
        assert_eq!(derived["description"], "Explore backend");
        assert_eq!(derived["prompt"], "Explore backend\n\nDetails follow…");
    }

    #[test]
    fn derive_input_unwraps_opencode_content_envelope_for_task() {
        // OpenCode wraps text in `{type:"content", content:{type:"text",…}}`.
        // The Task-content path mirrors `unwrap_text_block` and recurses.
        let body = json!({
            "content": [
                { "type": "content", "content": { "type": "text", "text": "Spawn explore" } }
            ]
        });
        let derived = derive_input_from_content("Task", &body).expect("derived");
        assert_eq!(derived["description"], "Spawn explore");
        assert_eq!(derived["prompt"], "Spawn explore");
    }

    #[test]
    fn derive_input_returns_none_for_task_with_diff_only_content() {
        // A Task whose content is unrelated diff entries should not synthesize
        // a bogus header.
        let body = json!({
            "content": [
                { "type": "diff", "path": "/x", "newText": "x" }
            ]
        });
        assert!(derive_input_from_content("Task", &body).is_none());
    }

    #[test]
    fn synthesize_returns_none_when_tool_name_is_unrecorded() {
        let idx = EventIndexer::default();
        let body = json!({ "toolInput": { "command": "ls" } });
        assert!(synthesize_input_delta_event(
            "t-1",
            0,
            &body,
            None,
            &idx,
            RuntimeEventMetadata::default(),
            &PlainHooks,
        )
        .is_none());
    }

    #[test]
    fn synthesize_returns_none_for_non_structured_tools() {
        let mut idx = EventIndexer::default();
        idx.record_tool_name("t-2", "Read");
        let body = json!({ "toolInput": { "file_path": "/x" } });
        assert!(synthesize_input_delta_event(
            "t-2",
            0,
            &body,
            None,
            &idx,
            RuntimeEventMetadata::default(),
            &PlainHooks,
        )
        .is_none());
    }

    #[test]
    fn synthesize_emits_input_json_delta_from_explicit_tool_input() {
        let mut idx = EventIndexer::default();
        idx.record_tool_name("t-3", "Bash");
        let body = json!({ "toolInput": { "command": "ls -la" } });
        let event = synthesize_input_delta_event(
            "t-3",
            7,
            &body,
            None,
            &idx,
            RuntimeEventMetadata::default(),
            &PlainHooks,
        )
        .expect("event");
        match event.stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockDelta {
                index,
                delta: RuntimeContentDelta::InputJson { partial_json },
            } => {
                assert_eq!(*index, 7);
                let parsed: Value = serde_json::from_str(partial_json).unwrap();
                assert_eq!(parsed["command"], "ls -la");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn synthesize_falls_back_to_diff_content_for_write() {
        let mut idx = EventIndexer::default();
        idx.record_tool_name("t-4", "Write");
        let body = json!({
            "toolInput": {},
            "content": [
                { "type": "diff", "path": "/repo/file.txt", "newText": "hello" }
            ]
        });
        let event = synthesize_input_delta_event(
            "t-4",
            3,
            &body,
            None,
            &idx,
            RuntimeEventMetadata::default(),
            &PlainHooks,
        )
        .expect("event");
        match event.stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockDelta {
                delta: RuntimeContentDelta::InputJson { partial_json },
                ..
            } => {
                let parsed: Value = serde_json::from_str(partial_json).unwrap();
                assert_eq!(parsed["file_path"], "/repo/file.txt");
                assert_eq!(parsed["content"], "hello");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }
}
