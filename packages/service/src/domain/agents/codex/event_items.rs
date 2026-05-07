use serde_json::Value;

use super::event_command_actions::{command_action_events, has_exploring_command_actions};
use super::event_inputs::{
    collab_tool_input, collab_tool_name, command_input, dynamic_tool_input, dynamic_tool_name,
    file_input, patch_from_changes,
};
use super::event_json::{compact_event, metadata, stream_event_raw, thread_id, user_raw};
use super::event_mcp_items::mcp_tool_item;
use super::event_state::IndexState;
use super::event_subagents::{
    agent_tool_input, synthesize_subagent_messages, synthesize_subagent_prompt,
};
use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeStreamEvent,
    RuntimeUserContentBlock, RuntimeUserMessage,
};

fn item(params: &Value) -> Option<&Value> {
    params.get("item")
}

pub(super) fn item_type(params: &Value) -> Option<&str> {
    item(params)
        .and_then(|item| item.get("type"))
        .and_then(Value::as_str)
}

fn item_id(item: &Value) -> String {
    item.get("id")
        .and_then(Value::as_str)
        .unwrap_or("codex_item")
        .to_string()
}

pub(super) fn item_events(
    params: Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = item(&params) else {
        return Vec::new();
    };
    match item_type(&params) {
        Some("agentMessage") => text_item(params, completed, index_state),
        // Codex has emitted both casings while the plan item API is settling.
        Some("plan" | "Plan") => plan_item(params, completed, index_state),
        Some("reasoning") => thinking_item(params, completed, index_state),
        Some("commandExecution") => {
            let id = item_id(item);
            if has_exploring_command_actions(&params) {
                index_state.record_command_action_item(&id);
                return command_action_events(&params, completed, index_state);
            }
            if index_state.has_command_action_item(&id) {
                return Vec::new();
            }
            if !completed {
                index_state.record_delayed_command_item(&id);
                return Vec::new();
            }
            tool_item(params, "Bash", command_input, completed, index_state)
        }
        Some("fileChange") => tool_item(params, "ApplyPatch", file_input, completed, index_state),
        Some("mcpToolCall") => mcp_tool_item(params, completed, index_state),
        Some("dynamicToolCall") => {
            let name = dynamic_tool_name(item);
            tool_item(params, &name, dynamic_tool_input, completed, index_state)
        }
        Some("collabAgentToolCall") => {
            let name = collab_tool_name(item);
            // Record the new sub-agent thread BEFORE delegating, so that any
            // events that arrive for the spawned thread between `item/started`
            // and `item/completed` get their `parent_tool_use_id` stamped via
            // `notification_events`' post-processing.
            record_subagent_thread_for_collab_call(item, &name, index_state);
            if name == "Agent" {
                return spawn_agent_collab_events(params, completed, index_state);
            }
            // Snapshot params/item before consuming `params` for `tool_item`
            // so we can extract any agentsStates messages on completion (the
            // wait/close collab tool_results carry the sub-agent's final
            // output here, not on a separate stream).
            let params_snapshot = if completed {
                Some(params.clone())
            } else {
                None
            };
            let mut events = tool_item(params, &name, collab_tool_input, completed, index_state);
            if let Some(params_snapshot) = params_snapshot {
                if let Some(item_snapshot) = params_snapshot.get("item") {
                    events.extend(synthesize_subagent_messages(
                        &params_snapshot,
                        item_snapshot,
                        index_state,
                    ));
                }
            }
            events
        }
        Some("contextCompaction") => {
            if completed {
                vec![compact_event(params)]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

pub(super) fn tool_json_delta_event(
    params: Value,
    field: &str,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item_id) = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return Vec::new();
    };
    let value = params
        .get("delta")
        .or_else(|| params.get("message"))
        .cloned()
        .unwrap_or(Value::Null);
    let partial_json = serde_json::to_string(&serde_json::json!({ field: value }))
        .unwrap_or_else(|_| "{}".to_string());
    input_json_delta_event(params, &item_id, partial_json, index_state)
}

pub(super) fn command_output_delta_event(
    params: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item_id) = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return Vec::new();
    };
    if index_state.has_command_action_item(&item_id)
        || index_state.has_delayed_command_item(&item_id)
        || !index_state.has_index(&item_id)
    {
        return Vec::new();
    }
    let output = params
        .get("aggregatedOutput")
        .or_else(|| params.get("delta"))
        .or_else(|| params.get("message"))
        .cloned()
        .unwrap_or(Value::Null);
    let partial_json = serde_json::to_string(&serde_json::json!({ "output": output }))
        .unwrap_or_else(|_| "{}".to_string());
    input_json_delta_event(params, &item_id, partial_json, index_state)
}

