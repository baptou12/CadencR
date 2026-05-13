use serde_json::{json, Value};

use super::event_command_actions::{command_action_events, has_exploring_command_actions};
use super::event_inputs::command_input;
use super::event_items::{stream_start_event, tool_result_event_with_error};
use super::event_json::{input_json_delta_event, thread_id};
use super::event_state::IndexState;
use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEvent};

const BASH_OUTPUT_DELTA_KEY: &str = "__cadencr_output_delta";

pub(super) fn command_execution_events(
    params: Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = params.get("item") else {
        return Vec::new();
    };
    let id = item_id(item);
    if has_exploring_command_actions(&params) && !index_state.has_index(&id) {
        index_state.clear_delayed_command_input(&id);
        index_state.record_command_action_item(&id);
        return command_action_events(&params, completed, index_state);
    }
    if index_state.has_command_action_item(&id) {
        return Vec::new();
    }

    let input = command_input(item);
    if !completed {
        index_state.record_delayed_command_item(&id, input);
        return Vec::new();
    }
    index_state.clear_delayed_command_input(&id);
    completed_command_events(params, id, input, index_state)
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
    if index_state.has_command_action_item(&item_id) {
        return Vec::new();
    }

    let mut events = Vec::new();
    if !index_state.has_index(&item_id) {
        let Some(input) = index_state.take_delayed_command_input(&item_id) else {
            return Vec::new();
        };
        let block = RuntimeContentBlock::ToolUse {
            id: index_state.canonical_id(&item_id),
            name: "Bash".to_string(),
            input: running_command_input(&input),
        };
        events.push(stream_start_event(
            thread_id(&params),
            index_state.index_for(&item_id),
            block,
        ));
    }

    let partial_json = serde_json::to_string(&output_delta_input(&params, &item_id, index_state))
        .unwrap_or_else(|_| "{}".to_string());
    events.extend(input_json_delta_event(
        params,
        &item_id,
        partial_json,
        index_state,
    ));
    events
}

fn completed_command_events(
    params: Value,
    item_id: String,
    input: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let id = index_state.canonical_id(&item_id);
    let mut events = Vec::new();
    if !index_state.has_index(&item_id) {
        let block = RuntimeContentBlock::ToolUse {
            id: id.clone(),
            name: "Bash".to_string(),
            input: input.clone(),
        };
        events.push(stream_start_event(
            thread_id(&params),
            index_state.index_for(&item_id),
            block,
        ));
    }
    if index_state.record_result(&id) {
        events.push(command_result_event(&params, id, input));
    }
    events
}

fn command_result_event(params: &Value, id: String, input: Value) -> RuntimeEvent {
    let is_error = input.get("error").is_some_and(|error| !error.is_null());
    tool_result_event_with_error(params, id, input, is_error)
}

fn running_command_input(input: &Value) -> Value {
    let mut object = input.as_object().cloned().unwrap_or_default();
    object.insert("status".to_string(), json!("running"));
    Value::Object(object)
}

fn output_delta_input(params: &Value, item_id: &str, index_state: &mut IndexState) -> Value {
    let output = params
        .get("delta")
        .or_else(|| params.get("message"))
        .cloned()
        .or_else(|| aggregated_output_delta(params, item_id, index_state))
        .unwrap_or(Value::Null);
    let mut object = serde_json::Map::new();
    object.insert(BASH_OUTPUT_DELTA_KEY.to_string(), output);
    Value::Object(object)
}

fn aggregated_output_delta(
    params: &Value,
    item_id: &str,
    index_state: &mut IndexState,
) -> Option<Value> {
    let snapshot = params.get("aggregatedOutput").and_then(Value::as_str)?;
    Some(Value::String(
        index_state.command_output_delta_from_snapshot(item_id, snapshot),
    ))
}

