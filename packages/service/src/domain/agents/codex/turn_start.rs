use std::path::Path;

use serde_json::{json, Value};

use super::instructions::codex_developer_instructions;
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
    let collaboration_mode =
        collaboration_mode(permission_mode, model.as_deref(), effort.as_deref());
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
    if let Some(collaboration_mode) = collaboration_mode {
        params["collaborationMode"] = collaboration_mode;
    }
    params
}

fn collaboration_mode(
    permission_mode: Option<&RuntimePermissionMode>,
    model: Option<&str>,
    effort: Option<&str>,
) -> Option<Value> {
    let model = model?;
    // Codex persists collaboration mode on the server thread, so send the
    // default mode explicitly when Cadencr leaves plan mode.
    let mode = if matches!(permission_mode, Some(RuntimePermissionMode::Plan)) {
        "plan"
    } else {
        "default"
    };
    let developer_instructions = codex_developer_instructions();
    Some(json!({
        "mode": mode,
        "settings": {
            "model": model,
            "reasoning_effort": effort,
            "developer_instructions": developer_instructions
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
        let instructions = params["collaborationMode"]["settings"]["developer_instructions"]
            .as_str()
            .expect("developer instructions");
        assert!(instructions
            .starts_with(crate::domain::agents::response_style::RICH_MARKDOWN_INSTRUCTION));
        assert!(instructions.contains("mcp__cadencr-plan__update_plan"));
        assert!(instructions.contains("mcp__cadencr_plan____update_plan"));
        assert!(instructions.contains("Do not use Codex-native `update_plan`"));
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

    #[test]
    fn turn_start_resets_codex_collaboration_mode_after_plan_mode() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "approved" })],
            Path::new("/tmp/app"),
            Some(&crate::domain::agents::adapter::RuntimePermissionMode::AcceptEdits),
            Some("gpt-5.5".to_string()),
            Some("high".to_string()),
        );

        assert_eq!(params["collaborationMode"]["mode"], "default");
        assert_eq!(params["collaborationMode"]["settings"]["model"], "gpt-5.5");
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoning_effort"],
            "high"
        );
    }
}
