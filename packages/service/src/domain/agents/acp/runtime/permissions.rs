//! ACP permission elicitation ⇄ Cadencr `RuntimePermission*` mapping.
//!
//! ACP delivers `session/request_permission` server-requests with a
//! `toolCall` and a `PermissionOption[]`. Each option carries
//! `{ optionId, name, kind }` where `kind ∈ allow_once | allow_always |
//! reject_once | reject_always`. The client answers with
//! `{ outcome: "selected", optionId } | { outcome: "cancelled" }`.
//!
//! Cadencr's UI renders three default options (AllowOnce / AllowFuture /
//! Deny) keyed by `RuntimePermissionDecision`. We map decisions to ACP
//! `optionId`s discovered in the request, falling back to canonical
//! "allow_once"/"allow_always"/"reject_once" strings when the agent didn't
//! advertise an explicit id.

use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};

pub use super::permissions_dispatch::{
    dispatch_permission_request, reject_all_pending, take_pending, PendingPermissions,
};
pub use super::permissions_typed::permission_request_from_typed;
use super::schema_bridge::{
    default_option_id, permission_response_value, resolve_permission_option,
};

/// Convert an ACP `session/request_permission` server-request payload into a
/// Cadencr `RuntimePermissionRequest`.
///
/// Returns `None` if the params are malformed (no `toolCall`); callers
/// should respond to the server-request with a JSON-RPC error in that case
/// rather than silently dropping it.
pub fn permission_request_from_acp(
    request_id: &str,
    params: &Value,
) -> Option<RuntimePermissionRequest> {
    let tool_call = params.get("toolCall")?;
    let tool_use_id = tool_call
        .get("toolCallId")
        .or_else(|| tool_call.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let tool_name = tool_call
        .get("toolName")
        .or_else(|| tool_call.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let tool_input = tool_call
        .get("toolInput")
        .or_else(|| tool_call.get("rawInput"))
        .cloned()
        .unwrap_or(Value::Null);
    let description = tool_call
        .get("title")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let preview = derive_preview(&tool_input);

    let options = params
        .get("options")
        .and_then(Value::as_array)
        .map(|opts| convert_options(opts))
        .unwrap_or_else(default_options);

    Some(RuntimePermissionRequest {
        request_id: request_id.to_string(),
        tool_use_id,
        tool_name,
        tool_input,
        description,
        pattern: None,
        preview,
        options,
    })
}

fn convert_options(raw: &[Value]) -> Vec<RuntimePermissionOption> {
    let mut out = Vec::new();
    for option in raw {
        let Some(option) = resolve_permission_option(option) else {
            continue;
        };
        let label = option
            .name
            .unwrap_or_else(|| default_label(option.decision).into());
        out.push(RuntimePermissionOption {
            decision: option.decision,
            option_id: option.option_id,
            label,
            description: default_description(option.decision).to_string(),
            collect_feedback: matches!(option.decision, RuntimePermissionDecision::Deny),
        });
    }
    if out.is_empty() {
        return default_options();
    }
    out
}

pub(super) fn default_options() -> Vec<RuntimePermissionOption> {
    [
        RuntimePermissionDecision::AllowOnce,
        RuntimePermissionDecision::AllowFuture,
        RuntimePermissionDecision::Deny,
    ]
    .into_iter()
    .map(|decision| RuntimePermissionOption {
        decision,
        option_id: Some(default_option_id(decision).to_string()),
        label: default_label(decision).to_string(),
        description: default_description(decision).to_string(),
        collect_feedback: matches!(decision, RuntimePermissionDecision::Deny),
    })
    .collect()
}

fn default_label(decision: RuntimePermissionDecision) -> &'static str {
    match decision {
        RuntimePermissionDecision::AllowOnce => "Allow",
        RuntimePermissionDecision::AllowFuture => "Always allow",
        RuntimePermissionDecision::AllowForSession => "Allow for this session",
        RuntimePermissionDecision::Deny => "Deny",
    }
}

pub(super) fn default_description(decision: RuntimePermissionDecision) -> &'static str {
    match decision {
        RuntimePermissionDecision::AllowOnce => "Approve this single request",
        RuntimePermissionDecision::AllowFuture => {
            "Approve similar requests in this and future sessions"
        }
        RuntimePermissionDecision::AllowForSession => {
            "Approve similar requests for the rest of this session"
        }
        RuntimePermissionDecision::Deny => "Reject this request",
    }
}

/// Best-effort extraction of a one-line preview ("read README.md", "rm -rf
/// /") for the permission drawer.
pub(super) fn derive_preview(tool_input: &Value) -> Option<String> {
    let common_keys = ["command", "cmd", "path", "filePath", "file_path", "url"];
    for key in common_keys {
        if let Some(value) = tool_input.get(key) {
            if let Some(s) = value.as_str() {
                return Some(s.to_string());
            }
            if let Some(arr) = value.as_array() {
                let joined = arr
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ");
                if !joined.is_empty() {
                    return Some(joined);
                }
            }
        }
    }
    None
}

