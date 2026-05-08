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

use serde_json::{json, Value};

use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionOption, RuntimePermissionRequest,
};

/// Convert an ACP `session/request_permission` server-request payload into a
/// Cadencr `RuntimePermissionRequest`.
///
/// Returns `None` if the params are malformed (no `toolCall`); callers
/// should respond to the server-request with a JSON-RPC error in that case
/// rather than silently dropping it.
pub(super) fn permission_request_from_acp(
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
        let decision = match option.get("kind").and_then(Value::as_str).unwrap_or("") {
            "allow_once" => RuntimePermissionDecision::AllowOnce,
            "allow_always" => RuntimePermissionDecision::AllowFuture,
            "reject_once" | "reject_always" => RuntimePermissionDecision::Deny,
            _ => continue,
        };
        let option_id = option
            .get("optionId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let label = option
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_else(|| default_label(decision))
            .to_string();
        out.push(RuntimePermissionOption {
            decision,
            option_id,
            label,
            description: default_description(decision).to_string(),
            collect_feedback: matches!(decision, RuntimePermissionDecision::Deny),
        });
    }
    if out.is_empty() {
        return default_options();
    }
    out
}

fn default_options() -> Vec<RuntimePermissionOption> {
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

fn default_option_id(decision: RuntimePermissionDecision) -> &'static str {
    match decision {
        RuntimePermissionDecision::AllowOnce => "allow_once",
        RuntimePermissionDecision::AllowFuture => "allow_always",
        RuntimePermissionDecision::Deny => "reject_once",
    }
}

fn default_label(decision: RuntimePermissionDecision) -> &'static str {
    match decision {
        RuntimePermissionDecision::AllowOnce => "Allow",
        RuntimePermissionDecision::AllowFuture => "Allow for this session",
        RuntimePermissionDecision::Deny => "Deny",
    }
}

fn default_description(decision: RuntimePermissionDecision) -> &'static str {
    match decision {
        RuntimePermissionDecision::AllowOnce => "Approve this single request",
        RuntimePermissionDecision::AllowFuture => {
            "Approve similar requests for the rest of the session"
        }
        RuntimePermissionDecision::Deny => "Reject this request",
    }
}

/// Best-effort extraction of a one-line preview ("read README.md", "rm -rf
/// /") for the permission drawer. Mirrors the HTTP adapter behaviour but
/// without provider-specific knowledge — we just look at the most common
/// shape names.
fn derive_preview(tool_input: &Value) -> Option<String> {
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
pub(super) fn acp_permission_response_payload(
    decision: RuntimePermissionDecision,
    option_id: Option<&str>,
    feedback: Option<&str>,
) -> Value {
    let id = option_id.unwrap_or_else(|| default_option_id(decision));
    let mut payload = json!({
        "outcome": { "outcome": "selected", "optionId": id }
    });
    if let Some(text) = feedback.filter(|s| !s.is_empty()) {
        payload["feedback"] = Value::String(text.to_string());
        payload["_meta"] = json!({ "feedback": text });
    }
    payload
}

pub(super) fn acp_permission_cancel_payload() -> Value {
    json!({ "outcome": { "outcome": "cancelled" } })
}

#[cfg(test)]
mod tests {
    use super::{
        acp_permission_cancel_payload, acp_permission_response_payload, default_options,
        permission_request_from_acp,
    };
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
    fn cancel_payload_uses_cancelled_outcome() {
        assert_eq!(
            acp_permission_cancel_payload()["outcome"]["outcome"],
            "cancelled"
        );
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
