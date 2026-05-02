use serde_json::Value;

use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionOption};
use crate::domain::permission_bridge::extract_permission_preview;

#[derive(Debug, Clone, PartialEq)]
pub struct OpenCodePermissionRequest {
    pub request_id: String,
    /// OpenCode's tool-invocation id (`call_...`). Distinct from `request_id`
    /// (`per_...`) and needed to match the permission back to the tool-call
    /// row in `agent_messages`. Missing on some upstream events.
    pub call_id: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
    pub description: Option<String>,
    pub preview: Option<String>,
}

pub fn permission_options() -> Vec<RuntimePermissionOption> {
    vec![
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::AllowOnce,
            option_id: None,
            label: "Allow once".to_string(),
            description: "Approve this request only".to_string(),
            collect_feedback: false,
        },
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::AllowFuture,
            option_id: None,
            label: "Always allow".to_string(),
            description: "Let OpenCode allow similar requests automatically".to_string(),
            collect_feedback: false,
        },
        RuntimePermissionOption {
            decision: RuntimePermissionDecision::Deny,
            option_id: None,
            label: "Deny".to_string(),
            description: "Reject this request".to_string(),
            collect_feedback: false,
        },
    ]
}

pub fn parse_permission_request(raw: &Value) -> Option<OpenCodePermissionRequest> {
    if raw.get("type").and_then(Value::as_str) != Some("opencode_permission_request") {
        return None;
    }

    Some(OpenCodePermissionRequest {
        request_id: raw.get("request_id").and_then(Value::as_str)?.to_string(),
        call_id: raw
            .get("call_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        tool_name: raw.get("tool_name").and_then(Value::as_str)?.to_string(),
        tool_input: raw
            .get("tool_input")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        preview: raw.get("tool_input").and_then(extract_permission_preview),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_permission_request, permission_options, OpenCodePermissionRequest};
    use serde_json::json;

    #[test]
    fn parses_opencode_permission_request_payload() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "req-1",
            "tool_name": "Bash",
            "tool_input": { "command": "git status" },
            "description": "Run git status"
        }))
        .unwrap();

        assert_eq!(
            payload,
            OpenCodePermissionRequest {
                request_id: "req-1".to_string(),
                call_id: None,
                tool_name: "Bash".to_string(),
                tool_input: json!({ "command": "git status" }),
                description: Some("Run git status".to_string()),
                preview: Some("git status".to_string()),
            }
        );
    }

    #[test]
    fn parses_call_id_when_present() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "per_1",
            "call_id": "call_1",
            "tool_name": "cadencr-plan_show_plan",
            "tool_input": {},
        }))
        .unwrap();
        assert_eq!(payload.call_id.as_deref(), Some("call_1"));
    }

    #[test]
    fn parses_nested_opencode_command_preview() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "req-1",
            "tool_name": "bash",
            "tool_input": { "metadata": { "command": "git status" } },
            "description": "Run git status"
        }))
        .unwrap();

        assert_eq!(payload.preview.as_deref(), Some("git status"));
    }

    #[test]
    fn parses_nested_opencode_path_preview() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "req-2",
            "tool_name": "external_directory",
            "tool_input": { "metadata": { "path": "/etc/hosts" } },
            "description": "Needs access"
        }))
        .unwrap();

        assert_eq!(payload.preview.as_deref(), Some("/etc/hosts"));
    }

    #[test]
    fn parses_upstream_metadata_filepath_preview() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "req-actual",
            "tool_name": "external_directory",
            "tool_input": {
                "metadata": { "filepath": "/etc/hosts", "parentDir": "/etc" },
                "patterns": ["/etc/*"]
            }
        }))
        .unwrap();

        assert_eq!(payload.preview.as_deref(), Some("/etc/hosts"));
    }

    #[test]
    fn prefers_exact_always_entry_over_pattern_preview() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "req-3",
            "tool_name": "external_directory",
            "tool_input": {
                "patterns": ["/etc/*"],
                "always": ["/etc/hosts"]
            }
        }))
        .unwrap();

        assert_eq!(payload.preview.as_deref(), Some("/etc/hosts"));
    }

    #[test]
    fn prefers_nested_metadata_args_path_over_pattern_preview() {
        let payload = parse_permission_request(&json!({
            "type": "opencode_permission_request",
            "request_id": "req-4",
            "tool_name": "external_directory",
            "tool_input": {
                "metadata": {
                    "args": { "path": "/etc/hosts" }
                },
                "patterns": ["/etc/*"]
            }
        }))
        .unwrap();

        assert_eq!(payload.preview.as_deref(), Some("/etc/hosts"));
    }

    #[test]
    fn opencode_permission_options_include_always_allow() {
        let options = permission_options();
        assert_eq!(options[1].label, "Always allow");
    }

    #[test]
    fn ignores_non_opencode_permission_events() {
        assert!(parse_permission_request(&json!({ "type": "other" })).is_none());
    }
}
