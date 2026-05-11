//! Typed-payload conversion for ACP `session/request_permission` requests.
//!
//! Sibling to [`super::permissions`]: when the inbound request deserializes
//! cleanly into the official `RequestPermissionRequest` schema we route here
//! to avoid a second raw-JSON parse. The OpenCode `toolCall` extension shape
//! still falls through `permission_request_from_acp` and shares the same
//! helpers (`default_options`, `default_description`, `derive_preview`).

use agent_client_protocol::schema::RequestPermissionRequest;
use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};

use super::permissions::{default_description, default_options, derive_preview};
use super::schema_bridge::decision_for_official_kind;

/// Typed-payload variant of `permission_request_from_acp`.
///
/// Used when the inbound `session/request_permission` deserializes cleanly
/// into the official ACP schema; the OpenCode `toolCall` extension shape
/// still falls through the raw helper. Both paths converge on the same
/// `RuntimePermissionRequest` so the UI is unaware of which branch produced
/// it.
pub fn permission_request_from_typed(
    request_id: &str,
    request: &RequestPermissionRequest,
) -> Option<RuntimePermissionRequest> {
    let tool_input = request
        .tool_call
        .fields
        .raw_input
        .clone()
        .unwrap_or(Value::Null);
    let description = request.tool_call.fields.title.clone();
    let tool_name = description.clone().unwrap_or_else(|| "tool".to_string());
    let preview = derive_preview(&tool_input);

    let options: Vec<RuntimePermissionOption> = request
        .options
        .iter()
        .filter_map(|option| {
            let decision = decision_for_official_kind(option.kind)?;
            Some(RuntimePermissionOption {
                decision,
                option_id: Some(option.option_id.to_string()),
                label: option.name.clone(),
                description: default_description(decision).to_string(),
                collect_feedback: matches!(decision, RuntimePermissionDecision::Deny),
            })
        })
        .collect();

    Some(RuntimePermissionRequest {
        request_id: request_id.to_string(),
        tool_use_id: Some(request.tool_call.tool_call_id.to_string()),
        tool_name,
        tool_input,
        description,
        pattern: None,
        preview,
        options: if options.is_empty() {
            default_options()
        } else {
            options
        },
    })
}

#[cfg(test)]
mod tests {
    use super::permission_request_from_typed;
    use agent_client_protocol::schema::{
        PermissionOption, PermissionOptionKind, RequestPermissionRequest, ToolCallUpdate,
        ToolCallUpdateFields,
    };
    use serde_json::json;

    #[test]
    fn typed_permission_request_extracts_options_without_raw_reparse() {
        let tool_call = ToolCallUpdate::new(
            "call-1",
            ToolCallUpdateFields::new()
                .title("Bash".to_string())
                .raw_input(json!({ "command": "ls" })),
        );
        let typed = RequestPermissionRequest::new(
            "s-1",
            tool_call,
            vec![PermissionOption::new(
                "allow-once",
                "Allow once",
                PermissionOptionKind::AllowOnce,
            )],
        );

        let req = permission_request_from_typed("perm-1", &typed).unwrap();
        assert_eq!(req.request_id, "perm-1");
        assert_eq!(req.tool_use_id.as_deref(), Some("call-1"));
        assert_eq!(req.tool_name, "Bash");
        assert_eq!(req.options.len(), 1);
        assert_eq!(req.options[0].option_id.as_deref(), Some("allow-once"));
        assert_eq!(req.preview.as_deref(), Some("ls"));
    }
}
