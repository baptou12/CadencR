//! Tool-call mapping helpers for ACP `tool_call` / `tool_call_update`.

use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeStreamEvent,
    RuntimeUserContentBlock, RuntimeUserMessage,
};
use crate::domain::agents::opencode::acp::events::{other_event, EventIndexer, MappedUpdate};
use crate::domain::agents::opencode::acp::events_tool_call_input::synthesize_input_delta_event;
use crate::domain::agents::opencode::acp::events_tool_call_normalize::{
    flatten_tool_result_content, normalize_edit_input,
};
use crate::domain::agents::opencode::acp::events_tool_call_question::{
    question_start_event, question_update_event,
};
use crate::domain::agents::opencode::tool_names::{
    canonical_acp_tool_name, canonical_cadencr_tool_name,
};

pub(super) fn map_tool_call_start(
    body: &Value,
    indexer: &mut EventIndexer,
    metadata: RuntimeEventMetadata,
) -> MappedUpdate {
    let Some(tool_call_id) = body
        .get("toolCallId")
        .or_else(|| body.get("toolUseId"))
        .and_then(Value::as_str)
    else {
        return MappedUpdate {
            events: vec![other_event(metadata)],
        };
    };
    let raw_tool_name = body
        .get("toolName")
        .or_else(|| body.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("tool");
    // OpenCode emits lowercase tool kinds (`write`, `edit`, `bash`); the FE
    // matches Pascal-case names. Then run the Cadencr-MCP rewrite the HTTP
    // path also uses for `cadencr-<server>_<tool>` → `mcp__cadencr-…`.
    let tool_name = canonical_cadencr_tool_name(&canonical_acp_tool_name(raw_tool_name));
    indexer.record_tool_name(tool_call_id, &tool_name);
    let raw_input = body
        .get("toolInput")
        .or_else(|| body.get("rawInput"))
        .cloned()
        .unwrap_or(Value::Null);
    // FE diff renderer keys: `old_string`/`new_string`/`file_path`. ACP
    // emits `oldText`/`newText`/`path`; normalise here.
    let input = normalize_edit_input(&tool_name, raw_input);
    if tool_name == "AskUserQuestion" {
        // OpenCode's first `tool_call` for `question` carries an empty
        // `rawInput`; the actual `questions[]` only arrive in the
        // subsequent `tool_call_update`. Defer permission emission to the
        // update — `map_tool_call_update` will see the recorded tool name
        // and re-fire `question_permission_event` once the payload is real.
        if let Some(event) = question_start_event(
            tool_call_id,
            input,
            metadata,
            parent_tool_use_id(body),
            indexer,
        ) {
            return MappedUpdate {
                events: vec![event],
            };
        }
        // Swallow the empty-payload start so the FE doesn't render a
        // half-built question drawer with no options.
        return MappedUpdate { events: vec![] };
    }
    let index = indexer.index_for_tool(tool_call_id);
    let mut event = RuntimeEvent::new(
        metadata,
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStart {
                index,
                block: RuntimeContentBlock::ToolUse {
                    id: tool_call_id.to_string(),
                    name: tool_name,
                    input,
                },
            },
            parent_tool_use_id: None,
        },
    );
    event.set_parent_tool_use_id(parent_tool_use_id(body));
    MappedUpdate {
        events: vec![event],
    }
}

pub(super) fn map_tool_call_update(
    body: &Value,
    indexer: &mut EventIndexer,
    metadata: RuntimeEventMetadata,
) -> MappedUpdate {
    let Some(tool_call_id) = body
        .get("toolCallId")
        .or_else(|| body.get("toolUseId"))
        .and_then(Value::as_str)
    else {
        return MappedUpdate {
            events: vec![other_event(metadata)],
        };
    };
    let status = body.get("status").and_then(Value::as_str).unwrap_or("");
    let mut events = Vec::new();
    let index = indexer.index_for_tool(tool_call_id);

    // AskUserQuestion: OpenCode delivers the questions only in the update,
    // so re-fire the permission event here once the payload is real. The
    // FE has nothing to render for the empty-payload start, so we never
    // emitted a tool block — emit just the permission envelope.
    if indexer.tool_name_for(tool_call_id) == Some("AskUserQuestion") {
        if let Some(event) = question_update_event(
            tool_call_id,
            body,
            status,
            metadata.clone(),
            parent_tool_use_id(body),
            indexer,
        ) {
            return MappedUpdate {
                events: vec![event],
            };
        }
    }

    // OpenCode's `tool_call` start typically carries an empty `toolInput`;
    // the actual args arrive in the first update. Surface them to the FE
    // via a synthetic `input_json_delta` so Write/Edit render diffs.
    if let Some(delta_event) = synthesize_input_delta_event(
        tool_call_id,
        index,
        body,
        parent_tool_use_id(body),
        indexer,
        metadata.clone(),
    ) {
        events.push(delta_event);
    }

    // Stream the result content (if any) as a tool result on the
    // user-message channel. ACP `content[]` may carry text, diff,
    // terminal, etc.
    if let Some(content) = body.get("content").and_then(Value::as_array) {
        if !content.is_empty() {
            let is_error = matches!(status, "failed");
            let mut event = tool_result_event(tool_call_id, content, is_error, metadata.clone());
            event.set_parent_tool_use_id(parent_tool_use_id(body));
            events.push(event);
        }
    }

    if matches!(status, "completed" | "failed") {
        let mut event = RuntimeEvent::new(
            metadata,
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::ContentBlockStop { index },
                parent_tool_use_id: None,
            },
        );
        event.set_parent_tool_use_id(parent_tool_use_id(body));
        events.push(event);
    } else if events.is_empty() {
        events.push(other_event(metadata));
    }

    MappedUpdate { events }
}

