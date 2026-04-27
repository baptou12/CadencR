use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};
use crate::domain::permission_bridge::extract_permission_preview;

#[derive(Debug, Clone)]
pub(super) struct PendingCodexRequest {
    pub id: Value,
    pub method: String,
    pub params: Value,
}

pub(super) fn request_id_from_value(id: &Value) -> String {
    match id {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        other => other.to_string(),
    }
}

pub(super) fn permission_request(
    id: &Value,
    method: &str,
    params: &Value,
) -> RuntimePermissionRequest {
    let request_id = request_id_from_value(id);
    let (tool_name, tool_input, description, supports_allow_future) = match method {
        "item/commandExecution/requestApproval" => {
            let input = serde_json::json!({
                "command": params.get("command").cloned().unwrap_or(Value::Null),
                "cwd": params.get("cwd").cloned().unwrap_or(Value::Null),
                "reason": params.get("reason").cloned().unwrap_or(Value::Null),
                "commandActions": params.get("commandActions").cloned().unwrap_or(Value::Null),
            });
            (
                "Bash".to_string(),
                input,
                description(params, "Approve command execution"),
                true,
            )
        }
        "item/fileChange/requestApproval" => {
            let input = serde_json::json!({
                "patch_text": params.get("patch").cloned().unwrap_or(Value::Null),
                "patch": params.get("patch").cloned().unwrap_or(Value::Null),
                "changes": params.get("changes").cloned().unwrap_or(Value::Null),
                "grantRoot": params.get("grantRoot").cloned().unwrap_or(Value::Null),
                "reason": params.get("reason").cloned().unwrap_or(Value::Null),
            });
            (
                "ApplyPatch".to_string(),
                input,
                description(params, "Approve file change"),
                true,
            )
        }
        "item/permissions/requestApproval" => {
            let input = serde_json::json!({
                "cwd": params.get("cwd").cloned().unwrap_or(Value::Null),
                "reason": params.get("reason").cloned().unwrap_or(Value::Null),
                "permissions": params.get("permissions").cloned().unwrap_or(Value::Null),
            });
            (
                "RequestPermissions".to_string(),
                input,
                description(params, "Approve requested permissions"),
                true,
            )
        }
        "item/tool/requestUserInput" => (
            "AskUserQuestion".to_string(),
            params.clone(),
            Some("Codex question".to_string()),
            false,
        ),
        "mcpServer/elicitation/request" => {
            let meta = params.get("_meta").cloned().unwrap_or(Value::Null);
            let tool_name = meta
                .get("tool_name")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| {
                    let server = params
                        .get("serverName")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    format!("mcp__{server}__elicitation")
                });
            let tool_input = meta
                .get("tool_input")
                .cloned()
                .unwrap_or_else(|| params.clone());
            (
                tool_name,
                tool_input,
                params
                    .get("message")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                false,
            )
        }
        _ => (
            method.to_string(),
            params.clone(),
            Some("Codex approval request".to_string()),
            false,
        ),
    };

    let preview = extract_permission_preview(&tool_input);
    RuntimePermissionRequest {
        request_id,
        tool_use_id: item_id(params),
        tool_name,
        tool_input,
        description,
        pattern: None,
        preview,
        options: permission_options(supports_allow_future),
    }
}

fn item_id(params: &Value) -> Option<String> {
    params
        .get("itemId")
        .and_then(Value::as_str)
        .or_else(|| params.get("item_id").and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

fn description(params: &Value, fallback: &str) -> Option<String> {
    Some(
        params
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_string(),
    )
}

fn permission_options(supports_allow_future: bool) -> Vec<RuntimePermissionOption> {
    let mut options = vec![RuntimePermissionOption {
        decision: RuntimePermissionDecision::AllowOnce,
        label: "Allow once".to_string(),
        description: "Approve this Codex request".to_string(),
        collect_feedback: false,
    }];
    if supports_allow_future {
        options.push(RuntimePermissionOption {
            decision: RuntimePermissionDecision::AllowFuture,
            label: "Allow for session".to_string(),
            description: "Approve matching requests for this Codex session".to_string(),
            collect_feedback: false,
        });
    }
    options.push(RuntimePermissionOption {
        decision: RuntimePermissionDecision::Deny,
        label: "Deny".to_string(),
        description: "Reject this Codex request".to_string(),
        collect_feedback: true,
    });
    options
}

pub(super) fn parse_permission_request(raw: &Value) -> Option<RuntimePermissionRequest> {
    if raw.get("type").and_then(Value::as_str) != Some("codex_permission_request") {
        return None;
    }
    let request_id = raw
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let tool_name = raw
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("CodexRequest")
        .to_string();
    Some(RuntimePermissionRequest {
        request_id: request_id.clone(),
        tool_use_id: raw
            .get("tool_use_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        tool_name: tool_name.clone(),
        tool_input: raw.get("tool_input").cloned().unwrap_or(Value::Null),
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        pattern: None,
        preview: raw
            .get("preview")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        options: permission_options_for_tool(&tool_name),
    })
}

fn permission_options_for_tool(tool_name: &str) -> Vec<RuntimePermissionOption> {
    permission_options(supports_allow_future_for_tool(tool_name))
}

fn supports_allow_future_for_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Bash" | "ApplyPatch" | "apply_patch" | "RequestPermissions"
    )
}

#[cfg(test)]
mod tests {
    use super::permission_request;
    use crate::domain::agents::adapter::RuntimePermissionDecision;
    use serde_json::json;

    #[test]
    fn file_change_permission_uses_canonical_apply_patch_tool_name() {
        let request = permission_request(
            &json!("approval-1"),
            "item/fileChange/requestApproval",
            &json!({
                "threadId": "thread",
                "itemId": "patch",
                "patch": "*** Begin Patch\n*** Update File: a.txt\n@@\n-x\n+y\n*** End Patch"
            }),
        );

        assert_eq!(request.tool_name, "ApplyPatch");
        assert_eq!(
            request.tool_input["patch_text"],
            "*** Begin Patch\n*** Update File: a.txt\n@@\n-x\n+y\n*** End Patch"
        );
        assert!(request
            .options
            .iter()
            .any(|option| option.decision == RuntimePermissionDecision::AllowFuture));
    }
}
