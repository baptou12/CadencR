use serde_json::Value;

use super::event_items::{
    command_output_delta_event, file_patch_updated_event, item_events, tool_json_delta_event,
};
use super::event_json::{compact_event, metadata, stream_event_raw, thread_id};
use super::event_plan::plan_updated_event;
use super::event_raw::raw_response_item_events;
use super::event_state::IndexState;
use super::event_usage::usage_event;
use crate::domain::agents::adapter::{
    RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeStreamEvent,
};

pub fn notification_events(
    method: &str,
    params: Value,
    model: Option<&str>,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let subagent_parent_tool_use_id = if index_state.has_any_subagents() {
        params
            .get("threadId")
            .and_then(Value::as_str)
            .and_then(|thread_id| index_state.subagent_parent_tool_use_id(thread_id))
            .map(ToOwned::to_owned)
    } else {
        None
    };

    if method == "turn/completed" && subagent_parent_tool_use_id.is_some() {
        return Vec::new();
    }

    let mut events = dispatch_notification(method, params, model, index_state);
    if let Some(parent_tool_use_id) = subagent_parent_tool_use_id {
        apply_subagent_parent_tool_use_id(&mut events, &parent_tool_use_id);
    }
    events
}

fn dispatch_notification(
    method: &str,
    params: Value,
    model: Option<&str>,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    match method {
        "turn/started" => turn_started_event(params, model).into_iter().collect(),
        "turn/completed" => vec![result_event(params)],
        "thread/tokenUsage/updated" => vec![usage_event(params)],
        "thread/compacted" => vec![compact_event(params)],
        "turn/plan/updated" => vec![plan_updated_event(params, index_state)],
        "item/commandExecution/outputDelta" | "command/exec/outputDelta" => {
            command_output_delta_event(params, index_state)
        }
        "item/fileChange/outputDelta" => tool_json_delta_event(params, "output", index_state),
        "item/fileChange/patchUpdated" => file_patch_updated_event(params, index_state),
        "item/mcpToolCall/progress" => tool_json_delta_event(params, "progress", index_state),
        "item/started" => item_events(params, false, index_state),
        "item/completed" => item_events(params, true, index_state),
        "rawResponseItem/completed" => raw_response_item_events(params, index_state),
        "item/agentMessage/delta" => text_delta_event(params, model, index_state),
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            reasoning_delta_event(params, model, index_state)
        }
        _ => Vec::new(),
    }
}

/// If this notification's `threadId` belongs to a tracked sub-agent thread,
/// stamp every emitted event with the spawning `Agent` tool_use's id so the
/// frontend nests them under that block. Provider-neutral nesting (Claude's
/// `Task`, OpenCode's `Agent`) keys off the same `parent_tool_use_id` field.
fn apply_subagent_parent_tool_use_id(events: &mut [RuntimeEvent], parent_tool_use_id: &str) {
    for event in events.iter_mut() {
        // Don't override an already-set parent (defends against nested
        // sub-agents already correctly tagged by inner handlers).
        if event.parent_tool_use_id().is_some() {
            continue;
        }
        event.set_parent_tool_use_id(Some(parent_tool_use_id.to_string()));
    }
}

pub fn turn_id_from_started(params: &Value) -> Option<String> {
    params
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn turn_started_event(params: Value, model: Option<&str>) -> Option<RuntimeEvent> {
    Some(RuntimeEvent::new(
        metadata(
            thread_id(&params),
            serde_json::json!({
                "type": "stream_event",
                "session_id": thread_id(&params),
                "event": { "type": "message_start", "message": { "model": model } }
            }),
        ),
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::MessageStart {
                model: model.map(ToOwned::to_owned),
                input_tokens: None,
            },
            parent_tool_use_id: None,
        },
    ))
}

fn result_event(params: Value) -> RuntimeEvent {
    RuntimeEvent::new(
        metadata(
            thread_id(&params),
            serde_json::json!({ "type": "result", "session_id": thread_id(&params) }),
        ),
        RuntimeEventKind::Result,
    )
}

fn text_delta_event(
    params: Value,
    model: Option<&str>,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    delta_event(params, model, false, index_state)
}

fn reasoning_delta_event(
    params: Value,
    model: Option<&str>,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    delta_event(params, model, true, index_state)
}

