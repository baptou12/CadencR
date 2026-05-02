use crate::domain::agents::adapter::RuntimePermissionMode;

pub fn accepts_model(model: &str) -> bool {
    let trimmed = model.trim();
    // Codex owns only bare OpenAI-style model ids. Slash-qualified refs
    // (`provider/model`) stay available to OpenCode via adapter order.
    !trimmed.contains('/') && (trimmed.starts_with("gpt-") || trimmed.starts_with("codex-"))
}

pub fn approval_policy(mode: Option<&RuntimePermissionMode>) -> serde_json::Value {
    match mode {
        Some(RuntimePermissionMode::BypassPermissions) | Some(RuntimePermissionMode::DontAsk) => {
            serde_json::Value::String("never".to_string())
        }
        _ => serde_json::Value::String("on-request".to_string()),
    }
}

pub fn sandbox_mode(mode: Option<&RuntimePermissionMode>) -> serde_json::Value {
    // Plan mode does NOT change the sandbox: planning is signaled via the
    // `plan_mode` hint emitted at turn start (see codex/turn_start.rs). This
    // keeps the user's chosen permission level intact while still asking the
    // model to plan rather than execute. Only the explicit "Full Access"
    // escape hatch (mapped from BypassPermissions) widens the sandbox.
    match mode {
        Some(RuntimePermissionMode::BypassPermissions) | Some(RuntimePermissionMode::DontAsk) => {
            serde_json::Value::String("danger-full-access".to_string())
        }
        _ => serde_json::Value::String("workspace-write".to_string()),
    }
}

pub fn sandbox_policy(
    mode: Option<&RuntimePermissionMode>,
    cwd: &std::path::Path,
) -> serde_json::Value {
    match mode {
        Some(RuntimePermissionMode::BypassPermissions) => {
            serde_json::json!({ "type": "dangerFullAccess" })
        }
        _ => serde_json::json!({
            "type": "workspaceWrite",
            "writableRoots": [cwd.to_string_lossy().to_string()],
            "readOnlyAccess": { "type": "fullAccess" },
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{approval_policy, sandbox_policy, RuntimePermissionMode};
    use std::path::Path;

    #[test]
    fn approval_policy_uses_interactive_on_request_for_codex_escalations() {
        assert_eq!(approval_policy(None), serde_json::json!("on-request"));
        assert_eq!(
            approval_policy(Some(&RuntimePermissionMode::AcceptEdits)),
            serde_json::json!("on-request")
        );
        assert_eq!(
            approval_policy(Some(&RuntimePermissionMode::Plan)),
            serde_json::json!("on-request")
        );
        assert_eq!(
            approval_policy(Some(&RuntimePermissionMode::BypassPermissions)),
            serde_json::json!("never")
        );
    }

    #[test]
    fn plan_mode_keeps_workspace_write_sandbox() {
        // Codex has no native plan flag. We signal planning via the turn-start
        // `plan_mode` hint, NOT by narrowing the sandbox — see
        // codex/turn_start.rs and codex/model.rs::sandbox_policy.
        let policy = sandbox_policy(Some(&RuntimePermissionMode::Plan), Path::new("/tmp/app"));
        assert_eq!(policy["type"], "workspaceWrite");
        assert_eq!(policy["writableRoots"][0], "/tmp/app");
    }

    #[test]
    fn workspace_write_policy_matches_codex_schema() {
        let policy = sandbox_policy(None, Path::new("/tmp/app"));
        assert_eq!(policy["type"], "workspaceWrite");
        assert_eq!(policy["writableRoots"][0], "/tmp/app");
        assert_eq!(policy["readOnlyAccess"]["type"], "fullAccess");
        assert_eq!(policy["networkAccess"], false);
        assert_eq!(policy["excludeTmpdirEnvVar"], false);
        assert_eq!(policy["excludeSlashTmp"], false);
    }

    #[test]
    fn full_access_policy_uses_danger_full_access() {
        let policy = sandbox_policy(
            Some(&RuntimePermissionMode::BypassPermissions),
            Path::new("/tmp/app"),
        );
        assert_eq!(policy["type"], "dangerFullAccess");
    }
}
