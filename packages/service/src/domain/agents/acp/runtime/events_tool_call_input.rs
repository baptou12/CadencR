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

use crate::domain::agents::adapter::{
    RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeStreamEvent,
};

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
    let raw_input = body
        .get("toolInput")
        .or_else(|| body.get("rawInput"))
        .cloned();
    let derived_input = match raw_input {
        Some(value) if !is_empty_value(&value) => value,
        _ => derive_input_from_content(&tool_name, body)?,
    };
    let normalized = hooks.normalize_tool_input(&tool_name, derived_input);
    let partial_json = serde_json::to_string(&normalized).ok()?;
    let mut event = RuntimeEvent::new(
        metadata,
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockDelta {
                index,
                delta: RuntimeContentDelta::InputJson { partial_json },
            },
            parent_tool_use_id: None,
        },
    );
    event.set_parent_tool_use_id(parent_tool_use_id);
    Some(event)
}

pub(super) fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Object(map) => map.is_empty(),
        Value::Array(arr) => arr.is_empty(),
        _ => false,
    }
}

/// Walk the ACP `content[]` array for a `Diff` variant and synthesise a
/// `{file_path, old_string, new_string}` input. Used for Edit/Write/
/// MultiEdit where the agent sends the actual file payload only inside
/// the update's content rather than a top-level `toolInput`.
pub(super) fn derive_input_from_content(tool_name: &str, body: &Value) -> Option<Value> {
    if !matches!(tool_name, "Write" | "Edit" | "MultiEdit" | "ApplyPatch") {
        return None;
    }
    let content = body.get("content").and_then(Value::as_array)?;
    for entry in content {
        if entry.get("type").and_then(Value::as_str) != Some("diff") {
            continue;
        }
        let path = entry
            .get("path")
            .or_else(|| entry.get("filePath"))
            .and_then(Value::as_str)?;
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
        if tool_name == "Write" {
            return Some(json!({
                "file_path": path,
                "content": new_text,
            }));
        }
        return Some(json!({
            "file_path": path,
            "old_string": old_text,
            "new_string": new_text,
        }));
    }
    None
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
        RuntimeContentDelta, RuntimeEventMetadata, RuntimePermissionDecision,
        RuntimePermissionMode, RuntimeStreamEvent,
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
        fn permission_decision_for_kind(&self, _: &str) -> RuntimePermissionDecision {
            RuntimePermissionDecision::AllowOnce
        }
        fn mode_for_permission_mode(&self, _: RuntimePermissionMode) -> Option<&'static str> {
            None
        }
        fn decorate_system_prompt(&self, _: Option<&str>) -> Option<String> {
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
