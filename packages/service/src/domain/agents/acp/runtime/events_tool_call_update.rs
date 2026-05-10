//! Mapping of ACP `tool_call_update` notifications onto Cadencr
//! `RuntimeEvent`s.
//!
//! Split out of `events_tool_call.rs` to keep both files under the 400-line
//! ceiling. Production logic is small; the bulk is the inline test matrix
//! covering full-lifecycle (`pending` / `in_progress` / `completed` /
//! `failed`) plus `rawOutput` and sub-agent linkage cases.

use serde_json::Value;

use crate::domain::agents::adapter::{RuntimeEvent, RuntimeEventMetadata};
use crate::domain::agents::opencode::events::stream_stop_event as http_stream_stop_event;

use super::events_stream_blocks::EventIndexer;
use super::events_tool_call::{other_event, MappedUpdate};
use super::events_tool_call_input::synthesize_input_delta_event;
use super::events_tool_call_parent::parent_tool_use_id;
use super::events_tool_call_result::{tool_result_event, tool_result_event_from_raw_output};
use super::provider_hooks::AcpProviderHooks;

pub fn map_tool_call_update(
    body: &Value,
    indexer: &mut EventIndexer,
    metadata: RuntimeEventMetadata,
    hooks: &dyn AcpProviderHooks,
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
    let parent = parent_tool_use_id(body);

    if indexer.tool_name_for(tool_call_id) == Some("AskUserQuestion") {
        if let Some(event) = hooks.tool_call_update_override(
            tool_call_id,
            body,
            status,
            &metadata,
            parent.as_deref(),
            indexer,
        ) {
            return MappedUpdate {
                events: vec![event],
            };
        }
    }

    if let Some(delta_event) = synthesize_input_delta_event(
        tool_call_id,
        index,
        body,
        parent.clone(),
        indexer,
        metadata.clone(),
        hooks,
    ) {
        events.push(delta_event);
    }

    push_tool_result(
        body,
        tool_call_id,
        status,
        parent.clone(),
        metadata.clone(),
        hooks,
        &mut events,
    );

    if matches!(status, "completed" | "failed") {
        // Build via the shared Claude-shape helper so the WS bridge ships a
        // `content_block_stop` envelope the FE recognises.
        let event = http_stream_stop_event(
            metadata.session_id.as_deref().unwrap_or(""),
            index,
            parent.as_deref(),
        );
        events.push(event);
    } else if events.is_empty() {
        events.push(other_event(metadata));
    }

    MappedUpdate { events }
}

/// `rawOutput` is the literal tool output the agent supplied. When present,
/// surface it as the tool_result content verbatim (preserving JSON shape) so
/// the FE doesn't see a stringified blob. Falls back to the structured
/// `content[]` array path for providers/tools that only emit the legacy
/// shape.
fn push_tool_result(
    body: &Value,
    tool_call_id: &str,
    status: &str,
    parent: Option<String>,
    metadata: RuntimeEventMetadata,
    hooks: &dyn AcpProviderHooks,
    events: &mut Vec<RuntimeEvent>,
) {
    if let Some(raw_output) = body.get("rawOutput").cloned() {
        let is_error = matches!(status, "failed");
        let mut event =
            tool_result_event_from_raw_output(tool_call_id, raw_output, is_error, metadata);
        event.set_parent_tool_use_id(parent);
        events.push(event);
        return;
    }
    let Some(content) = body.get("content").and_then(Value::as_array) else {
        return;
    };
    if content.is_empty() {
        return;
    }
    let is_error = matches!(status, "failed");
    let mut event = tool_result_event(tool_call_id, content, is_error, metadata, hooks);
    event.set_parent_tool_use_id(parent);
    events.push(event);
}

#[cfg(test)]
mod tests {
    use super::map_tool_call_update;
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::adapter::{
        RuntimeEventMetadata, RuntimePermissionDecision, RuntimePermissionMode, RuntimeStreamEvent,
        RuntimeUserContentBlock,
    };
    use serde_json::{json, Value};

    /// Test hook: identity normalization, "join text blocks" flatten so the
    /// content[] path test works without a provider envelope.
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
            let texts: Option<Vec<String>> = blocks
                .iter()
                .map(|b| {
                    b.get("type").and_then(Value::as_str).and_then(|kind| {
                        if kind == "text" {
                            b.get("text").and_then(Value::as_str).map(ToOwned::to_owned)
                        } else {
                            None
                        }
                    })
                })
                .collect();
            if let Some(texts) = texts {
                if !texts.is_empty() {
                    return Value::String(texts.join("\n"));
                }
            }
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

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            raw: json!({}),
            ..RuntimeEventMetadata::default()
        }
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
            &PlainHooks,
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
            &PlainHooks,
        );
        let user = result.events[0].user_message().unwrap();
        match &user.content[0] {
            RuntimeUserContentBlock::ToolResult { is_error, .. } => assert!(*is_error),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    // --- Lifecycle status audit -----------------------------------------

    #[test]
    fn in_progress_update_with_content_emits_result_but_no_stop() {
        // ACP can emit incremental `in_progress` updates carrying interim
        // content; we must surface the content as a tool_result event but
        // *not* close the block — only terminal status closes it.
        let mut idx = EventIndexer::default();
        let _ = idx.index_for_tool("t-progress");
        let result = map_tool_call_update(
            &json!({
                "toolCallId": "t-progress",
                "status": "in_progress",
                "content": [ { "type": "text", "text": "halfway" } ]
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        assert!(result.events.iter().any(|e| e.user_message().is_some()));
        assert!(!result.events.iter().any(|e| matches!(
            e.stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStop { .. })
        )));
    }

    #[test]
    fn update_without_status_does_not_auto_stop() {
        // No status field — we treat this as "ongoing" and never auto-emit
        // ContentBlockStop. (Bug-prevention test: a previous mistake here
        // would close the block on every content delta.)
        let mut idx = EventIndexer::default();
        let _ = idx.index_for_tool("t-no-status");
        let result = map_tool_call_update(
            &json!({
                "toolCallId": "t-no-status",
                "content": [ { "type": "text", "text": "tick" } ]
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        assert!(!result.events.iter().any(|e| matches!(
            e.stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStop { .. })
        )));
    }

    // --- rawOutput surfacing --------------------------------------------

    #[test]
    fn update_with_raw_output_preserves_json_shape() {
        let mut idx = EventIndexer::default();
        let _ = idx.index_for_tool("t-raw-out");
        let result = map_tool_call_update(
            &json!({
                "toolCallId": "t-raw-out",
                "status": "completed",
                "rawOutput": { "ok": true, "items": [1, 2, 3] }
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        // The user-message tool-result must contain the JSON object verbatim,
        // not a stringified blob.
        let user = result
            .events
            .iter()
            .find_map(|e| e.user_message())
            .expect("user message");
        match &user.content[0] {
            RuntimeUserContentBlock::ToolResult { content, .. } => {
                assert_eq!(content["ok"], true);
                assert_eq!(content["items"][2], 3);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn update_inherits_parent_tool_use_id_from_parent_tool_call_id() {
        // The terminal update of a sub-agent child must propagate
        // parent linkage onto every emitted event so the FE keeps nesting
        // the result under the parent tool block.
        let mut idx = EventIndexer::default();
        let _ = idx.index_for_tool("child-x");
        let result = map_tool_call_update(
            &json!({
                "toolCallId": "child-x",
                "parentToolCallId": "task-parent",
                "status": "completed",
                "content": [ { "type": "text", "text": "done" } ]
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        for event in &result.events {
            assert_eq!(event.parent_tool_use_id(), Some("task-parent"));
        }
    }
}
