use serde_json::Value;

use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionOption};
use crate::domain::permission_bridge::extract_permission_preview;

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
    extract_permission_preview(tool_input)
}

#[cfg(test)]
mod tests {
    use super::derive_preview;
    use serde_json::json;

    #[test]
    fn derive_preview_extracts_nested_opencode_command_array() {
        let input = json!({
            "metadata": { "args": { "command": ["git", "status", "--short"] } }
        });
        assert_eq!(
            derive_preview(&input).as_deref(),
            Some("git status --short")
        );
    }
}