pub(super) fn file_patch_updated_event(
    params: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item_id) = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return Vec::new();
    };
    let patch_text = patch_from_changes(params.get("changes"));
    let input = serde_json::json!({
        "patch_text": patch_text.clone(),
        "patch": patch_text,
        "changes": params.get("changes").cloned().unwrap_or(Value::Null),
    });
    let partial_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
    input_json_delta_event(params, &item_id, partial_json, index_state)
}

fn text_item(params: Value, completed: bool, index_state: &mut IndexState) -> Vec<RuntimeEvent> {
    content_item(
        params,
        RuntimeContentBlock::Text {
            text: String::new(),
        },
        completed,
        index_state,
    )
}

fn thinking_item(
    params: Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    content_item(
        params,
        RuntimeContentBlock::Thinking {
            thinking: String::new(),
        },
        completed,
        index_state,
    )
}

fn plan_item(params: Value, completed: bool, index_state: &mut IndexState) -> Vec<RuntimeEvent> {
    let Some(item) = item(&params) else {
        return Vec::new();
    };
    if !completed {
        return Vec::new();
    }
    let text = item.get("text").and_then(Value::as_str).unwrap_or("Plan");
    let sid = thread_id(&params).to_string();
    let id = format!("codex_plan_approval_{}", item_id(item));
    let input = serde_json::json!({ "plan": text });
    let block = RuntimeContentBlock::ToolUse {
        id: id.clone(),
        name: "ExitPlanMode".to_string(),
        input: input.clone(),
    };
    vec![
        stream_start_event(&sid, index_state.index_for(&id), block),
        plan_permission_request_event(&sid, &id, input),
    ]
}

fn content_item(
    params: Value,
    block: RuntimeContentBlock,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = item(&params) else {
        return Vec::new();
    };
    let sid = thread_id(&params).to_string();
    let index = index_state.index_for(&item_id(item));
    let event = if completed {
        RuntimeStreamEvent::ContentBlockStop { index }
    } else {
        RuntimeStreamEvent::ContentBlockStart { index, block }
    };
    vec![RuntimeEvent::new(
        metadata(&sid, stream_event_raw(&sid, None, &event)),
        RuntimeEventKind::StreamEvent {
            event,
            parent_tool_use_id: None,
        },
    )]
}

fn tool_item(
    params: Value,
    name: &str,
    input_fn: fn(&Value) -> Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let input = {
        let Some(item) = item(&params) else {
            return Vec::new();
        };
        input_fn(item)
    };
    tool_item_with_input(params, name, input, completed, index_state)
}

fn tool_item_with_input(
    params: Value,
    name: &str,
    input: Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = item(&params) else {
        return Vec::new();
    };
    let item_id = item_id(item);
    let id = index_state.canonical_id(&item_id);
    if completed {
        let mut events = Vec::new();
        if !index_state.has_index(&item_id) {
            let sid = thread_id(&params).to_string();
            let block = RuntimeContentBlock::ToolUse {
                id: id.clone(),
                name: name.to_string(),
                input: input.clone(),
            };
            events.push(stream_start_event(
                &sid,
                index_state.index_for(&item_id),
                block,
            ));
        }
        if index_state.record_result(&id) {
            events.push(tool_result_event(&params, id, input));
        }
        return events;
    }
    if index_state.has_index(&item_id) {
        return Vec::new();
    }
    let sid = thread_id(&params).to_string();
    let block = RuntimeContentBlock::ToolUse {
        id: id.clone(),
        name: name.to_string(),
        input,
    };
    vec![stream_start_event(
        &sid,
        index_state.index_for(&item_id),
        block,
    )]
}

pub(super) fn stream_start_event(
    session_id: &str,
    index: u64,
    block: RuntimeContentBlock,
) -> RuntimeEvent {
    let event = RuntimeStreamEvent::ContentBlockStart { index, block };
    RuntimeEvent::new(
        metadata(session_id, stream_event_raw(session_id, None, &event)),
        RuntimeEventKind::StreamEvent {
            event,
            parent_tool_use_id: None,
        },
    )
}

fn plan_permission_request_event(session_id: &str, request_id: &str, input: Value) -> RuntimeEvent {
    RuntimeEvent::new(
        metadata(
            session_id,
            serde_json::json!({
                "type": "codex_permission_request",
                "request_id": request_id,
                "tool_use_id": request_id,
                "tool_name": "ExitPlanMode",
                "tool_input": input,
                "description": "Plan is ready for approval",
                "preview": null,
            }),
        ),
        RuntimeEventKind::Other,
    )
}