/// Build the JSON payload Cadencr sends back as a response to
/// `session/request_permission`. Supports the cancellation case for when
/// the user closes the drawer without picking an option.
///
/// `feedback` is the optional user-typed reason that accompanies a Deny
/// decision. ACP doesn't define a first-class slot for it, so we attach
/// it under `_meta` AND mirror it as a top-level `feedback` field — agents
/// that recognise either form pick it up; the rest silently ignore the
/// extras (per JSON-RPC 2.0 / ACP passthrough).
pub fn acp_permission_response_payload(
    decision: RuntimePermissionDecision,
    option_id: Option<&str>,
    feedback: Option<&str>,
) -> Value {
    permission_response_value(decision, option_id, feedback)
}

#[cfg(test)]
mod tests {
    use super::{acp_permission_response_payload, default_options, permission_request_from_acp};
    use crate::domain::agents::adapter::RuntimePermissionDecision;
    use serde_json::json;

    #[test]
    fn parse_extracts_tool_metadata_and_options() {
        let req = permission_request_from_acp(
            "perm-1",
            &json!({
                "sessionId": "s1",
                "toolCall": {
                    "toolCallId": "call-9",
                    "toolName": "Bash",
                    "toolInput": { "command": "ls" },
                    "title": "Run a shell command",
                },
                "options": [
                    { "optionId": "y1", "name": "Allow once", "kind": "allow_once" },
                    { "optionId": "y2", "name": "Always", "kind": "allow_always" },
                    { "optionId": "n1", "name": "Reject", "kind": "reject_once" }
                ]
            }),
        )
        .expect("expected permission request");
        assert_eq!(req.request_id, "perm-1");
        assert_eq!(req.tool_use_id.as_deref(), Some("call-9"));
        assert_eq!(req.tool_name, "Bash");
        assert_eq!(req.preview.as_deref(), Some("ls"));
        assert_eq!(req.description.as_deref(), Some("Run a shell command"));
        assert_eq!(req.options.len(), 3);
        assert_eq!(
            req.options[0].decision,
            RuntimePermissionDecision::AllowOnce
        );
        assert_eq!(req.options[0].option_id.as_deref(), Some("y1"));
    }

    #[test]
    fn parse_returns_none_when_tool_call_missing() {
        assert!(permission_request_from_acp("p", &json!({})).is_none());
    }

    #[test]
    fn parse_falls_back_to_default_options_when_none_provided() {
        let req = permission_request_from_acp(
            "p",
            &json!({
                "toolCall": { "toolName": "Read", "toolInput": { "filePath": "/x" } }
            }),
        )
        .unwrap();
        assert_eq!(req.options.len(), 3);
    }

    #[test]
    fn parse_accepts_minimal_raw_canonical_options() {
        let req = permission_request_from_acp(
            "p",
            &json!({
                "toolCall": { "toolName": "Read", "toolInput": { "filePath": "/x" } },
                "options": [
                    { "kind": "allow_once" },
                    { "kind": "allow_for_session", "optionId": "session" },
                    { "kind": "reject_always" }
                ]
            }),
        )
        .unwrap();
        assert_eq!(req.options.len(), 3);
        assert_eq!(
            req.options[0].decision,
            RuntimePermissionDecision::AllowOnce
        );
        assert_eq!(
            req.options[1].decision,
            RuntimePermissionDecision::AllowForSession
        );
        assert_eq!(req.options[1].option_id.as_deref(), Some("session"));
        assert_eq!(req.options[2].decision, RuntimePermissionDecision::Deny);
    }

    #[test]
    fn allow_once_response_payload_has_selected_outcome() {
        let payload =
            acp_permission_response_payload(RuntimePermissionDecision::AllowOnce, None, None);
        assert_eq!(payload["outcome"]["outcome"], "selected");
        assert_eq!(payload["outcome"]["optionId"], "allow_once");
        assert!(payload.get("feedback").is_none());
    }

    #[test]
    fn allow_future_uses_allow_always_when_no_option_id() {
        let payload =
            acp_permission_response_payload(RuntimePermissionDecision::AllowFuture, None, None);
        assert_eq!(payload["outcome"]["optionId"], "allow_always");
    }

    #[test]
    fn explicit_option_id_overrides_default() {
        let payload = acp_permission_response_payload(
            RuntimePermissionDecision::Deny,
            Some("custom-no"),
            None,
        );
        assert_eq!(payload["outcome"]["optionId"], "custom-no");
    }

    #[test]
    fn deny_feedback_propagates_to_payload() {
        let payload = acp_permission_response_payload(
            RuntimePermissionDecision::Deny,
            None,
            Some("not safe to run"),
        );
        assert_eq!(payload["feedback"], "not safe to run");
        assert_eq!(payload["_meta"]["feedback"], "not safe to run");
    }

    #[test]
    fn empty_feedback_is_omitted() {
        let payload =
            acp_permission_response_payload(RuntimePermissionDecision::Deny, None, Some(""));
        assert!(payload.get("feedback").is_none());
        assert!(payload.get("_meta").is_none());
    }

    #[test]
    fn defaults_have_three_options_in_canonical_order() {
        let opts = default_options();
        assert_eq!(opts.len(), 3);
        assert_eq!(opts[0].decision, RuntimePermissionDecision::AllowOnce);
        assert_eq!(opts[1].decision, RuntimePermissionDecision::AllowFuture);
        assert_eq!(opts[2].decision, RuntimePermissionDecision::Deny);
    }
}
