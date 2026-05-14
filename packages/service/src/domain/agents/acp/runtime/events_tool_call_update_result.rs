use super::events_stream_blocks::EventIndexer;
use super::events_tool_call_result::{tool_result_event, tool_result_event_from_raw_output};
use super::provider_hooks::AcpProviderHooks;
use crate::domain::agents::adapter::{RuntimeEvent, RuntimeEventMetadata};
use serde_json::Value;

pub fn push_tool_result(
    body: &Value,
    tool_call_id: &str,
    status: &str,
    parent: Option<String>,
    metadata: RuntimeEventMetadata,
    hooks: &dyn AcpProviderHooks,
    indexer: &EventIndexer,
    events: &mut Vec<RuntimeEvent>,
) {
    let suppressed = indexer
        .tool_name_for(tool_call_id)
        .map(|name| hooks.suppresses_raw_output(name))
        .unwrap_or(false);
    if suppressed {
        return;
    }
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
