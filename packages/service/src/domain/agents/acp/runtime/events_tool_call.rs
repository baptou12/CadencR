//! Tool-call mapping helpers for ACP `tool_call` / `tool_call_update`.
//!
//! Provider-neutral. Provider-specific normalization (tool-name aliases,
//! edit-key renaming, content-envelope unwrap) flows through
//! `AcpProviderHooks` so adapters keep their quirks isolated.

use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeStreamEvent,
};

use super::events_stream_blocks::EventIndexer;
use super::provider_hooks::AcpProviderHooks;

/// Result of mapping a single `session/update`. Most updates produce 1
/// event; tool calls may produce 2 (result + stop in the same notification).
pub struct MappedUpdate {
    pub events: Vec<RuntimeEvent>,
}

pub fn map_tool_call_start(
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
    let raw_tool_name = body
        .get("toolName")
        .or_else(|| body.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("tool");
    let tool_name = hooks.normalize_tool_name(raw_tool_name);
    indexer.record_tool_name(tool_call_id, &tool_name);
    // ACP's `rawInput` is the literal tool input the agent supplied, before
    // any normalization. When it's present we ship it through to the FE as
    // ToolUse.input verbatim so downstream consumers (replay, raw-debug
    // panel) see the exact shape the agent emitted. Falling back to
    // `toolInput` runs the provider-specific normalize hook for legacy
    // providers that only emit the normalized field.
    let input = if let Some(raw_input) = body.get("rawInput").cloned() {
        raw_input
    } else {
        let tool_input = body.get("toolInput").cloned().unwrap_or(Value::Null);
        hooks.normalize_tool_input(&tool_name, tool_input)
    };
    let parent = parent_tool_use_id(body);
    if let Some(event) = hooks.tool_call_start_override(
        tool_call_id,
        &tool_name,
        &input,
        &metadata,
        parent.as_deref(),
        indexer,
    ) {
        return MappedUpdate {
            events: vec![event],
        };
    }
    if tool_name == "AskUserQuestion" {
        // Provider declined the override (no real payload yet) — swallow the
        // empty-payload start so the FE doesn't render a half-built question
        // drawer with no options.
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
    event.set_parent_tool_use_id(parent);
    MappedUpdate {
        events: vec![event],
    }
}

pub fn other_event(metadata: RuntimeEventMetadata) -> RuntimeEvent {
    RuntimeEvent::new(metadata, RuntimeEventKind::Other)
}

/// Extract a parent-tool-use id for sub-agent linkage from a `tool_call` /
/// `tool_call_update` body. ACP today carries this on the parent-side
/// (`parentToolCallId` / `parentToolUseId`) and on the spawn-side
/// (`subAgentSessionId` — the child session id, used by the FE to nest
/// child events under the parent tool block). We accept all forms so an
/// adapter that only emits one of them still surfaces nesting metadata.
///
/// Note: ACP sub-agent **replay** (loading a child session's history on
/// restart) is a separate concern — it requires `session/load`, which is
/// gated on the agent advertising the `loadSession` capability. This is
/// out of scope until OpenCode supports durable sessions; the existing
/// skip-and-log path in `lifecycle.rs` covers the absence-of-capability
/// case.
pub(super) fn parent_tool_use_id(body: &Value) -> Option<String> {
    body.get("parentToolCallId")
        .or_else(|| body.get("parentToolUseId"))
        .or_else(|| body.get("parent_tool_use_id"))
        .or_else(|| body.get("subAgentSessionId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::map_tool_call_start;
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::acp::runtime::events_tool_call_update::map_tool_call_update;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeEventMetadata, RuntimePermissionDecision,
        RuntimePermissionMode, RuntimeStreamEvent,
    };
    use serde_json::{json, Value};

    /// Test hook that does no normalization and provides identity flatten.
    struct PlainHooks;

    #[async_trait::async_trait]
    impl AcpProviderHooks for PlainHooks {
        fn normalize_tool_name(&self, raw: &str) -> String {
            raw.to_string()
        }
        fn normalize_tool_input(&self, _tool_name: &str, input: Value) -> Value {
            input
        }
        fn flatten_tool_result_content(&self, blocks: &[Value]) -> Value {
            // Mimic the simple "join text blocks" path so the result test
            // works without a provider-specific envelope wrap/unwrap.
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
    fn start_emits_content_block_start_with_tool_use() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({ "toolCallId": "t-1", "toolName": "Bash", "toolInput": { "command": "ls" } }),
            &mut idx,
            metadata(),
            &PlainHooks,
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
        let result = map_tool_call_start(
            &json!({ "toolName": "Bash" }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        assert_eq!(result.events.len(), 1);
        assert!(result.events[0].stream_event().is_none());
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
            &PlainHooks,
        );
        assert_eq!(result.events[0].parent_tool_use_id(), Some("parent-1"));
        assert_eq!(
            result.events[0].raw_json()["parent_tool_use_id"],
            "parent-1"
        );
    }

    // --- W7 lifecycle audit (start-side) ---------------------------------

    #[test]
    fn pending_first_sight_emits_content_block_start_only() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({
                "toolCallId": "t-pending",
                "toolName": "Bash",
                "status": "pending",
                "toolInput": { "command": "echo hi" }
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        assert_eq!(result.events.len(), 1);
        assert!(matches!(
            result.events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
    }

    // --- W7 raw I/O surfacing tests --------------------------------------

    #[test]
    fn start_uses_raw_input_verbatim_when_present() {
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({
                "toolCallId": "t-raw",
                "toolName": "Bash",
                "rawInput": { "foo": 1, "nested": { "bar": [1, 2] } }
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        match result.events[0].stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { input, .. },
                ..
            } => {
                assert_eq!(input["foo"], 1);
                assert_eq!(input["nested"]["bar"][0], 1);
                assert_eq!(input["nested"]["bar"][1], 2);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    // The fallback-to-toolInput path is already covered by
    // `start_emits_content_block_start_with_tool_use` above, which uses
    // `toolInput` (not `rawInput`) and asserts the populated input.

    // --- W8 sub-agent metadata tests -------------------------------------

    #[test]
    fn start_propagates_sub_agent_session_id_as_parent() {
        // ACP can mark a child invocation by `subAgentSessionId` instead of
        // `parentToolCallId`; both must surface as parent_tool_use_id so the
        // FE can nest the child events under the parent tool block.
        let mut idx = EventIndexer::default();
        let result = map_tool_call_start(
            &json!({
                "toolCallId": "child-sas",
                "subAgentSessionId": "sub-session-9",
                "toolName": "Bash",
                "toolInput": {}
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        assert_eq!(result.events[0].parent_tool_use_id(), Some("sub-session-9"));
    }

    #[test]
    fn nested_chain_sets_child_parent_to_parent_tool_use_id() {
        // Simulate a Task-tool spawning a child Bash tool. The child event's
        // metadata.parent_tool_use_id must equal the parent's tool_use_id.
        let mut idx = EventIndexer::default();
        // Parent: `Task` tool call (no parent of its own).
        let parent_start = map_tool_call_start(
            &json!({
                "toolCallId": "task-parent",
                "toolName": "Task",
                "toolInput": { "prompt": "do thing" }
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        let parent_id = match parent_start.events[0].stream_event().unwrap() {
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { id, .. },
                ..
            } => id.clone(),
            other => panic!("unexpected: {other:?}"),
        };
        assert!(parent_start.events[0].parent_tool_use_id().is_none());

        // Child: spawned by the parent Task tool.
        let child_start = map_tool_call_start(
            &json!({
                "toolCallId": "child-bash",
                "parentToolCallId": parent_id.clone(),
                "toolName": "Bash",
                "toolInput": { "command": "ls" }
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        assert_eq!(
            child_start.events[0].parent_tool_use_id(),
            Some(parent_id.as_str())
        );

        // And the child's terminal update inherits the same parent linkage
        // so the FE keeps nesting the result under the parent block.
        let child_done = map_tool_call_update(
            &json!({
                "toolCallId": "child-bash",
                "parentToolCallId": parent_id.clone(),
                "status": "completed",
                "content": [ { "type": "text", "text": "done" } ]
            }),
            &mut idx,
            metadata(),
            &PlainHooks,
        );
        for event in &child_done.events {
            assert_eq!(event.parent_tool_use_id(), Some(parent_id.as_str()));
        }
    }
}
