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
        _ => serde_json::json!({
            "granular": {
                "sandbox_approval": true,
                "rules": true,
                "skill_approval": true,
                "request_permissions": true,
                "mcp_elicitations": true
            }
        }),
    }
}

pub fn sandbox_mode(mode: Option<&RuntimePermissionMode>) -> serde_json::Value {
    match mode {
        Some(RuntimePermissionMode::Plan) => serde_json::Value::String("read-only".to_string()),
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
        Some(RuntimePermissionMode::Plan) => serde_json::json!({
            "type": "readOnly",
            "access": { "type": "fullAccess" },
            "networkAccess": false
        }),
        Some(RuntimePermissionMode::BypassPermissions) => {
            serde_json::json!({ "type": "dangerFullAccess" })
        }
        _ => serde_json::json!({
            "type": "workspaceWrite",
            "writableRoots": [cwd.to_string_lossy().to_string()],
            "readOnlyAccess": { "type": "fullAccess" },
            "networkAccess": true,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{sandbox_policy, RuntimePermissionMode};
    use std::path::Path;

    #[test]
    fn read_only_policy_matches_codex_schema() {
        let policy = sandbox_policy(Some(&RuntimePermissionMode::Plan), Path::new("/tmp/app"));
        assert_eq!(policy["type"], "readOnly");
        assert_eq!(policy["access"]["type"], "fullAccess");
        assert_eq!(policy["networkAccess"], false);
    }

    #[test]
    fn workspace_write_policy_matches_codex_schema() {
        let policy = sandbox_policy(None, Path::new("/tmp/app"));
        assert_eq!(policy["type"], "workspaceWrite");
        assert_eq!(policy["writableRoots"][0], "/tmp/app");
        assert_eq!(policy["readOnlyAccess"]["type"], "fullAccess");
        assert_eq!(policy["networkAccess"], true);
        assert_eq!(policy["excludeTmpdirEnvVar"], false);
        assert_eq!(policy["excludeSlashTmp"], false);
    }
}
