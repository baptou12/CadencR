mod notification;
mod plan;
mod question;

use serde_json::Value;

use crate::domain::agents::acp::runtime::provider_hooks::AcpExtensionRequest;
use crate::domain::agents::adapter::{
    RuntimeAssistantMessage, RuntimeContentBlock, RuntimeEvent, RuntimeEventKind,
    RuntimeEventMetadata, RuntimePermissionDecision, RuntimePermissionOption,
    RuntimePermissionResponse,
};

pub(super) fn extension_request(
    request_id: &str,
    method: &str,
    params: &Value,
    metadata: RuntimeEventMetadata,
) -> Option<AcpExtensionRequest> {
    match method {
        "cursor/ask_question" => Some(question::request(request_id, params, metadata)),
        "cursor/create_plan" => Some(plan::request(request_id, params, metadata)),
        _ => None,
    }
}

pub(super) fn extension_notification(
    method: &str,
    params: &Value,
    metadata: RuntimeEventMetadata,
) -> Option<Vec<RuntimeEvent>> {
    notification::events(method, params, metadata)
}

pub(super) fn server_request_response(
    method: &str,
    params: &Value,
    response: &RuntimePermissionResponse,
) -> Option<Value> {
    match method {
        "cursor/create_plan" => Some(plan::response(response)),
        "cursor/ask_question" => Some(question::response(params, response)),
        _ => None,
    }
}

pub(super) fn server_request_followup(
    method: &str,
    response: &RuntimePermissionResponse,
) -> Option<Value> {
    (method == "cursor/create_plan"
        && matches!(
            response.decision,
            RuntimePermissionDecision::AllowOnce
                | RuntimePermissionDecision::AllowFuture
                | RuntimePermissionDecision::AllowForSession
        ))
    .then(|| Value::String("Plan approved. Proceed with execution.".to_string()))
}

pub(super) fn gate_options(allow_label: &str) -> Vec<RuntimePermissionOption> {
    vec![
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::AllowOnce,
            option_id: None,
            label: allow_label.to_string(),
            description: "Continue Cursor with this response".to_string(),
            collect_feedback: false,
        },
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::Deny,
            option_id: None,
            label: "Reject".to_string(),
            description: "Keep the session waiting for a different direction".to_string(),
            collect_feedback: true,
        },
    ]
}

pub(super) fn assistant_tool_event(
    params: &Value,
    name: &str,
    input: Value,
    metadata: RuntimeEventMetadata,
) -> RuntimeEvent {
    let id = tool_call_id(params, name);
    assistant_tool_event_with_id(id, name, input, metadata)
}

pub(super) fn assistant_tool_event_with_id(
    id: String,
    name: &str,
    input: Value,
    mut metadata: RuntimeEventMetadata,
) -> RuntimeEvent {
    metadata.raw = assistant_tool_envelope(&metadata, &id, name, &input);
    RuntimeEvent::new(
        metadata,
        RuntimeEventKind::AssistantMessage {
            message: RuntimeAssistantMessage {
                model: None,
                content: vec![RuntimeContentBlock::ToolUse {
                    id,
                    name: name.to_string(),
                    input,
                }],
            },
            parent_tool_use_id: None,
        },
    )
}

fn assistant_tool_envelope(
    metadata: &RuntimeEventMetadata,
    id: &str,
    name: &str,
    input: &Value,
) -> Value {
    serde_json::json!({
        "type": "assistant",
        "session_id": metadata.session_id,
        "parent_tool_use_id": Value::Null,
        "message": {
            "model": Value::Null,
            "content": [{
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            }],
        },
        "acp": metadata.raw,
    })
}

pub(super) fn tool_call_id(params: &Value, fallback: &str) -> String {
    params
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}
