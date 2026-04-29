use serde_json::{Map, Value};

use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};
use crate::domain::permission_bridge::extract_permission_preview;

pub(super) const DECISION_ACCEPT_FOR_SESSION: &str = "acceptForSession";
pub(super) const DECISION_CANCEL: &str = "cancel";
pub(super) const DECISION_DECLINE: &str = "decline";

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
            let is_network_request = params
                .get("networkApprovalContext")
                .is_some_and(|value| !value.is_null());
            let input = command_permission_input(params);
            (
                if is_network_request {
                    "NetworkAccess".to_string()
                } else {
                    "Bash".to_string()
                },
                input,
                description(
                    params,
                    if is_network_request {
                        "Approve network access"
                    } else {
                        "Approve command execution"
                    },
                ),
                supports_accept_for_session(params),
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
                supports_accept_for_session(params),
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
            let server = params
                .get("serverName")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let tool_name =
                prefixed_mcp_tool_name(server, meta.get("tool_name").and_then(Value::as_str));
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

fn command_permission_input(params: &Value) -> Value {
    let mut input = Map::new();
    insert_param_or_null(&mut input, params, "approvalId");
    insert_param_or_null(&mut input, params, "command");
    insert_param_or_null(&mut input, params, "cwd");
    insert_param_or_null(&mut input, params, "reason");
    insert_param_or_null(&mut input, params, "commandActions");
    insert_optional_param(&mut input, params, "additionalPermissions");
    insert_optional_param(&mut input, params, "networkApprovalContext");
    insert_optional_param(&mut input, params, "proposedExecpolicyAmendment");
    insert_optional_param(&mut input, params, "proposedNetworkPolicyAmendments");
    Value::Object(input)
}

fn insert_param_or_null(input: &mut Map<String, Value>, params: &Value, key: &str) {
    input.insert(
        key.to_string(),
        params.get(key).cloned().unwrap_or(Value::Null),
    );
}

fn insert_optional_param(input: &mut Map<String, Value>, params: &Value, key: &str) {
    let Some(value) = params.get(key).filter(|value| !value.is_null()) else {
        return;
    };
    input.insert(key.to_string(), value.clone());
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
    let supports_allow_future = raw
        .get("supports_allow_future")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| supports_allow_future_for_tool(&tool_name));
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
        options: permission_options(supports_allow_future),
    })
}

fn supports_allow_future_for_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Bash" | "NetworkAccess" | "ApplyPatch" | "apply_patch" | "RequestPermissions"
    )
}

pub(super) fn supports_accept_for_session(params: &Value) -> bool {
    if !params.get("availableDecisions").is_some() {
        return true;
    }
    has_available_decision(params, DECISION_ACCEPT_FOR_SESSION)
}

fn prefixed_mcp_tool_name(server: &str, raw_tool_name: Option<&str>) -> String {
    match raw_tool_name {
        Some(name) if name.starts_with("mcp__") => name.to_string(),
        Some(name) if !name.is_empty() => format!("mcp__{server}__{name}"),
        _ => format!("mcp__{server}__elicitation"),
    }
}

pub(super) fn has_available_decision(params: &Value, expected: &str) -> bool {
    available_decisions(params).any(|decision| decision == expected)
}

pub(super) fn available_decisions(params: &Value) -> impl Iterator<Item = &str> {
    params
        .get("availableDecisions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::permission_request;
    use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionRequest};
    use serde_json::json;

    fn has_allow_future(request: &RuntimePermissionRequest) -> bool {
        request
            .options
            .iter()
            .any(|option| option.decision == RuntimePermissionDecision::AllowFuture)
    }

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
        assert!(has_allow_future(&request));
    }

    #[test]
    fn command_permission_preserves_network_context() {
        let request = permission_request(
            &json!("approval-2"),
            "item/commandExecution/requestApproval",
            &json!({
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "cmd",
                "command": null,
                "reason": "Allow access to api.example.com",
                "networkApprovalContext": { "host": "api.example.com" },
                "proposedNetworkPolicyAmendments": [
                    { "action": "allow", "host": "api.example.com" }
                ]
            }),
        );

        assert_eq!(request.tool_name, "NetworkAccess");
        assert_eq!(
            request.tool_input["networkApprovalContext"],
            json!({ "host": "api.example.com" })
        );
        assert_eq!(
            request.tool_input["proposedNetworkPolicyAmendments"],
            json!([{ "action": "allow", "host": "api.example.com" }])
        );
    }

    #[test]
    fn command_permission_respects_available_decisions() {
        let request = permission_request(
            &json!("approval-3"),
            "item/commandExecution/requestApproval",
            &json!({
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "cmd",
                "command": "git status",
                "availableDecisions": ["accept", "decline"]
            }),
        );

        assert!(!has_allow_future(&request));
    }

    #[test]
    fn reparsed_permission_preserves_missing_allow_future_support() {
        let request = super::parse_permission_request(&json!({
            "type": "codex_permission_request",
            "request_id": "approval-4",
            "tool_name": "Bash",
            "tool_input": { "command": "git status" },
            "supports_allow_future": false
        }))
        .expect("permission request should parse");

        assert!(!has_allow_future(&request));
    }

    #[test]
    fn elicitation_tool_name_is_always_mcp_prefixed() {
        let forged = permission_request(
            &json!("approval-5"),
            "mcpServer/elicitation/request",
            &json!({
                "serverName": "remote",
                "_meta": {
                    "tool_name": "Bash",
                    "tool_input": { "command": "rm -rf ." }
                }
            }),
        );
        assert_eq!(forged.tool_name, "mcp__remote__Bash");

        let canonical = permission_request(
            &json!("approval-6"),
            "mcpServer/elicitation/request",
            &json!({
                "serverName": "cadence-plan",
                "_meta": {
                    "tool_name": "mcp__cadence-plan__show_plan"
                }
            }),
        );
        assert_eq!(canonical.tool_name, "mcp__cadence-plan__show_plan");
    }
}
