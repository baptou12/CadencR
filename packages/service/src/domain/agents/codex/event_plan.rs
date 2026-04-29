use serde_json::Value;

use super::event_inputs::plan_todos;
use super::event_items::IndexState;
use super::event_json::{metadata, stream_event_raw, thread_id};
use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeStreamEvent,
};

pub(super) fn plan_updated_event(params: Value, index_state: &mut IndexState) -> RuntimeEvent {
    let sid = thread_id(&params).to_string();
    let turn_id = params
        .get("turnId")
        .and_then(Value::as_str)
        .unwrap_or("turn");
    let block_id = format!("codex_plan_{turn_id}");
    let todos = plan_todos(&params);
    let already_started = index_state.has_index(&block_id);
    let index = index_state.index_for(&block_id);

    if already_started {
        return stream_delta_event(&sid, index, todos);
    }

    let block = RuntimeContentBlock::ToolUse {
        id: block_id,
        name: "TodoWrite".to_string(),
        input: serde_json::json!({ "todos": todos }),
    };
    stream_start_event(&sid, index, block)
}

fn stream_start_event(session_id: &str, index: u32, block: RuntimeContentBlock) -> RuntimeEvent {
    let event = RuntimeStreamEvent::ContentBlockStart { index, block };
    RuntimeEvent::new(
        metadata(session_id, stream_event_raw(session_id, None, &event)),
        RuntimeEventKind::StreamEvent {
            event,
            parent_tool_use_id: None,
        },
    )
}

fn stream_delta_event(session_id: &str, index: u32, todos: Value) -> RuntimeEvent {
    let partial_json = serde_json::to_string(&serde_json::json!({ "todos": todos }))
        .unwrap_or_else(|_| "{}".to_string());
    let event = RuntimeStreamEvent::ContentBlockDelta {
        index,
        delta: RuntimeContentDelta::InputJson { partial_json },
    };
    RuntimeEvent::new(
        metadata(session_id, stream_event_raw(session_id, None, &event)),
        RuntimeEventKind::StreamEvent {
            event,
            parent_tool_use_id: None,
        },
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{plan_updated_event, IndexState};
    use crate::domain::agents::adapter::{RuntimeContentDelta, RuntimeStreamEvent};

    #[test]
    fn repeated_plan_updates_reuse_block_index_with_delta() {
        let mut index_state = IndexState::default();
        let params = json!({
            "threadId": "thread_1",
            "turnId": "turn_1",
            "plan": [{ "step": "Inspect scripts", "status": "inProgress" }]
        });

        let first = plan_updated_event(params.clone(), &mut index_state);
        let second = plan_updated_event(params, &mut index_state);

        let Some(RuntimeStreamEvent::ContentBlockStart {
            index: first_index, ..
        }) = first.stream_event()
        else {
            panic!("expected first plan event to start the block");
        };
        let Some(RuntimeStreamEvent::ContentBlockDelta {
            index: second_index,
            delta: RuntimeContentDelta::InputJson { partial_json },
        }) = second.stream_event()
        else {
            panic!("expected repeated plan event to update the block");
        };

        assert_eq!(first_index, second_index);
        assert!(partial_json.contains("Inspect scripts"));
    }
}
