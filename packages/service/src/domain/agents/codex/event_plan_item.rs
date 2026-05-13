use serde_json::Value;

use super::event_items::stream_start_event;
use super::event_json::{metadata, thread_id};
use super::event_state::IndexState;
use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEvent, RuntimeEventKind};

pub(super) fn plan_item(
    params: Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = params.get("item") else {
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

fn item_id(item: &Value) -> String {
    item.get("id")
        .and_then(Value::as_str)
        .unwrap_or("codex_item")
        .to_string()
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
