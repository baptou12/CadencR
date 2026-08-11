use serde_json::Value;

use crate::domain::agents::acp::runtime::permission_events::parse_acp_permission_request;
use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};

/// The shared ACP envelope decoder plus Cursor's own wording for the choices,
/// used when the agent sent a permission request without an options list.
pub(super) fn parse_permission_request(raw: &Value) -> Option<RuntimePermissionRequest> {
    parse_acp_permission_request(raw, Some(default_options()))
}

fn default_options() -> Vec<RuntimePermissionOption> {
    vec![
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::AllowOnce,
            option_id: Some("allow-once".to_string()),
            label: "Allow once".to_string(),
            description: "Approve this request only".to_string(),
            collect_feedback: false,
        },
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::AllowFuture,
            option_id: Some("allow-always".to_string()),
            label: "Allow always".to_string(),
            description: "Let Cursor allow matching requests in the future".to_string(),
            collect_feedback: false,
        },
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::Deny,
            option_id: Some("reject-once".to_string()),
            label: "Deny".to_string(),
            description: "Reject this request".to_string(),
            collect_feedback: false,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::parse_permission_request;
    use serde_json::json;

    #[test]
    fn parses_normalized_acp_permission_event() {
        let request = parse_permission_request(&json!({
            "type": "acp_permission_request",
            "request_id": "permission-1",
            "call_id": "call-1",
            "tool_name": "Bash",
            "tool_input": { "command": "git status" },
            "preview": "git status"
        }))
        .unwrap();
        assert_eq!(request.tool_use_id.as_deref(), Some("call-1"));
        assert_eq!(request.tool_name, "Bash");
        assert_eq!(request.options.len(), 3);
    }
}
