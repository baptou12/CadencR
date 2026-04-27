use std::path::Path;

use serde_json::{json, Value};

use super::model::{approval_policy, sandbox_policy};
use crate::domain::agents::adapter::RuntimePermissionMode;

pub(super) fn turn_start_params(
    thread_id: &str,
    input: Vec<Value>,
    cwd: &Path,
    permission_mode: Option<&RuntimePermissionMode>,
    model: Option<String>,
    effort: Option<String>,
) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "input": input,
        "cwd": cwd.to_string_lossy(),
        "approvalPolicy": approval_policy(permission_mode),
        "sandboxPolicy": sandbox_policy(permission_mode, cwd),
        "summary": "auto",
    });
    if let Some(model) = model {
        params["model"] = Value::String(model);
    }
    if let Some(effort) = effort {
        params["effort"] = Value::String(effort);
    }
    if let Some(collaboration_mode) =
        collaboration_mode(permission_mode, params.get("model"), params.get("effort"))
    {
        params["collaborationMode"] = collaboration_mode;
    }
    params
}

fn collaboration_mode(
    permission_mode: Option<&RuntimePermissionMode>,
    model: Option<&Value>,
    effort: Option<&Value>,
) -> Option<Value> {
    if !matches!(permission_mode, Some(RuntimePermissionMode::Plan)) {
        return None;
    }
    let model = model.and_then(Value::as_str)?;
    // Codex's protocol names the conversation mode `collaborationMode`;
    // Cadence's `Plan` permission mode maps to Codex's built-in `plan` mode.
    Some(json!({
        "mode": "plan",
        "settings": {
            "model": model,
            "reasoning_effort": effort.and_then(Value::as_str),
            "developer_instructions": null
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::turn_start_params;
    use std::path::Path;

    #[test]
    fn turn_start_requests_reasoning_summaries_and_effort() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "hello" })],
            Path::new("/tmp/app"),
            None,
            Some("gpt-5.5".to_string()),
            Some("xhigh".to_string()),
        );

        assert_eq!(params["summary"], "auto");
        assert_eq!(params["effort"], "xhigh");
        assert_eq!(params["model"], "gpt-5.5");
    }

    #[test]
    fn turn_start_maps_plan_mode_to_codex_collaboration_mode() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "plan" })],
            Path::new("/tmp/app"),
            Some(&crate::domain::agents::adapter::RuntimePermissionMode::Plan),
            Some("gpt-5.5".to_string()),
            Some("high".to_string()),
        );

        assert_eq!(params["collaborationMode"]["mode"], "plan");
        assert_eq!(params["collaborationMode"]["settings"]["model"], "gpt-5.5");
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoning_effort"],
            "high"
        );
        assert!(params["collaborationMode"]["settings"]["developer_instructions"].is_null());
    }

    #[test]
    fn turn_start_omits_collaboration_mode_without_model() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "plan" })],
            Path::new("/tmp/app"),
            Some(&crate::domain::agents::adapter::RuntimePermissionMode::Plan),
            None,
            Some("high".to_string()),
        );

        assert!(params.get("collaborationMode").is_none());
    }
}
