use serde_json::{json, Value};

use crate::domain::agents::acp::runtime::provider_hooks::AcpExtensionRequest;
use crate::domain::agents::adapter::{
    RuntimeEventMetadata, RuntimePermissionDecision, RuntimePermissionRequest,
    RuntimePermissionResponse,
};

use super::notification::normalized_todos;
use super::{assistant_tool_event_with_id, gate_options, tool_call_id};

pub(super) fn request(
    request_id: &str,
    params: &Value,
    metadata: RuntimeEventMetadata,
) -> AcpExtensionRequest {
    let tool_call_id = tool_call_id(params, request_id);
    let plan = params.get("plan").and_then(Value::as_str).unwrap_or("");
    let tool_input = json!({
        "plan": plan,
        "name": params.get("name"),
        "overview": params.get("overview"),
        "todos": normalized_todos(params),
        "isProject": params.get("isProject"),
        "phases": params.get("phases"),
    });
    AcpExtensionRequest {
        permission: RuntimePermissionRequest {
            request_id: request_id.to_string(),
            tool_use_id: Some(tool_call_id.clone()),
            tool_name: "ExitPlanMode".to_string(),
            tool_input: tool_input.clone(),
            description: Some("Cursor is ready to execute this plan".to_string()),
            pattern: Some("ExitPlanMode".to_string()),
            preview: None,
            options: gate_options("Approve plan"),
        },
        events: vec![assistant_tool_event_with_id(
            tool_call_id,
            "ExitPlanMode",
            tool_input,
            metadata,
        )],
    }
}

pub(super) fn response(response: &RuntimePermissionResponse) -> Value {
    if matches!(
        response.decision,
        RuntimePermissionDecision::AllowOnce | RuntimePermissionDecision::AllowFuture
    ) {
        return json!({ "outcome": { "outcome": "accepted" } });
    }
    json!({
        "outcome": {
            "outcome": "rejected",
            "reason": response.feedback.as_deref().unwrap_or("Plan rejected by user"),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{request, response};
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeEventMetadata, RuntimePermissionDecision,
        RuntimePermissionResponse,
    };
    use serde_json::json;

    fn permission_response(decision: RuntimePermissionDecision) -> RuntimePermissionResponse {
        RuntimePermissionResponse {
            request_id: "request-1".to_string(),
            decision,
            option_id: None,
            feedback: None,
            updated_input: None,
        }
    }

    #[test]
    fn plan_becomes_exit_plan_mode_gate_and_tool() {
        let request = request(
            "request-1",
            &json!({
                "toolCallId": "call-plan",
                "plan": "1. Inspect\n2. Edit",
                "todos": [{ "id": "1", "content": "Inspect", "status": "completed" }]
            }),
            RuntimeEventMetadata::default(),
        );
        assert_eq!(request.permission.tool_name, "ExitPlanMode");
        assert_eq!(request.permission.tool_input["plan"], "1. Inspect\n2. Edit");
        assert!(matches!(
            &request.events[0].assistant_message().unwrap().content[0],
            RuntimeContentBlock::ToolUse { name, .. } if name == "ExitPlanMode"
        ));
    }

    #[test]
    fn decision_uses_cursor_response_schema() {
        assert_eq!(
            response(&permission_response(RuntimePermissionDecision::AllowOnce))["outcome"]
                ["outcome"],
            "accepted"
        );
        assert_eq!(
            response(&permission_response(RuntimePermissionDecision::Deny))["outcome"]["outcome"],
            "rejected"
        );
    }
}
