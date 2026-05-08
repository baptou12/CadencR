//! ACP `plan` SessionUpdate → synthetic `TodoWrite` assistant message.
//!
//! OpenCode is doubly chatty here: it sends a `tool_call(todowrite)` (whose
//! `tool_call_update.rawInput.todos` we already surface via the structured-
//! input delta in `events_tool_call_input`) AND a `session/update plan`
//! carrying the same entries. Suppress the plan path in that case so a
//! single TodoWrite block is produced.
//!
//! For ACP agents that only emit `plan` (no TodoWrite tool_call), we still
//! synthesise an `AssistantMessage` with a `TodoWrite` tool_use so the FE
//! renders it identically — no provider-specific FE branching.

use serde_json::{json, Value};

use crate::domain::agents::adapter::{
    RuntimeAssistantMessage, RuntimeContentBlock, RuntimeEvent, RuntimeEventKind,
    RuntimeEventMetadata,
};
use crate::domain::agents::opencode::acp::events::{EventIndexer, MappedUpdate};

pub(super) fn map_plan(
    body: &Value,
    indexer: &mut EventIndexer,
    active_model: Option<&str>,
    metadata: RuntimeEventMetadata,
) -> MappedUpdate {
    if indexer.last_todowrite_call_id.is_some() {
        return MappedUpdate { events: vec![] };
    }
    let todos: Vec<Value> = body
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().map(normalize_plan_entry).collect())
        .unwrap_or_default();
    let synthetic_id = format!("acp-plan-{}", indexer.next_anonymous());
    let model = active_model.map(ToOwned::to_owned);
    MappedUpdate {
        events: vec![RuntimeEvent::new(
            metadata,
            RuntimeEventKind::AssistantMessage {
                message: RuntimeAssistantMessage {
                    model,
                    content: vec![RuntimeContentBlock::ToolUse {
                        id: synthetic_id,
                        name: "TodoWrite".to_string(),
                        input: json!({ "todos": todos }),
                    }],
                },
                parent_tool_use_id: None,
            },
        )],
    }
}

fn normalize_plan_entry(entry: &Value) -> Value {
    let content = entry
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let status = entry
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending")
        .to_string();
    let active_form = entry
        .get("activeForm")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| content.clone());
    json!({ "content": content, "status": status, "activeForm": active_form })
}

#[cfg(test)]
mod tests {
    use super::map_plan;
    use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEventMetadata};
    use crate::domain::agents::opencode::acp::events::EventIndexer;
    use serde_json::json;

    #[test]
    fn map_plan_normalizes_entries_into_frontend_todowrite_shape() {
        let mut idx = EventIndexer::default();
        let result = map_plan(
            &json!({
                "entries": [
                    { "content": "step 1", "priority": "high", "status": "pending" },
                    { "content": "step 2", "priority": "low", "status": "in_progress" }
                ]
            }),
            &mut idx,
            Some("opencode/test"),
            RuntimeEventMetadata::default(),
        );
        let assistant = result.events[0]
            .assistant_message()
            .expect("assistant message");
        match &assistant.content[0] {
            RuntimeContentBlock::ToolUse { name, input, .. } => {
                assert_eq!(name, "TodoWrite");
                let todos = input["todos"].as_array().expect("todos array");
                assert_eq!(todos.len(), 2);
                assert_eq!(todos[0]["content"], "step 1");
                assert_eq!(todos[0]["status"], "pending");
                assert_eq!(todos[0]["activeForm"], "step 1");
                assert_eq!(todos[1]["status"], "in_progress");
                assert!(input.get("entries").is_none());
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn map_plan_with_no_entries_produces_an_empty_todo_list() {
        let mut idx = EventIndexer::default();
        let result = map_plan(&json!({}), &mut idx, None, RuntimeEventMetadata::default());
        let assistant = result.events[0].assistant_message().unwrap();
        match &assistant.content[0] {
            RuntimeContentBlock::ToolUse { input, .. } => {
                assert_eq!(input["todos"].as_array().unwrap().len(), 0);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn map_plan_is_suppressed_when_a_todowrite_tool_call_was_already_recorded() {
        // OpenCode sends BOTH `tool_call(todowrite)` and `session/update
        // plan` for the same payload; the tool_call_update path already
        // emits the structured-input delta carrying `todos[]`. Without
        // this suppression the FE renders two TodoWrite blocks for one
        // logical plan write.
        let mut idx = EventIndexer::default();
        idx.record_tool_name("call-1", "TodoWrite");
        let result = map_plan(
            &json!({
                "entries": [{ "content": "Step", "status": "pending", "priority": "high" }]
            }),
            &mut idx,
            None,
            RuntimeEventMetadata::default(),
        );
        assert!(result.events.is_empty());
    }
}
