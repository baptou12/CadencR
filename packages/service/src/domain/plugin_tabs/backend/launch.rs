//! What starting one tab's backend takes, and its `hello` line.

use std::path::PathBuf;

use cadencr_plugin_core::tab::{resolve_backend_file, BackendTarget, TabBackend};
use cli_discovery::find_on_path;
use serde_json::{json, Value};

use super::super::policy::Scope;
use super::super::principal::PLUGIN_TOKEN_HEADER;

/// The stdio protocol version sent in `hello`.
pub const PROTOCOL_VERSION: u32 = 1;

/// Everything needed to start one tab's backend in one conversation.
#[derive(Debug, Clone)]
pub struct BackendLaunch {
    pub plugin_id: String,
    pub plugin_version: String,
    pub project_id: i64,
    pub feature_id: i64,
    /// The tab folder (canonical): the backend's working directory.
    pub plugin_dir: PathBuf,
    /// The conversation's folder, sent in `hello`.
    pub worktree: PathBuf,
    pub backend: TabBackend,
    pub scopes: Vec<Scope>,
    pub permissions_hash: String,
    /// `http://127.0.0.1:<port>`, for the backend's own API calls.
    pub api_base_url: String,
}

impl BackendLaunch {
    /// The program to run: inside the tab folder for a path, else on `PATH`.
    pub(super) fn executable(&self) -> Result<PathBuf, String> {
        match self.backend.target() {
            BackendTarget::FolderFile(path) => resolve_backend_file(&self.plugin_dir, path),
            BackendTarget::Program(program) => {
                find_on_path(program).ok_or_else(|| format!("`{program}` was not found on PATH"))
            }
        }
    }

    /// The first stdin line.
    pub(super) fn hello(&self, token: &str) -> Value {
        json!({
            "type": "hello",
            "protocol": PROTOCOL_VERSION,
            "plugin": { "id": self.plugin_id, "version": self.plugin_version },
            "project_id": self.project_id,
            "feature_id": self.feature_id,
            "worktree": self.worktree,
            "scopes": self.scopes.iter().map(|scope| scope.as_str()).collect::<Vec<_>>(),
            "api": {
                "base_url": self.api_base_url,
                "token_header": PLUGIN_TOKEN_HEADER,
                "token": token,
            },
        })
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub(in crate::domain::plugin_tabs::backend) fn launch_in(
        dir: &std::path::Path,
        command: &str,
    ) -> BackendLaunch {
        BackendLaunch {
            plugin_id: "tab".into(),
            plugin_version: "0.1.0".into(),
            project_id: 1,
            feature_id: 2,
            plugin_dir: dir.to_path_buf(),
            worktree: dir.to_path_buf(),
            backend: TabBackend {
                command: command.into(),
                args: vec![],
                reasoning: Some("r".into()),
            },
            scopes: vec![Scope::FeaturesRead],
            permissions_hash: "h".into(),
            api_base_url: "http://127.0.0.1:1".into(),
        }
    }

    #[test]
    fn executables_stay_inside_the_tab_folder() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("tab")).unwrap();
        let dir = root.path().join("tab").canonicalize().unwrap();
        std::fs::create_dir(dir.join("bin")).unwrap();
        std::fs::write(dir.join("bin/backend"), "x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let executable = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(dir.join("bin/backend"), executable).unwrap();
        }
        std::fs::write(root.path().join("outside"), "x").unwrap();
        let launch = |command: &str| launch_in(&dir, command);
        assert_eq!(
            launch("bin/backend").executable().unwrap(),
            dir.join("bin/backend")
        );
        assert!(launch("bin/missing").executable().is_err());
        assert!(launch("bin/../../outside").executable().is_err());
        assert!(launch("definitely-not-a-program-xyz").executable().is_err());
        let hello = launch("bin/backend").hello("secret");
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["api"]["token"], "secret");
        assert_eq!(hello["api"]["token_header"], PLUGIN_TOKEN_HEADER);
        assert_eq!(hello["scopes"], json!(["features:read"]));
    }
}
