use serde_json::Value;

use super::event_items::{stream_start_event, tool_result_event_with_error};
use super::event_json::thread_id;
use super::event_payloads::parse_raw_response_item_params;
use super::event_state::IndexState;
use super::event_subagents::{synthesize_subagent_messages, synthesize_subagent_prompt};
use super::raw_tool_names::{canonical_tool_name, function_tool_name, string_field};
use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEvent};

pub(super) fn raw_response_item_events(
    params: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let parsed = match parse_raw_response_item_params(params) {
        Ok(params) => params,
        Err(error) => {
            tracing::warn!(%error, "malformed Codex raw response item event");
            return Vec::new();
        }
    };
    let params = parsed.raw();
    let item = parsed.item.as_value();
    match parsed.item.item_type.as_str() {
        "function_call" => tool_call_event(
            &params,
            &item,
            function_tool_name(&item),
            args(&item, "arguments"),
            index_state,
        ),
        "custom_tool_call" => tool_call_event(
            &params,
            &item,
            canonical_tool_name(&string_field(&item, "name", "CustomTool")),
            args(&item, "input"),
            index_state,
        ),
        "tool_search_call" => tool_call_event(
            &params,
            &item,
            "ToolSearch".to_string(),
            tool_search_input(&item),
            index_state,
        ),
        "web_search_call" => tool_call_event(
            &params,
            &item,
            "WebSearch".to_string(),
            web_search_input(&item),
            index_state,
        ),
        "function_call_output" | "custom_tool_call_output" | "tool_search_output" => {
            let mut events: Vec<RuntimeEvent> = tool_result_event(&params, &item, index_state)
                .into_iter()
                .collect();
            // Codex delivers a sub-agent's full message synchronously inside
            // wait_agent / close_agent tool_results (under
            // `output.agentsStates[<threadId>].message`). Synthesize a
            // matching child block under the spawning Agent block — without
            // this, the Agent block stays empty even after the sub-agent has
            // produced output.
            if let Some(output) = item.get("output") {
                events.extend(synthesize_subagent_messages(&params, output, index_state));
            }
            events
        }
        _ => Vec::new(),
    }
}

fn tool_call_event(
    params: &Value,
    item: &Value,
    name: String,
    input: Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let id = response_item_id(params, item, name.as_str());
    if name == "Bash" {
        index_state.record_suppressed_raw_tool_item(&id);
        return Vec::new();
    }
    if index_state.has_index(&id) {
        return Vec::new();
    }
    if let Some(alias) = item.get("id").and_then(Value::as_str) {
        if index_state.has_index(alias) {
            let index = index_state.index_for(alias);
            let canonical_id = index_state.canonical_id(alias);
            index_state.alias_index(&id, &canonical_id, index);
            return Vec::new();
        }
    }
    // `spawn_agent` (normalized to `Agent`) is the entry point of a sub-agent;
    // we'll need to pair this call_id with its function_call_output to learn
    // the spawned threadId. Stamp the pending flag here, before the event is
    // emitted, so the result handler can identify the pairing.
    if name == "Agent" {
        index_state.record_pending_spawn_call(&id);
    }
    let sid = thread_id(params).to_string();
    let index = index_state.index_for(&id);
    if let Some(alias) = item.get("id").and_then(Value::as_str) {
        index_state.alias_index(alias, &id, index);
    }
    let is_agent = name == "Agent";
    let block = RuntimeContentBlock::ToolUse {
        id: id.clone(),
        name,
        input,
    };
    let mut events = vec![stream_start_event(&sid, index, block)];
    if is_agent {
        // Surface the prompt as the first child block under the Agent so
        // the user sees what the sub-agent was actually asked to do.
        // Idempotent vs. the collab path's matching emission via the
        // `injected_subagent_prompts` set.
        if let Some(prompt_event) = synthesize_subagent_prompt(&sid, &id, item, index_state) {
            events.push(prompt_event);
        }
    }
    events
}

fn tool_result_event(
    params: &Value,
    item: &Value,
    index_state: &mut IndexState,
) -> Option<RuntimeEvent> {
    let raw_id = item.get("call_id").and_then(Value::as_str)?;
    if index_state.has_suppressed_raw_tool_item(raw_id) {
        return None;
    }
    let id = index_state.canonical_id(raw_id);
    if !index_state.record_result(raw_id) {
        return None;
    }
    let content = item.get("output").cloned().unwrap_or(Value::Null);
    // If this call was a `spawn_agent` invocation, harvest the spawned
    // sub-agent threadIds from `output.agentsStates` keys so subsequent
    // events arriving on those threads can be tagged with the parent
    // `tool_use_id` (= our canonical `id`) by `notification_events`.
    if index_state.take_pending_spawn_call(raw_id) {
        register_spawned_subagent_threads(&content, &id, index_state);
        // Suppress the tool_result for spawn_agent: its content is just
        // the bookkeeping `agentsStates` blob (`pendingInit`, etc.) which
        // would render as a literal JSON dump under the Agent block. The
        // sub-agent's actual output lands later via wait_agent /
        // close_agent and is rendered by `synthesize_subagent_messages`.
        return None;
    }
    let is_error = item.get("status").and_then(Value::as_str) == Some("failed");
    Some(tool_result_event_with_error(params, id, content, is_error))
}

fn register_spawned_subagent_threads(
    output: &Value,
    parent_tool_use_id: &str,
    index_state: &mut IndexState,
) {
    let Some(agents_states) = output.get("agentsStates").and_then(Value::as_object) else {
        return;
    };
    for thread_id in agents_states.keys() {
        if thread_id.is_empty() {
            continue;
        }
        index_state.record_subagent_thread(thread_id, parent_tool_use_id);
    }
}

fn args(item: &Value, field: &str) -> Value {
    let mut input = match item.get(field) {
        Some(Value::String(raw)) if raw.trim().is_empty() => serde_json::json!({}),
        Some(Value::String(raw)) => {
            serde_json::from_str::<Value>(raw).unwrap_or_else(|_| serde_json::json!({ field: raw }))
        }
        Some(value) => value.clone(),
        None => serde_json::json!({}),
    };
    if let Value::Object(input_object) = &mut input {
        input_object.insert("raw_item".to_string(), item.clone());
    }
    input
}

fn tool_search_input(item: &Value) -> Value {
    let mut input = object_field(item, "arguments");
    input.insert(
        "execution".to_string(),
        item.get("execution").cloned().unwrap_or(Value::Null),
    );
    if let Some(status) = item.get("status").cloned() {
        input.insert("status".to_string(), status);
    }
    Value::Object(input)
}

fn web_search_input(item: &Value) -> Value {
    let mut input = serde_json::Map::new();
    if let Some(action) = item.get("action") {
        if let Some(query) = action.get("query").and_then(Value::as_str) {
            input.insert("query".to_string(), Value::String(query.to_string()));
        }
        if let Some(url) = action.get("url").and_then(Value::as_str) {
            input.insert("url".to_string(), Value::String(url.to_string()));
        }
        input.insert("action".to_string(), action.clone());
    }
    if let Some(status) = item.get("status").cloned() {
        input.insert("status".to_string(), status);
    }
    Value::Object(input)
}

fn object_field(item: &Value, field: &str) -> serde_json::Map<String, Value> {
    item.get(field)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn response_item_id(params: &Value, item: &Value, fallback_name: &str) -> String {
    item.get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            let turn_id = params
                .get("turnId")
                .and_then(Value::as_str)
                .unwrap_or_else(|| thread_id(params));
            format!("codex_raw_{turn_id}_{fallback_name}")
        })
}