fn tool_result_event(params: &Value, id: String, input: Value) -> RuntimeEvent {
    let is_error = input.get("error").is_some_and(|error| !error.is_null());
    tool_result_event_with_error(params, id, input, is_error)
}

pub(super) fn tool_result_event_with_error(
    params: &Value,
    id: String,
    content: Value,
    is_error: bool,
) -> RuntimeEvent {
    let sid = thread_id(params).to_string();
    RuntimeEvent::new(
        metadata(
            &sid,
            user_raw(
                &sid,
                None,
                vec![serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "is_error": is_error,
                    "content": content,
                })],
            ),
        ),
        RuntimeEventKind::UserMessage {
            message: RuntimeUserMessage {
                content: vec![RuntimeUserContentBlock::ToolResult {
                    tool_use_id: Some(id),
                    is_error,
                    content,
                }],
            },
            parent_tool_use_id: None,
        },
    )
}

/// Specialized handler for the `spawn_agent` collab item. Diverges from
/// the generic `tool_item` path in two ways:
///   1. The tool_use input is the cleaned `{description, prompt}` shape so
///      the Agent block's header is meaningful and we don't ship a JSON
///      bag of bookkeeping fields to the FE.
///   2. We deliberately suppress the tool_result event. Its content would
///      be the raw item (`agentsStates`, `senderThreadId`, ...) which the
///      frontend's `AgentResultBlock` can't decode as content blocks and
///      would dump as a literal JSON string inside the Agent block. The
///      sub-agent's actual output flows in later via wait_agent /
///      close_agent and is rendered by `synthesize_subagent_messages`.
///
/// On completion we still mark the canonical id as "result recorded" so a
/// late-arriving raw `function_call_output` for the same call_id can't
/// re-emit the suppressed JSON dump through the raw path.
fn spawn_agent_collab_events(
    params: Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = item(&params) else {
        return Vec::new();
    };
    let item_id = item_id(item);
    let canonical_id = index_state.canonical_id(&item_id);
    let session_id = thread_id(&params).to_string();

    let mut events = Vec::new();
    if !index_state.has_index(&item_id) {
        let block = RuntimeContentBlock::ToolUse {
            id: canonical_id.clone(),
            name: "Agent".to_string(),
            input: agent_tool_input(item),
        };
        events.push(stream_start_event(
            &session_id,
            index_state.index_for(&item_id),
            block,
        ));
    }
    if let Some(prompt_event) =
        synthesize_subagent_prompt(&session_id, &canonical_id, item, index_state)
    {
        events.push(prompt_event);
    }
    if completed {
        // Lock the canonical id so a late raw function_call_output (which
        // arrives on the same call_id) can't sneak the bookkeeping JSON
        // back in through the raw path's tool_result emission.
        index_state.record_result(&canonical_id);
        events.extend(synthesize_subagent_messages(&params, item, index_state));
    }
    events
}

/// When a `collabAgentToolCall` is the `spawn_agent` op (normalized to
/// `Agent`), record every spawned threadId under the spawning call's
/// `tool_use_id`. The codex docs reference `newThreadId` as the canonical
/// field, but the actual wire JSON uses `receiverThreadIds` (array) plus
/// `agentsStates` (object whose keys are threadIds). We harvest from all
/// three so we don't break if Codex's schema shifts.
fn record_subagent_thread_for_collab_call(
    item: &Value,
    canonical_tool_name: &str,
    index_state: &mut IndexState,
) {
    if canonical_tool_name != "Agent" {
        return;
    }
    let raw_id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("codex_item");
    // Pre-resolve the canonical id so every harvested threadId points at
    // the same tool_use_id the frontend uses to nest child blocks.
    let canonical = index_state.canonical_id(raw_id);

    if let Some(new_thread_id) = item.get("newThreadId").and_then(Value::as_str) {
        index_state.record_subagent_thread(new_thread_id, &canonical);
    }
    if let Some(receivers) = item.get("receiverThreadIds").and_then(Value::as_array) {
        for receiver in receivers {
            if let Some(tid) = receiver.as_str() {
                index_state.record_subagent_thread(tid, &canonical);
            }
        }
    }
    if let Some(states) = item.get("agentsStates").and_then(Value::as_object) {
        for tid in states.keys() {
            index_state.record_subagent_thread(tid, &canonical);
        }
    }
}

fn input_json_delta_event(
    params: Value,
    item_id: &str,
    partial_json: String,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let event = RuntimeStreamEvent::ContentBlockDelta {
        index: index_state.index_for(item_id),
        delta: RuntimeContentDelta::InputJson { partial_json },
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
