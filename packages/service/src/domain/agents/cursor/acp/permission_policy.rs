use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeAccessMode, RuntimePermissionDecision, RuntimePermissionRequest,
};

use super::normalize::mcp_input_from_permission_content;

/// Cursor 2026.07.16 accepts `--auto-review` for `agent acp`, but its ACP
/// session bootstrap does not copy that mode into the session metadata. It
/// consequently asks the ACP host about ordinary shell allowlist misses and
/// MCP calls. Keep the workaround provider-local: in Auto Review, preflight
/// those ordinary requests after Cursor has applied its parser, sandbox,
/// blocklist, delete-protection, hook, and team-policy checks. Requests carrying
/// any stronger safety reason still reach the UI.
pub(super) fn automatic_permission_decision(
    access_mode: Option<&RuntimeAccessMode>,
    request: &RuntimePermissionRequest,
    params: &Value,
) -> Option<RuntimePermissionDecision> {
    if access_mode != Some(&RuntimeAccessMode::AutoReview) {
        return None;
    }
    let tool_call = params.get("toolCall")?;
    match tool_call.get("kind").and_then(Value::as_str) {
        Some("execute") if has_only_allowlist_miss_reasons(tool_call) => {
            Some(RuntimePermissionDecision::AllowOnce)
        }
        Some("other")
            if request.tool_name.starts_with("mcp__")
                && mcp_input_from_permission_content(params).is_some() =>
        {
            Some(RuntimePermissionDecision::AllowOnce)
        }
        _ => None,
    }
}

fn has_only_allowlist_miss_reasons(tool_call: &Value) -> bool {
    let reasons = tool_call_text(tool_call)
        .flat_map(|text| text.split(" • "))
        .map(str::trim)
        .collect::<Vec<_>>();
    !reasons.is_empty()
        && reasons.iter().all(|reason| {
            reason
                .strip_prefix("Not in allowlist:")
                .is_some_and(|command| !command.trim().is_empty())
        })
}

fn tool_call_text(tool_call: &Value) -> impl Iterator<Item = &str> {
    tool_call
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|block| block.pointer("/content/text").and_then(Value::as_str))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::automatic_permission_decision;
    use crate::domain::agents::adapter::{
        RuntimeAccessMode, RuntimePermissionDecision, RuntimePermissionRequest,
    };

    fn request(command: &str) -> RuntimePermissionRequest {
        RuntimePermissionRequest {
            request_id: "permission-1".to_string(),
            tool_use_id: Some("tool-1".to_string()),
            tool_name: "Bash".to_string(),
            tool_input: json!({ "command": command }),
            description: Some(format!("`{command}`")),
            pattern: None,
            preview: Some(command.to_string()),
            options: Vec::new(),
        }
    }

    fn params(command: &str, reason: &str) -> Value {
        json!({
            "toolCall": {
                "title": format!("`{command}`"),
                "kind": "execute",
                "content": [{
                    "type": "content",
                    "content": { "type": "text", "text": reason }
                }]
            }
        })
    }

    fn mcp_request() -> RuntimePermissionRequest {
        RuntimePermissionRequest {
            request_id: "permission-mcp".to_string(),
            tool_use_id: Some("tool-mcp".to_string()),
            tool_name: "mcp__chrome-devtools__new_page".to_string(),
            tool_input: json!({
                "server": "chrome-devtools",
                "tool": "new_page",
                "arguments": { "url": "https://google.com" }
            }),
            description: Some("chrome-devtools-new_page: new_page".to_string()),
            pattern: None,
            preview: None,
            options: Vec::new(),
        }
    }

    fn mcp_params(content: &str) -> Value {
        json!({
            "toolCall": {
                "title": "chrome-devtools-new_page: new_page",
                "kind": "other",
                "content": [{
                    "type": "content",
                    "content": { "type": "text", "text": content }
                }]
            }
        })
    }

    #[test]
    fn auto_review_preflights_cursor_shell_allowlist_misses() {
        let command = "printf cursor-acp-auto-review";
        assert_eq!(
            automatic_permission_decision(
                Some(&RuntimeAccessMode::AutoReview),
                &request(command),
                &params(command, "Not in allowlist: printf"),
            ),
            Some(RuntimePermissionDecision::AllowOnce)
        );
    }

    #[test]
    fn auto_review_keeps_explicit_safety_requests_interactive() {
        for reason in [
            "Delete protection is enabled",
            "In team blocklist: git push",
            "Hook requested approval: review required",
            "Not in allowlist: git diff • Delete protection is enabled",
        ] {
            assert_eq!(
                automatic_permission_decision(
                    Some(&RuntimeAccessMode::AutoReview),
                    &request("git diff"),
                    &params("git diff", reason),
                ),
                None
            );
        }
    }

    #[test]
    fn auto_review_preflights_cursor_mcp_requests() {
        assert_eq!(
            automatic_permission_decision(
                Some(&RuntimeAccessMode::AutoReview),
                &mcp_request(),
                &mcp_params("```json\n{\"url\":\"https://google.com\"}\n```")
            ),
            Some(RuntimePermissionDecision::AllowOnce)
        );
    }

    #[test]
    fn auto_review_keeps_unstructured_mcp_requests_interactive() {
        for params in [
            mcp_params("Approval required by a newer policy"),
            json!({
                "toolCall": {
                    "title": "chrome-devtools-new_page: new_page",
                    "kind": "other"
                }
            }),
        ] {
            assert_eq!(
                automatic_permission_decision(
                    Some(&RuntimeAccessMode::AutoReview),
                    &mcp_request(),
                    &params,
                ),
                None
            );
        }
    }

    #[test]
    fn default_mode_does_not_preflight_the_same_request() {
        assert_eq!(
            automatic_permission_decision(
                Some(&RuntimeAccessMode::Default),
                &request("pwd"),
                &params("pwd", "Not in allowlist: pwd"),
            ),
            None
        );
    }
}
