use serde_json::Value;

use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionOption};

use super::super::schema_bridge::default_option_id;

pub(in crate::domain::agents::acp::runtime) fn permission_option(
    decision: RuntimePermissionDecision,
    option_id: Option<String>,
    label: Option<String>,
) -> RuntimePermissionOption {
    RuntimePermissionOption {
        decision,
        option_id,
        label: label.unwrap_or_else(|| default_label(decision).to_string()),
        description: default_description(decision).to_string(),
        collect_feedback: matches!(decision, RuntimePermissionDecision::Deny),
    }
}

pub(in crate::domain::agents::acp::runtime) fn default_options() -> Vec<RuntimePermissionOption> {
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

fn default_description(decision: RuntimePermissionDecision) -> &'static str {
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
pub(in crate::domain::agents::acp::runtime) fn derive_preview(
    tool_input: &Value,
) -> Option<String> {
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
