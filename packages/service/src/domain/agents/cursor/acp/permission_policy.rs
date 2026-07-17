use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeAccessMode, RuntimePermissionDecision, RuntimePermissionRequest,
};

/// Cursor 2026.07.09 accepts `--auto-review` for `agent acp`, but its ACP
/// session bootstrap does not copy that mode into the session metadata. It
/// consequently asks the ACP host about every shell allowlist miss. Keep the
/// workaround provider-local: in Auto Review, preflight shell calls when the
/// only reason Cursor reports is its ordinary allowlist miss. Cursor has
/// already applied its parser, sandbox, blocklist, delete-protection, hook, and
/// team-policy checks before sending this request; requests carrying any of
/// those stronger reasons still reach the UI.
pub(super) fn automatic_permission_decision(
    access_mode: Option<&RuntimeAccessMode>,
    _request: &RuntimePermissionRequest,
    params: &Value,
) -> Option<RuntimePermissionDecision> {
    if access_mode != Some(&RuntimeAccessMode::AutoReview) {
        return None;
    }
    let tool_call = params.get("toolCall")?;
    if tool_call.get("kind").and_then(Value::as_str) != Some("execute") {
        return None;
    }
    if !has_only_allowlist_miss_reasons(tool_call) {
        return None;
    }
    Some(RuntimePermissionDecision::AllowOnce)
}

fn has_only_allowlist_miss_reasons(tool_call: &Value) -> bool {
    let reasons = tool_call
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|block| block.pointer("/content/text").and_then(Value::as_str))
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

    #[test]
    fn auto_review_preflights_cursor_shell_allowlist_misses() {
        let command = "cd /Users/rle/Projects/cadencr && git diff origin/main...HEAD --stat";
        assert_eq!(
            automatic_permission_decision(
                Some(&RuntimeAccessMode::AutoReview),
                &request(command),
                &params(command, "Not in allowlist: git show, echo, git diff"),
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