fn item_id(item: &Value) -> String {
    item.get("id")
        .and_then(Value::as_str)
        .unwrap_or("codex_item")
        .to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::event_state::IndexState;
    use super::super::events::notification_events;
    use super::BASH_OUTPUT_DELTA_KEY;
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeContentDelta, RuntimeStreamEvent,
    };

    type TestEvent = crate::domain::agents::adapter::RuntimeEvent;

    fn tool_name(event: &crate::domain::agents::adapter::RuntimeEvent) -> Option<&str> {
        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = event.stream_event() else {
            return None;
        };
        match block {
            RuntimeContentBlock::ToolUse { name, .. } => Some(name.as_str()),
            _ => None,
        }
    }

    fn start_delayed_command(indexes: &mut IndexState) {
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "printf hello"
                }
            }),
            None,
            indexes,
        );
        assert!(started.is_empty());
    }

    fn output_delta(indexes: &mut IndexState, payload: serde_json::Value) -> Vec<TestEvent> {
        let mut params = serde_json::json!({ "threadId": "thread", "itemId": "cmd" });
        params
            .as_object_mut()
            .unwrap()
            .extend(payload.as_object().unwrap().clone());
        notification_events("item/commandExecution/outputDelta", params, None, indexes)
    }

    fn start_input(event: &TestEvent) -> &serde_json::Value {
        let Some(RuntimeStreamEvent::ContentBlockStart { block, .. }) = event.stream_event() else {
            panic!("expected Bash start");
        };
        let RuntimeContentBlock::ToolUse { input, .. } = block else {
            panic!("expected tool use block");
        };
        input
    }

    fn event_index(event: &TestEvent) -> u64 {
        match event.stream_event().expect("expected stream event") {
            RuntimeStreamEvent::ContentBlockStart { index, .. }
            | RuntimeStreamEvent::ContentBlockDelta { index, .. } => *index,
            RuntimeStreamEvent::ContentBlockStop { index } => *index,
            RuntimeStreamEvent::MessageStart { .. } | RuntimeStreamEvent::Other => {
                panic!("unexpected stream event")
            }
        }
    }

    fn input_delta(event: &TestEvent) -> serde_json::Value {
        let Some(RuntimeStreamEvent::ContentBlockDelta { delta, .. }) = event.stream_event() else {
            panic!("expected output delta");
        };
        let RuntimeContentDelta::InputJson { partial_json } = delta else {
            panic!("expected input_json_delta");
        };
        serde_json::from_str(partial_json).unwrap()
    }

    #[test]
    fn delayed_command_promotes_to_running_bash_on_first_output_delta() {
        let mut indexes = IndexState::default();
        start_delayed_command(&mut indexes);

        let delta = output_delta(&mut indexes, json!({ "delta": "hello" }));

        assert_eq!(delta.len(), 2);
        assert_eq!(tool_name(&delta[0]), Some("Bash"));
        let input = start_input(&delta[0]);
        assert_eq!(input["command"], json!("printf hello"));
        assert_eq!(input["status"], json!("running"));

        let parsed = input_delta(&delta[1]);
        assert_eq!(parsed[BASH_OUTPUT_DELTA_KEY], json!("hello"));
        assert!(parsed.get("aggregatedOutput").is_none());
        assert!(parsed.get("status").is_none());
    }

    #[test]
    fn multiple_output_deltas_update_the_promoted_bash_block() {
        let mut indexes = IndexState::default();
        start_delayed_command(&mut indexes);

        let first = output_delta(&mut indexes, json!({ "delta": "hello" }));
        let second = output_delta(&mut indexes, json!({ "delta": " world" }));

        assert_eq!(second.len(), 1);
        assert_eq!(event_index(&first[0]), event_index(&first[1]));
        assert_eq!(event_index(&first[0]), event_index(&second[0]));
        assert_eq!(
            input_delta(&second[0])[BASH_OUTPUT_DELTA_KEY],
            json!(" world")
        );
    }

    #[test]
    fn aggregated_output_fallback_emits_only_new_suffix() {
        let mut indexes = IndexState::default();
        start_delayed_command(&mut indexes);

        output_delta(&mut indexes, json!({ "aggregatedOutput": "hello" }));
        let second = output_delta(&mut indexes, json!({ "aggregatedOutput": "hello world" }));

        assert_eq!(
            input_delta(&second[0])[BASH_OUTPUT_DELTA_KEY],
            json!(" world")
        );
    }

    #[test]
    fn promoted_command_completion_emits_result_without_duplicate_bash_start() {
        let mut indexes = IndexState::default();
        start_delayed_command(&mut indexes);
        let delta = output_delta(&mut indexes, json!({ "delta": "hello" }));
        assert_eq!(delta.len(), 2);

        let completed = notification_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "printf hello",
                    "aggregatedOutput": "hello",
                    "status": "completed"
                }
            }),
            None,
            &mut indexes,
        );

        assert_eq!(completed.len(), 1);
        assert!(completed[0].user_message().is_some());
        assert!(completed[0].stream_event().is_none());
    }

    #[test]
    fn unstreamed_command_with_late_actions_still_emits_virtual_tools() {
        let mut indexes = IndexState::default();
        start_delayed_command(&mut indexes);

        let completed = notification_events(
            "item/completed",
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

        assert_eq!(completed.len(), 1);
        assert_eq!(tool_name(&completed[0]), Some("Read"));
    }

    #[test]
    fn streamed_command_with_late_actions_keeps_bash_result() {
        let mut indexes = IndexState::default();
        start_delayed_command(&mut indexes);
        output_delta(&mut indexes, json!({ "delta": "hello" }));

        let completed = notification_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'",
                    "commandActions": [{ "type": "read", "path": "/etc/hosts" }],
                    "aggregatedOutput": "hello"
                }
            }),
            None,
            &mut indexes,
        );

        assert_eq!(completed.len(), 1);
        assert!(completed[0].user_message().is_some());
        assert!(completed[0].stream_event().is_none());
    }

    #[test]
    fn output_delta_without_known_command_stays_suppressed() {
        let mut indexes = IndexState::default();

        let delta = notification_events(
            "item/commandExecution/outputDelta",
            json!({
                "threadId": "thread",
                "itemId": "cmd",
                "delta": "hello",
                "aggregatedOutput": "hello"
            }),
            None,
            &mut indexes,
        );

        assert!(delta.is_empty());
    }
}
