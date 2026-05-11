use serde_json::json;

use super::permission_options::command_permission_options;
use crate::domain::agents::adapter::RuntimePermissionDecision;

#[test]
fn synthesized_execpolicy_decision_reuses_native_command_option_mapping() {
    let options = command_permission_options(
        &json!({ "proposedExecpolicyAmendment": ["cargo", "test"] }),
        true,
    );

    assert!(options.iter().any(|option| {
        option.label == "Approve similar commands"
            && option.decision == RuntimePermissionDecision::AllowFuture
    }));
}

#[test]
fn synthesized_network_policy_decision_reuses_native_command_option_mapping() {
    let options = command_permission_options(
        &json!({
            "proposedNetworkPolicyAmendments": [
                { "action": "deny", "host": "example.com" }
            ]
        }),
        false,
    );

    assert!(options.iter().any(|option| {
        option.label == "Block host in future" && option.decision == RuntimePermissionDecision::Deny
    }));
}
