use serde_json::Value;

use super::permissions::permission_request;
use super::raw_tool_names::function_tool_name;
use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionResponse};
use crate::domain::mcp::trusted::{
    is_trusted_cadencr_browser_namespace_tool, is_trusted_cadencr_browser_server_tool,
    is_trusted_cadencr_browser_tool_name,
};

pub(super) fn trusted_cadencr_browser_permission_response(
    id: &Value,
    method: &str,
    params: &Value,
) -> Option<RuntimePermissionResponse> {
    if !is_permission_request_method(method) {
        return None;
    }
    if !is_trusted_cadencr_browser_permission(method, params) {
        return None;
    }
    let request = permission_request(id, method, params);
    Some(RuntimePermissionResponse {
        request_id: request.request_id,
        decision: RuntimePermissionDecision::AllowOnce,
        option_id: request
            .options
            .iter()
            .find(|option| option.decision == RuntimePermissionDecision::AllowOnce)
            .and_then(|option| option.option_id.clone()),
        feedback: None,
        updated_input: None,
    })
}

fn is_permission_request_method(method: &str) -> bool {
    matches!(
        method,
        "mcpServer/elicitation/request" | "item/tool/requestApproval"
    )
}

fn is_trusted_cadencr_browser_permission(method: &str, params: &Value) -> bool {
    match method {
        "mcpServer/elicitation/request" => is_trusted_elicitation(params),
        "item/tool/requestApproval" => is_trusted_item_tool_request(params),
        _ => false,
    }
}

fn is_trusted_elicitation(params: &Value) -> bool {
    let server = params.get("serverName").and_then(Value::as_str);
    let Some(server) = server else {
        return false;
    };
    let meta = params.get("_meta").or_else(|| params.get("meta"));
    let meta_tool = meta
        .and_then(|value| value.get("tool_name"))
        .and_then(Value::as_str);
    let message_tool = params
        .get("message")
        .and_then(Value::as_str)
        .and_then(quoted_tool_from_message);
    meta_tool.or(message_tool).is_some_and(|tool| {
        is_trusted_cadencr_browser_tool_name(tool)
            || is_trusted_cadencr_browser_server_tool(server, tool)
    })
}

fn is_trusted_item_tool_request(params: &Value) -> bool {
    let item = params.get("item").unwrap_or(params);
    let normalized_name = function_tool_name(item);
    if is_trusted_cadencr_browser_tool_name(&normalized_name) {
        return true;
    }
    let namespace = item.get("namespace").and_then(Value::as_str);
    let tool = item
        .get("name")
        .or_else(|| item.get("tool"))
        .and_then(Value::as_str);
    namespace
        .zip(tool)
        .is_some_and(|(namespace, tool)| is_trusted_cadencr_browser_namespace_tool(namespace, tool))
}

fn quoted_tool_from_message(message: &str) -> Option<&str> {
    let marker = " tool \"";
    let start = message.find(marker)? + marker.len();
    let rest = message.get(start..)?;
    let end = rest.find('"')?;
    rest.get(..end)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::trusted_cadencr_browser_permission_response;
    use crate::domain::agents::adapter::RuntimePermissionDecision;

    #[test]
    fn trusted_cadencr_browser_permission_builds_allow_response() {
        let response = trusted_cadencr_browser_permission_response(
            &json!("approval-browser"),
            "mcpServer/elicitation/request",
            &json!({
                "serverName": "cadencr-browser",
                "_meta": { "tool_name": "browser_screenshot" },
                "message": "Approve browser screenshot"
            }),
        )
        .expect("trusted browser MCP should be auto-allowed");

        assert_eq!(response.request_id, "approval-browser");
        assert_eq!(response.decision, RuntimePermissionDecision::AllowOnce);
    }

    #[test]
    fn trusted_cadencr_browser_permission_recognizes_raw_codex_namespace_item() {
        let response = trusted_cadencr_browser_permission_response(
            &json!("approval-raw-browser"),
            "item/tool/requestApproval",
            &json!({
                "item": {
                    "type": "function_call",
                    "namespace": "mcp__cadencr_browser",
                    "name": "browser_open_url",
                    "arguments": "{\"url\":\"http://localhost:1420\"}"
                }
            }),
        )
        .expect("raw Codex Cadencr browser MCP call should be auto-allowed");

        assert_eq!(response.request_id, "approval-raw-browser");
        assert_eq!(response.decision, RuntimePermissionDecision::AllowOnce);
    }

    #[test]
    fn trusted_cadencr_browser_permission_recognizes_codex_message_only_elicitation() {
        let response = trusted_cadencr_browser_permission_response(
            &json!("approval-message-browser"),
            "mcpServer/elicitation/request",
            &json!({
                "_meta": {
                    "codex_approval_kind": "mcp_tool_call",
                    "persist": ["session", "always"],
                    "tool_description": "Open a localhost URL",
                    "tool_params": { "url": "http://127.0.0.1:5175" },
                    "tool_params_display": [{
                        "display_name": "url",
                        "name": "url",
                        "value": "http://127.0.0.1:5175"
                    }]
                },
                "message": "Allow the cadencr-browser MCP server to run tool \"browser_open_url\"?",
                "mode": "form",
                "requestedSchema": {
                    "properties": {},
                    "type": "object"
                },
                "serverName": "cadencr-browser",
                "threadId": "019eba7c-7ebf-75f1-a6aa-022c40e3c9b9",
                "turnId": "019eba7c-83e9-7011-bdf3-935c998e388a"
            }),
        )
        .expect("Codex message-only Cadencr browser MCP approval should be auto-allowed");

        assert_eq!(response.request_id, "approval-message-browser");
        assert_eq!(response.decision, RuntimePermissionDecision::AllowOnce);
    }

    #[test]
    fn trusted_cadencr_browser_permission_rejects_untrusted_codex_message_tool() {
        assert!(trusted_cadencr_browser_permission_response(
            &json!("approval-message-workspace"),
            "mcpServer/elicitation/request",
            &json!({
                "serverName": "cadencr-browser",
                "message": "Allow the cadencr-browser MCP server to run tool \"read_conversation\"?"
            }),
        )
        .is_none());
    }

    #[test]
    fn trusted_cadencr_browser_permission_ignores_non_permission_server_requests() {
        assert!(trusted_cadencr_browser_permission_response(
            &json!("not-approval"),
            "server/ping",
            &json!({
                "serverName": "cadencr-browser",
                "message": "Allow the cadencr-browser MCP server to run tool \"browser_open_url\"?"
            }),
        )
        .is_none());
    }
}
