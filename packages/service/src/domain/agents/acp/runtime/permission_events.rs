use serde_json::{json, Value};

use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};

/// Surface a provider-normalized blocking request as the raw envelope the WS
/// bridge consumes. Both canonical ACP permissions and adapter extensions use
/// this one provider-neutral event shape.
pub fn permission_raw_event(request: &RuntimePermissionRequest, params: &Value) -> Value {
    json!({
        "type": "acp_permission_request",
        "transport": "acp",
        "request_id": request.request_id,
        "call_id": request.tool_use_id,
        "tool_name": request.tool_name,
        "tool_input": request.tool_input,
        "description": request.description,
        "preview": request.preview,
        "options": request.options.iter().map(permission_option_json).collect::<Vec<_>>(),
        "acp": params.clone(),
    })
}

fn permission_option_json(option: &RuntimePermissionOption) -> Value {
    // `AllowForSession` is a backend refinement of the FE's allow-future
    // discriminant; the distinct label and option id still render and route
    // the session-scoped choice independently.
    let decision = match option.decision {
        RuntimePermissionDecision::AllowOnce => "allow_once",
        RuntimePermissionDecision::AllowFuture | RuntimePermissionDecision::AllowForSession => {
            "allow_future"
        }
        RuntimePermissionDecision::Deny => "deny",
    };
    json!({
        "decision": decision,
        "option_id": option.option_id,
        "label": option.label,
        "description": option.description,
        "collect_feedback": option.collect_feedback,
    })
}

pub fn parse_permission_options(raw: Option<&Value>) -> Option<Vec<RuntimePermissionOption>> {
    let parsed = raw?
        .as_array()?
        .iter()
        .filter_map(|option| {
            let decision = match option.get("decision").and_then(Value::as_str)? {
                "allow_once" => RuntimePermissionDecision::AllowOnce,
                "allow_for_session" => RuntimePermissionDecision::AllowForSession,
                "allow_future" => RuntimePermissionDecision::AllowFuture,
                "deny" => RuntimePermissionDecision::Deny,
                _ => return None,
            };
            Some(RuntimePermissionOption {
                decision,
                option_id: option
                    .get("option_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                label: option
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("Option")
                    .to_string(),
                description: option
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                collect_feedback: option
                    .get("collect_feedback")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Vec<_>>();
    (!parsed.is_empty()).then_some(parsed)
}
