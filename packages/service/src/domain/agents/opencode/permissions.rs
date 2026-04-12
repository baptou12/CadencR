use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct OpenCodePermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub tool_input: Value,
    pub description: Option<String>,
}

pub fn parse_permission_request(raw: &Value) -> Option<OpenCodePermissionRequest> {
    if raw.get("type").and_then(Value::as_str) != Some("opencode_permission_request") {
        return None;
    }

    Some(OpenCodePermissionRequest {
        request_id: raw.get("request_id").and_then(Value::as_str)?.to_string(),
        tool_name: raw.get("tool_name").and_then(Value::as_str)?.to_string(),
        tool_input: raw
            .get("tool_input")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_permission_request, OpenCodePermissionRequest};
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
                tool_name: "Bash".to_string(),
                tool_input: json!({ "command": "git status" }),
                description: Some("Run git status".to_string()),
            }
        );
    }

    #[test]
    fn ignores_non_opencode_permission_events() {
        assert!(parse_permission_request(&json!({ "type": "other" })).is_none());
    }
}