fn parent_tool_use_id(body: &Value) -> Option<String> {
    body.get("parentToolCallId")
        .or_else(|| body.get("parentToolUseId"))
        .or_else(|| body.get("parent_tool_use_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn tool_result_event(
    tool_call_id: &str,
    content: &[Value],
    is_error: bool,
    metadata: RuntimeEventMetadata,
) -> RuntimeEvent {
    let payload = flatten_tool_result_content(content);
    RuntimeEvent::new(
        metadata,
        RuntimeEventKind::UserMessage {
            message: RuntimeUserMessage {
                content: vec![RuntimeUserContentBlock::ToolResult {
                    tool_use_id: Some(tool_call_id.to_string()),
                    is_error,
                    content: payload,
                }],
            },
            parent_tool_use_id: None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{map_tool_call_start, map_tool_call_update};
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeEventMetadata, RuntimeStreamEvent, RuntimeUserContentBlock,
    };
    use crate::domain::agents::opencode::acp::events::EventIndexer;
    use serde_json::json;

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            raw: json!({}),
            ..RuntimeEventMetadata::default()
        }
    }
    #[test]
    fn start_emits_content_block_start_with_tool_use() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({ "toolCallId": "t-1", "toolName": "Bash", "toolInput": { "command": "ls" } }),
            &mut idx,
            metadata(),
        );
        assert_eq!(result.events.len(), 1);
        match result.events[0].stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { id, name, input },
                ..
            } => {
                assert_eq!(id, "t-1");
                assert_eq!(name, "Bash");
                assert_eq!(input["command"], "ls");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn start_without_tool_call_id_falls_back_to_other() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(&json!({ "toolName": "Bash" }), &mut idx, metadata());
        assert_eq!(result.events.len(), 1);
        assert!(result.events[0].stream_event().is_none());
    }

    #[test]
    fn completed_update_emits_result_then_stop() {
        let mut idx = EventIndexer::default();
        let _ = idx.index_for_tool("t-1");
        let result = map_tool_call_update(
            &json!({
                "toolCallId": "t-1",
                "status": "completed",
                "content": [ { "type": "text", "text": "ok" } ]
            }),
            &mut idx,
            metadata(),
        );
        assert_eq!(result.events.len(), 2);
        assert!(result.events[0].user_message().is_some());
        assert!(matches!(
            result.events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStop { .. })
        ));
    }

    #[test]
    fn failed_update_marks_tool_result_as_error() {
        let mut idx = EventIndexer::default();
        let _ = idx.index_for_tool("t-2");
        let result = map_tool_call_update(
            &json!({
                "toolCallId": "t-2",
                "status": "failed",
                "content": [ { "type": "text", "text": "boom" } ]
            }),
            &mut idx,
            metadata(),
        );
        let user = result.events[0].user_message().unwrap();
        match &user.content[0] {
            RuntimeUserContentBlock::ToolResult { is_error, .. } => assert!(*is_error),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn edit_tool_input_normalizes_acp_keys_via_map_tool_call_start() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({
                "toolCallId": "edit-1",
                "toolName": "Edit",
                "toolInput": { "path": "/x", "oldText": "a", "newText": "b" }
            }),
            &mut idx,
            metadata(),
        );
        match result.events[0].stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { input, .. },
                ..
            } => {
                assert_eq!(input["file_path"], "/x");
                assert_eq!(input["old_string"], "a");
                assert_eq!(input["new_string"], "b");
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn cadencr_mcp_tool_names_are_normalized_on_start() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({ "toolCallId": "t", "toolName": "cadencr-plan_update_plan", "toolInput": {} }),
            &mut idx,
            metadata(),
        );
        match result.events[0].stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { name, .. },
                ..
            } => assert_eq!(name, "mcp__cadencr-plan__update_plan"),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn start_preserves_parent_tool_use_id_from_nested_acp_call() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({
                "toolCallId": "child-1",
                "parentToolCallId": "parent-1",
                "toolName": "Bash",
                "toolInput": {}
            }),
            &mut idx,
            metadata(),
        );
        assert_eq!(result.events[0].parent_tool_use_id(), Some("parent-1"));
        assert_eq!(
            result.events[0].raw_json()["parent_tool_use_id"],
            "parent-1"
        );
    }

    #[test]
    fn lowercase_acp_tool_kinds_are_canonicalized_to_pascal_case() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({ "toolCallId": "w", "toolName": "write", "toolInput": {} }),
            &mut idx,
            metadata(),
        );
        match result.events[0].stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { name, .. },
                ..
            } => assert_eq!(name, "Write"),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn update_emits_input_delta_when_tool_input_arrives_post_start() {
        let mut idx = EventIndexer::default();
        let _ = map_tool_call_start(
            &json!({ "toolCallId": "w-1", "toolName": "write", "toolInput": {} }),
            &mut idx,
            metadata(),
        );
        let update = map_tool_call_update(
            &json!({
                "toolCallId": "w-1",
                "status": "completed",
                "toolInput": { "file_path": "/x/y.txt", "content": "hello" },
                "content": [{ "type": "text", "text": "ok" }]
            }),
            &mut idx,
            metadata(),
        );
        let first = update.events[0].stream_event().expect("delta event");
        let RuntimeStreamEvent::ContentBlockDelta {
            delta: crate::domain::agents::adapter::RuntimeContentDelta::InputJson { partial_json },
            ..
        } = first
        else {
            panic!("expected InputJson delta as first update event");
        };
        let parsed: serde_json::Value = serde_json::from_str(partial_json).unwrap();
        assert_eq!(parsed["file_path"], "/x/y.txt");
        assert_eq!(parsed["content"], "hello");
    }
}
