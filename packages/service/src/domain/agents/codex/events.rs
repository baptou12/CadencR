use serde_json::Value;

use super::event_items::{
    command_output_delta_event, file_patch_updated_event, item_events, tool_json_delta_event,
    IndexState,
};
use super::event_json::{compact_event, metadata, stream_event_raw, thread_id};
use super::event_plan::{plan_delta_events, plan_updated_event};
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
    match method {
        "turn/started" => turn_started_event(params, model).into_iter().collect(),
        "turn/completed" => vec![result_event(params)],
        "thread/tokenUsage/updated" => vec![usage_event(params)],
        "thread/compacted" => vec![compact_event(params)],
        "turn/plan/updated" => vec![plan_updated_event(params, index_state)],
        "item/plan/delta" => plan_delta_events(params),
        "item/commandExecution/outputDelta" | "command/exec/outputDelta" => {
            command_output_delta_event(params, index_state)
        }
        "item/fileChange/outputDelta" => tool_json_delta_event(params, "output", index_state),
        "item/fileChange/patchUpdated" => file_patch_updated_event(params, index_state),
        "item/mcpToolCall/progress" => tool_json_delta_event(params, "progress", index_state),
        "item/started" => item_events(params, false, index_state),
        "item/completed" => item_events(params, true, index_state),
        "item/agentMessage/delta" => text_delta_event(params, model, index_state),
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            reasoning_delta_event(params, model, index_state)
        }
        _ => Vec::new(),
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
    use super::super::event_items::IndexState;
    use super::notification_events;
    use crate::domain::agents::adapter::{
        RuntimeEvent, RuntimeStreamEvent, RuntimeUserContentBlock,
    };
    use serde_json::json;

    fn map_events(method: &str, params: serde_json::Value) -> Vec<RuntimeEvent> {
        let mut indexes = IndexState::default();
        notification_events(method, params, None, &mut indexes)
    }

    #[test]
    fn tool_completion_only_emits_result() {
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
        assert_eq!(events.len(), 1);
        assert!(events[0].user_message().is_some());
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
    fn command_output_delta_prefers_aggregated_output() {
        let events = map_events(
            "item/commandExecution/outputDelta",
            json!({
                "threadId": "thread",
                "itemId": "cmd",
                "delta": "new chunk",
                "aggregatedOutput": "old\nnew chunk"
            }),
        );

        let Some(RuntimeStreamEvent::ContentBlockDelta { delta, .. }) = events[0].stream_event()
        else {
            panic!("expected content delta");
        };
        let crate::domain::agents::adapter::RuntimeContentDelta::InputJson { partial_json } = delta
        else {
            panic!("expected input json delta");
        };
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(partial_json).expect("valid json"),
            json!({ "output": "old\nnew chunk" })
        );
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
    fn plan_delta_does_not_emit_hidden_todowrite_spam() {
        let events = map_events(
            "item/plan/delta",
            json!({
                "threadId": "thread",
                "itemId": "plan_1",
                "delta": "chunk"
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
    fn null_mcp_error_is_successful_tool_result() {
        let events = map_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "mcpToolCall",
                    "id": "tool",
                    "server": "cadence-plan",
                    "tool": "show_plan",
                    "error": null,
                    "result": { "ok": true }
                }
            }),
        );
        let message = events[0].user_message().expect("expected tool result");
        let RuntimeUserContentBlock::ToolResult { is_error, .. } = &message.content[0] else {
            panic!("expected tool result block");
        };
        assert!(!is_error);
    }
}