fn delta_event(
    params: Value,
    _model: Option<&str>,
    thinking: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let delta = params
        .get("delta")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let index = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(|item_id| index_state.index_for(item_id))
        .unwrap_or(0);
    let event = if thinking {
        RuntimeStreamEvent::ContentBlockDelta {
            index,
            delta: RuntimeContentDelta::Thinking { thinking: delta },
        }
    } else {
        RuntimeStreamEvent::ContentBlockDelta {
            index,
            delta: RuntimeContentDelta::Text { text: delta },
        }
    };
    let sid = thread_id(&params).to_string();
    vec![RuntimeEvent::new(
        metadata(&sid, stream_event_raw(&sid, None, &event)),
        RuntimeEventKind::StreamEvent {
            event,
            parent_tool_use_id: None,
        },
    )]
}

#[cfg(test)]
mod tests {
    use super::super::event_state::IndexState;
    use super::notification_events;
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeEvent, RuntimeStreamEvent, RuntimeUserContentBlock,
    };
    use serde_json::json;

    fn map_events(method: &str, params: serde_json::Value) -> Vec<RuntimeEvent> {
        let mut indexes = IndexState::default();
        notification_events(method, params, None, &mut indexes)
    }

    #[test]
    fn tool_completion_without_start_emits_call_then_result() {
        let events = map_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "pwd",
                    "status": "completed"
                }
            }),
        );
        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
        assert!(events[1].user_message().is_some());
    }

    #[test]
    fn command_action_item_does_not_emit_completed_bash_fallback() {
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'",
                    "commandActions": [{ "type": "read", "path": "/etc/hosts" }]
                }
            }),
            None,
            &mut indexes,
        );
        let completed = notification_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'",
                    "status": "completed"
                }
            }),
            None,
            &mut indexes,
        );

        assert!(matches!(
            started[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { name, .. },
                ..
            }) if name == "Read"
        ));
        assert!(completed.is_empty());
    }

    #[test]
    fn tool_start_emits_tool_use() {
        let events = map_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": { "type": "fileChange", "id": "patch", "changes": [] }
            }),
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
    }

    #[test]
    fn command_output_delta_without_visible_command_is_suppressed() {
        let events = map_events(
            "item/commandExecution/outputDelta",
            json!({
                "threadId": "thread",
                "itemId": "cmd",
                "delta": "new chunk",
                "aggregatedOutput": "old\nnew chunk"
            }),
        );

        assert!(events.is_empty());
    }

    #[test]
    fn agent_message_start_and_delta_share_content_index() {
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": { "type": "agentMessage", "id": "msg_1" }
            }),
            None,
            &mut indexes,
        );
        let delta = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread",
                "itemId": "msg_1",
                "delta": "hello"
            }),
            None,
            &mut indexes,
        );

        let start_index = match started[0].stream_event() {
            Some(RuntimeStreamEvent::ContentBlockStart { index, .. }) => *index,
            other => panic!("expected content start, got {other:?}"),
        };
        let delta_index = match delta[0].stream_event() {
            Some(RuntimeStreamEvent::ContentBlockDelta { index, .. }) => *index,
            other => panic!("expected content delta, got {other:?}"),
        };
        assert_eq!(start_index, delta_index);
    }

    #[test]
    fn turn_plan_updated_emits_todowrite_tool() {
        let events = map_events(
            "turn/plan/updated",
            json!({
                "threadId": "thread",
                "turnId": "turn_1",
                "plan": [
                    { "step": "Read code", "status": "completed" },
                    { "step": "Patch code", "status": "inProgress" }
                ]
            }),
        );

        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event()
        else {
            panic!("expected TodoWrite start");
        };
        let crate::domain::agents::adapter::RuntimeContentBlock::ToolUse { name, input, .. } =
            block
        else {
            panic!("expected tool use");
        };
        assert_eq!(name, "TodoWrite");
        assert_eq!(input["todos"][0]["status"], "completed");
        assert_eq!(input["todos"][1]["status"], "in_progress");
    }

    #[test]
    fn plan_item_emits_visible_approval_gate() {
        let events = map_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "Plan",
                    "id": "plan_1",
                    "text": "## Proposed plan"
                }
            }),
        );

        assert_eq!(events.len(), 2);
        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event()
        else {
            panic!("expected ExitPlanMode block");
        };
        let crate::domain::agents::adapter::RuntimeContentBlock::ToolUse {
            id, name, input, ..
        } = block
        else {
            panic!("expected tool use");
        };
        assert_eq!(id, "codex_plan_approval_plan_1");
        assert_eq!(name, "ExitPlanMode");
        assert_eq!(input["plan"], "## Proposed plan");
        assert_eq!(events[1].raw_json()["type"], "codex_permission_request");
        assert_eq!(
            events[1].raw_json()["request_id"],
            "codex_plan_approval_plan_1"
        );
        assert_eq!(events[1].raw_json()["tool_name"], "ExitPlanMode");
    }

    #[test]
    fn plan_start_waits_for_completed_text() {
        let events = map_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "Plan",
                    "id": "plan_1"
                }
            }),
        );

        assert!(events.is_empty());
    }

    #[test]
    fn context_compaction_start_does_not_emit_divider() {
        let events = map_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "contextCompaction",
                    "id": "compact_1"
                }
            }),
        );

        assert!(events.is_empty());
    }

    #[test]
    fn context_compaction_completion_emits_single_divider_with_metadata() {
        let events = map_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "contextCompaction",
                    "id": "compact_1",
                    "trigger": "manual",
                    "preTokens": 90_000
                }
            }),
        );

        assert_eq!(events.len(), 1);
        assert!(events[0].is_compact_boundary());
        let metadata = events[0].compact_metadata().expect("compact metadata");
        assert_eq!(metadata.trigger.as_deref(), Some("manual"));
        assert_eq!(metadata.pre_tokens, Some(90_000));
    }

    #[test]
    fn spawn_agent_raw_function_call_emits_agent_block_and_tracks_subagent_thread() {
        // Real wire shape Codex emits when `experimentalRawEvents` is on:
        // `spawn_agent` arrives as a `rawResponseItem/completed` with a
        // `function_call` raw_item, NOT as `collabAgentToolCall`. The spawned
        // threadId is only revealed in the matching `function_call_output`
        // under `output.agentsStates` (object whose keys are threadIds).
        let mut indexes = IndexState::default();
        let spawn_call = notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call",
                    "call_id": "call_spawn_1",
                    "name": "spawn_agent",
                    "arguments": "{\"agent_type\":\"default\",\"message\":\"do work\"}"
                }
            }),
            None,
            &mut indexes,
        );

        // `spawn_agent` must be normalized to provider-neutral `Agent` so the
        // frontend's existing sub-agent UI (childBlocks) handles it.
        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) =
            spawn_call[0].stream_event()
        else {
            panic!("expected tool_use start, got {spawn_call:?}");
        };
        let RuntimeContentBlock::ToolUse { name, id, .. } = block else {
            panic!("expected tool_use block");
        };
        assert_eq!(name, "Agent");
        assert_eq!(id, "call_spawn_1");
        assert!(spawn_call[0].parent_tool_use_id().is_none());

        // Function_call_output for the spawn carries the spawned threadId
        // under `output.agentsStates` — we register the mapping here.
        let spawn_result = notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call_output",
                    "call_id": "call_spawn_1",
                    "output": {
                        "agentsStates": {
                            "thread_child": { "status": "pendingInit", "message": null }
                        },
                        "id": "call_spawn_1",
                        "status": "pendingInit"
                    }
                }
            }),
            None,
            &mut indexes,
        );
        // The tool_result itself is deliberately suppressed: its content is
        // just the bookkeeping `agentsStates` blob (`pendingInit`, etc.)
        // which would dump as a JSON string under the Agent block. The
        // sub-agent's actual output flows in later via wait_agent /
        // close_agent results. The side effect we DO care about — the
        // registered mapping — is still in place.
        assert!(spawn_result
            .iter()
            .all(|event| event.user_message().is_none()));

        // Now any event whose threadId is `thread_child` must be tagged
        // with `parent_tool_use_id = call_spawn_1`. This includes streamed
        // text from the sub-agent…
        let child_text = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_child",
                "itemId": "msg_child",
                "delta": "Reviewing"
            }),
            None,
            &mut indexes,
        );
        assert_eq!(child_text.len(), 1);
        assert_eq!(child_text[0].parent_tool_use_id(), Some("call_spawn_1"));
        assert_eq!(
            child_text[0].raw_json()["parent_tool_use_id"],
            json!("call_spawn_1"),
        );

        // …and tool calls the sub-agent makes (e.g. another raw function_call).
        let child_read = notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_child",
                "item": {
                    "type": "function_call",
                    "call_id": "call_child_read",
                    "name": "read_file",
                    "arguments": "{\"file_path\":\"src/lib.rs\"}"
                }
            }),
            None,
            &mut indexes,
        );
        assert_eq!(child_read[0].parent_tool_use_id(), Some("call_spawn_1"));

        // Events on the root thread must NOT be re-parented — they belong
        // at the top level alongside the Agent block.
        let root_text = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_root",
                "itemId": "msg_root",
                "delta": "still here"
            }),
            None,
            &mut indexes,
        );
        assert!(root_text[0].parent_tool_use_id().is_none());
    }

    #[test]
    fn subagent_turn_completed_does_not_emit_root_result() {
        let mut indexes = IndexState::default();
        notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call",
                    "call_id": "call_spawn_1",
                    "name": "spawn_agent",
                    "arguments": "{\"message\":\"do work\"}"
                }
            }),
            None,
            &mut indexes,
        );
        notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call_output",
                    "call_id": "call_spawn_1",
                    "output": {
                        "agentsStates": {
                            "thread_child": { "status": "completed", "message": "done" }
                        }
                    }
                }
            }),
            None,
            &mut indexes,
        );

        let events = notification_events(
            "turn/completed",
            json!({ "threadId": "thread_child" }),
            None,
            &mut indexes,
        );

        assert!(events.is_empty());
    }

    #[test]
    fn non_spawn_collab_function_calls_keep_their_name_and_do_not_register_subagents() {
        // `wait_agent` is the second function_call Codex emits in the
        // sub-agent flow. It must NOT be normalized to `Agent` and must NOT
        // register a sub-agent mapping (the threadId already comes from the
        // earlier `spawn_agent` output).
        let mut indexes = IndexState::default();
        let events = notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call",
                    "call_id": "call_wait_1",
                    "name": "wait_agent",
                    "arguments": "{\"targets\":[\"thread_child\"],\"timeout_ms\":120000}"
                }
            }),
            None,
            &mut indexes,
        );

        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event()
        else {
            panic!("expected tool_use start");
        };
        let RuntimeContentBlock::ToolUse { name, .. } = block else {
            panic!("expected tool_use block");
        };
        assert_eq!(name, "wait_agent");

        // No mapping should have been registered — events on `thread_child`
        // should still be re-parented (because spawn_agent registers them),
        // but events on a *different* unrelated thread should not be.
        let stray = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_unrelated",
                "itemId": "msg",
                "delta": "x"
            }),
            None,
            &mut indexes,
        );
        assert!(stray[0].parent_tool_use_id().is_none());
    }

    #[test]
    fn spawn_agent_collab_tool_emits_agent_block_and_tracks_subagent_thread() {
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "collabAgentToolCall",
                    "id": "collab_1",
                    "tool": "spawn_agent",
                    "newThreadId": "thread_child",
                    "prompt": "Look at the auth module"
                }
            }),
            None,
            &mut indexes,
        );

        // Codex's `spawn_agent` is normalized to the provider-neutral `Agent`
        // tool name so the frontend's existing sub-agent UI nests events
        // under it without provider branches.
        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = started[0].stream_event()
        else {
            panic!("expected tool_use start, got {started:?}");
        };
        let RuntimeContentBlock::ToolUse { name, id, .. } = block else {
            panic!("expected tool_use block");
        };
        assert_eq!(name, "Agent");
        assert_eq!(id, "collab_1");
        // The root-thread emission itself must not carry parent_tool_use_id.
        assert!(started[0].parent_tool_use_id().is_none());

        // Now the sub-agent thread starts streaming an agent message — the
        // adapter should stamp it with `parent_tool_use_id = collab_1` so
        // the frontend nests it inside the Agent block.
        let child_text = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_child",
                "itemId": "msg_child",
                "delta": "Looking at auth"
            }),
            None,
            &mut indexes,
        );
        assert_eq!(child_text.len(), 1);
        assert_eq!(child_text[0].parent_tool_use_id(), Some("collab_1"));
        assert_eq!(
            child_text[0].raw_json()["parent_tool_use_id"],
            json!("collab_1"),
        );

        // A child tool use (e.g. the sub-agent calls Read) must also be
        // nested under the parent Agent block.
        let child_tool = notification_events(
            "item/started",
            json!({
                "threadId": "thread_child",
                "item": { "type": "fileChange", "id": "patch_child", "changes": [] }
            }),
            None,
            &mut indexes,
        );
        assert_eq!(child_tool[0].parent_tool_use_id(), Some("collab_1"));

        // Events on the root thread must remain at root level.
        let root_text = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_root",
                "itemId": "msg_root",
                "delta": "back to you"
            }),
            None,
            &mut indexes,
        );
        assert!(root_text[0].parent_tool_use_id().is_none());
    }

    #[test]
    fn non_spawn_collab_tools_do_not_register_a_subagent_thread() {
        // `send_input`, `resume_agent`, `wait`, `close_agent` are messages to
        // an existing sub-agent — they must NOT introduce a new nesting root
        // and they must keep their own tool name (no normalization to Agent).
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "collabAgentToolCall",
                    "id": "collab_send_1",
                    "tool": "send_input",
                    "receiverThreadId": "thread_child",
                    "prompt": "more details please"
                }
            }),
            None,
            &mut indexes,
        );

        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = started[0].stream_event()
        else {
            panic!("expected tool_use start");
        };
        let RuntimeContentBlock::ToolUse { name, .. } = block else {
            panic!("expected tool_use block");
        };
        assert_eq!(name, "send_input");

        // No subagent thread should have been registered for `thread_child`
        // by a non-spawn collab op.
        let child_text = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_child",
                "itemId": "msg",
                "delta": "anything"
            }),
            None,
            &mut indexes,
        );
        assert_eq!(child_text.len(), 1);
        assert!(child_text[0].parent_tool_use_id().is_none());
    }

    #[test]
    fn collab_spawn_agent_camelcase_normalizes_and_registers_subagent_threads() {
        // Real wire shape from Codex: the collab item uses camelCase
        // `tool: "spawnAgent"` and lists spawned threads under
        // `receiverThreadIds` and `agentsStates`. (Snake-case `spawn_agent`
        // appears on the raw OpenAI function_call; camelCase appears on the
        // normalized collabAgentToolCall.) Both must collapse to `Agent` and
        // both threadId-bearing fields must register sub-agent mappings.
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "collabAgentToolCall",
                    "id": "call_collab_1",
                    "tool": "spawnAgent",
                    "receiverThreadIds": ["thread_child_1"],
                    "agentsStates": {
                        "thread_child_1": { "status": "pendingInit", "message": null }
                    }
                }
            }),
            None,
            &mut indexes,
        );
        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = started[0].stream_event()
        else {
            panic!("expected tool_use start");
        };
        let RuntimeContentBlock::ToolUse { name, .. } = block else {
            panic!("expected tool_use block");
        };
        assert_eq!(name, "Agent");

        // Sanity: an event on the receiver thread now gets parent stamped.
        let child = notification_events(
            "item/agentMessage/delta",
            json!({
                "threadId": "thread_child_1",
                "itemId": "msg",
                "delta": "hi"
            }),
            None,
            &mut indexes,
        );
        assert_eq!(child[0].parent_tool_use_id(), Some("call_collab_1"));
    }

    #[test]
    fn wait_agent_completion_synthesizes_subagent_text_under_parent_block() {
        // Codex flow: spawn_agent returns immediately with `pendingInit`,
        // wait_agent's tool_result carries the sub-agent's full message
        // string under `agentsStates[threadId].message`. The codex adapter
        // must synthesize a child Text block tagged with the spawning
        // tool_use_id, otherwise the Agent block stays empty in the UI.
        let mut indexes = IndexState::default();
        // 1. spawn_agent function_call → emits Agent block + records pending
        notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call",
                    "call_id": "call_spawn_1",
                    "name": "spawn_agent",
                    "arguments": "{}"
                }
            }),
            None,
            &mut indexes,
        );
        // 2. spawn_agent function_call_output → registers child thread.
        notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call_output",
                    "call_id": "call_spawn_1",
                    "output": {
                        "agentsStates": {
                            "thread_child_1": { "status": "pendingInit", "message": null }
                        }
                    }
                }
            }),
            None,
            &mut indexes,
        );

        // 3. wait_agent function_call_output with the sub-agent's final
        //    message string → must produce a synthesized assistant text
        //    event tagged with parent_tool_use_id = call_spawn_1.
        let wait_events = notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call_output",
                    "call_id": "call_wait_1",
                    "output": {
                        "agentsStates": {
                            "thread_child_1": {
                                "status": "completed",
                                "message": "## Review\n- LGTM"
                            }
                        }
                    }
                }
            }),
            None,
            &mut indexes,
        );

        // The first event is the wait_agent's tool_result; subsequent events
        // are the synthesized sub-agent text(s).
        let synthesized = wait_events
            .iter()
            .find(|event| {
                event
                    .assistant_message()
                    .map(|msg| {
                        msg.content.iter().any(|cb| {
                            matches!(cb, RuntimeContentBlock::Text { text } if text.contains("LGTM"))
                        })
                    })
                    .unwrap_or(false)
            })
            .expect("expected synthesized sub-agent text event");
        assert_eq!(synthesized.parent_tool_use_id(), Some("call_spawn_1"));
        // Raw envelope must also carry parent_tool_use_id so the FE nests.
        assert_eq!(
            synthesized.raw_json()["parent_tool_use_id"],
            json!("call_spawn_1"),
        );
    }

    #[test]
    fn collab_completion_after_raw_function_call_does_not_emit_duplicate_agent_start() {
        // Reproduces the duplicate-Agent-block bug seen in the live DB
        // (rows 1668158 + 1668160 both being `tool_call` for the same
        // call_xH9 id). With the index intact across the two spawns, the
        // collab.item/completed for the second call must dedupe via
        // `has_index` and only emit a tool_result.
        let mut indexes = IndexState::default();
        for (cid, child) in [
            ("call_spawn_1", "thread_child_1"),
            ("call_spawn_2", "thread_child_2"),
        ] {
            notification_events(
                "rawResponseItem/completed",
                json!({
                    "threadId": "thread_root",
                    "item": {
                        "type": "function_call",
                        "call_id": cid,
                        "name": "spawn_agent",
                        "arguments": "{}"
                    }
                }),
                None,
                &mut indexes,
            );
            notification_events(
                "rawResponseItem/completed",
                json!({
                    "threadId": "thread_root",
                    "item": {
                        "type": "function_call_output",
                        "call_id": cid,
                        "output": {
                            "agentsStates": { child: { "status": "pendingInit" } }
                        }
                    }
                }),
                None,
                &mut indexes,
            );
        }

        // The second spawn's collab.item/completed must NOT emit a duplicate
        // Agent start — its index from the function_call should still be
        // present in `IndexState`.
        let collab = notification_events(
            "item/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "collabAgentToolCall",
                    "id": "call_spawn_2",
                    "tool": "spawnAgent",
                    "agentsStates": {
                        "thread_child_2": { "status": "pendingInit" }
                    }
                }
            }),
            None,
            &mut indexes,
        );

        let starts: Vec<_> = collab
            .iter()
            .filter(|event| {
                matches!(
                    event.stream_event(),
                    Some(RuntimeStreamEvent::ContentBlockStart { .. })
                )
            })
            .collect();
        assert!(
            starts.is_empty(),
            "duplicate Agent block emitted: {collab:?}",
        );
    }

    #[test]
    fn spawn_agent_raw_path_emits_prompt_as_first_child_text_block() {
        // Without this synthesis, the Agent block would render with no
        // visible "first message" — the user wouldn't see what the
        // sub-agent was actually asked to do. Codex never streams the
        // prompt as a separate event: it's only inside the spawn item.
        let mut indexes = IndexState::default();
        let events = notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call",
                    "call_id": "call_spawn_p",
                    "name": "spawn_agent",
                    "arguments": "{\"prompt\":\"Review the diff for regressions\"}"
                }
            }),
            None,
            &mut indexes,
        );
        // First event is the Agent tool_use start; second is the prompt
        // surfaced as an assistant Text block under the Agent.
        assert_eq!(events.len(), 2);
        let prompt_event = &events[1];
        assert_eq!(prompt_event.parent_tool_use_id(), Some("call_spawn_p"));
        let RuntimeContentBlock::Text { text } =
            &prompt_event.assistant_message().expect("assistant").content[0]
        else {
            panic!("expected text block, got {prompt_event:?}");
        };
        assert_eq!(text, "Review the diff for regressions");
    }

    #[test]
    fn spawn_agent_collab_path_uses_clean_input_and_skips_tool_result_dump() {
        // Repro of the bug where the Agent block's first child was the
        // entire collab item JSON. The fix surfaces only `description` +
        // `prompt` as the tool_use input, suppresses the tool_result, and
        // synthesizes the prompt as a Text child block.
        let mut indexes = IndexState::default();
        let prompt_text = "You are reviewing commit 218f10a.\nLook at packages/desktop changes.";
        let events = notification_events(
            "item/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "collabAgentToolCall",
                    "id": "call_collab_spawn",
                    "tool": "spawnAgent",
                    "model": "gpt-5.4",
                    "agentsStates": {
                        "thread_child_a": { "status": "pendingInit", "message": null }
                    },
                    "receiverThreadIds": ["thread_child_a"],
                    "status": "completed",
                    "prompt": prompt_text
                }
            }),
            None,
            &mut indexes,
        );

        // No tool_result is emitted for the spawn — the bookkeeping JSON
        // would have rendered as a literal dump inside the Agent block.
        assert!(
            events.iter().all(|event| event.user_message().is_none()),
            "spawn_agent collab item must not emit a tool_result: {events:?}",
        );

        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = events[0].stream_event()
        else {
            panic!("expected tool_use start, got {events:?}");
        };
        let RuntimeContentBlock::ToolUse { name, input, .. } = block else {
            panic!("expected tool_use block");
        };
        assert_eq!(name, "Agent");
        // Only the cleaned shape — no agentsStates / receiverThreadIds.
        assert_eq!(
            input["description"].as_str().expect("description"),
            "You are reviewing commit 218f10a."
        );
        assert_eq!(input["prompt"].as_str(), Some(prompt_text));
        assert!(input.get("agentsStates").is_none());
        assert!(input.get("receiverThreadIds").is_none());

        // The prompt is rendered as a child Text block via parent_tool_use_id.
        let prompt_child = events
            .iter()
            .find(|event| {
                event.parent_tool_use_id() == Some("call_collab_spawn")
                    && event.assistant_message().is_some()
            })
            .expect("expected prompt child block");
        let RuntimeContentBlock::Text { text } =
            &prompt_child.assistant_message().expect("assistant").content[0]
        else {
            panic!("expected text content block");
        };
        assert_eq!(text, prompt_text);
    }

    #[test]
    fn spawn_agent_dual_path_emits_prompt_only_once() {
        // Codex emits the same spawn through both the raw function_call and
        // the collabAgentToolCall paths. The prompt synthesis is keyed by
        // the tool_use id (= call_id) to dedupe across paths — otherwise
        // the user would see the prompt twice inside the Agent block.
        let mut indexes = IndexState::default();
        notification_events(
            "rawResponseItem/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "function_call",
                    "call_id": "call_spawn_dup",
                    "name": "spawn_agent",
                    "arguments": "{\"prompt\":\"Do the work\"}"
                }
            }),
            None,
            &mut indexes,
        );
        let collab = notification_events(
            "item/completed",
            json!({
                "threadId": "thread_root",
                "item": {
                    "type": "collabAgentToolCall",
                    "id": "call_spawn_dup",
                    "tool": "spawnAgent",
                    "prompt": "Do the work",
                    "agentsStates": {
                        "thread_child_b": { "status": "pendingInit" }
                    }
                }
            }),
            None,
            &mut indexes,
        );

        // The second-arriving path must not re-emit the prompt block.
        let prompt_blocks: Vec<_> = collab
            .iter()
            .filter(|event| {
                event
                    .assistant_message()
                    .map(|msg| {
                        msg.content.iter().any(|cb| {
                            matches!(cb, RuntimeContentBlock::Text { text } if text == "Do the work")
                        })
                    })
                    .unwrap_or(false)
            })
            .collect();
        assert!(
            prompt_blocks.is_empty(),
            "prompt was re-emitted on the collab path: {collab:?}",
        );
        // And the late path still must not surface a tool_result JSON dump.
        assert!(collab.iter().all(|event| event.user_message().is_none()));
    }

    #[test]
    fn null_mcp_error_is_successful_tool_result() {
        let events = map_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "mcpToolCall",
                    "id": "tool",
                    "server": "cadencr-session",
                    "tool": "mark_agent_done",
                    "error": null,
                    "result": { "ok": true }
                }
            }),
        );
        let message = events
            .iter()
            .find_map(RuntimeEvent::user_message)
            .expect("expected tool result");
        let RuntimeUserContentBlock::ToolResult { is_error, .. } = &message.content[0] else {
            panic!("expected tool result block");
        };
        assert!(!is_error);
    }
}
