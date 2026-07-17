use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use super::events_stream_blocks::{stream_delta_event, EventIndexer};
use super::events_tool_call_metadata::{is_empty_value, merge_tool_input};
use crate::domain::agents::adapter::{
    RuntimeContentDelta, RuntimeError, RuntimeEvent, RuntimePermissionRequest,
};

/// A permission request can carry metadata that was missing from the original
/// ACP `tool_call`. Feed that late input back into the same stream block before
/// the request is answered so the rendered and persisted tool call is repaired.
pub(super) async fn emit_permission_tool_update(
    permission: &RuntimePermissionRequest,
    session_id: Option<&str>,
    indexer: &Arc<Mutex<EventIndexer>>,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) {
    let Some(tool_use_id) = permission.tool_use_id.as_deref() else {
        return;
    };
    let event = {
        let mut indexer = indexer.lock().expect("EventIndexer poisoned");
        let Some(recorded_name) = indexer.tool_name_for(tool_use_id) else {
            return;
        };
        let name_changed = recorded_name != permission.tool_name;
        let (merged, input_changed) = {
            let recorded_input = indexer.tool_input_for(tool_use_id);
            let merged = merge_tool_input(recorded_input, permission.tool_input.clone());
            let input_changed = recorded_input != Some(&merged);
            (merged, input_changed)
        };
        if name_changed {
            indexer.record_tool_name(tool_use_id, &permission.tool_name);
        }
        if !input_changed || is_empty_value(&merged) {
            return;
        }
        indexer.record_tool_input(tool_use_id, merged.clone());
        let partial_json =
            serde_json::to_string(&merged).expect("serializing a serde_json::Value cannot fail");
        let index = indexer.index_for_tool(tool_use_id);
        stream_delta_event(
            index,
            RuntimeContentDelta::InputJson { partial_json },
            session_id,
        )
    };
    if tx.send(Ok(event)).await.is_err() {
        tracing::debug!("runtime channel closed before late permission tool metadata was emitted");
    }
}
