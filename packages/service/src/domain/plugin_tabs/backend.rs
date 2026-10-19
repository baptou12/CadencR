//! Native backends (`docs/CUSTOM_TABS.md` §4.7): the process a tab declares in
//! `tab.json` `backend`, started by Cadencr when the tab first calls
//! `backend.request`.
//!
//! One backend runs per tab and conversation, shared by that conversation's
//! open instances of the tab. It runs with the user's rights — Cadencr does
//! not sandbox it — but it never receives the main token: its first stdin line
//! carries its own grant, with the tab's consented scopes, bound to the
//! conversation. It is stopped when the last instance closes
//! ([`reap_orphans`]), when its grant is revoked (permissions changed, tab
//! turned off), or from the tab's Activity dialog.

mod history;
mod lines;
pub mod models;
mod process;
mod protocol;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use cadencr_plugin_core::tab::{resolve_backend_file, BackendTarget, TabBackend};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use self::history::History;
use self::models::{PluginBackendRequest, PluginBackendResponse, PluginTabBackendStatus};
use self::process::Running;
use super::exec::request_timeout;
use super::grants::GrantStore;
use super::policy::Scope;
use super::principal::PLUGIN_TOKEN_HEADER;
use crate::error::AppError;
use cli_discovery::find_on_path;

pub const MAX_METHOD_CHARS: usize = 128;
pub const MAX_PARAMS_BYTES: usize = 1024 * 1024;
/// The stdio protocol version sent in `hello`.
pub const PROTOCOL_VERSION: u32 = 1;
/// How long a backend survives with no open instance of its tab.
const ORPHAN_GRACE: Duration = Duration::from_secs(30);
const REAP_INTERVAL: Duration = Duration::from_secs(10);

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
    fn executable(&self) -> Result<PathBuf, String> {
        match self.backend.target() {
            BackendTarget::FolderFile(path) => resolve_backend_file(&self.plugin_dir, path),
            BackendTarget::Program(program) => {
                find_on_path(program).ok_or_else(|| format!("`{program}` was not found on PATH"))
            }
        }
    }

    /// The first stdin line.
    fn hello(&self, token: &str) -> Value {
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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Key {
    plugin_id: String,
    feature_id: i64,
}

#[derive(Default)]
struct Slot {
    running: Option<Arc<Running>>,
    history: Arc<History>,
    orphaned_since: Option<Instant>,
}

impl Slot {
    /// The process, while it has not exited (it may be stopping).
    fn live(&self) -> Option<&Arc<Running>> {
        self.running.as_ref().filter(|running| running.is_live())
    }

    /// The process new requests may use.
    fn usable(&self) -> Option<&Arc<Running>> {
        self.running.as_ref().filter(|running| running.is_usable())
    }
}

/// Every tab backend of this process. Cheap to clone.
#[derive(Clone, Default)]
pub struct BackendSupervisor {
    slots: Arc<Mutex<HashMap<Key, Slot>>>,
}

impl BackendSupervisor {
    /// Relay `request` to `launch`'s backend, starting it first if needed.
    pub async fn request(
        &self,
        grants: &GrantStore,
        launch: BackendLaunch,
        request: PluginBackendRequest,
    ) -> Result<PluginBackendResponse, AppError> {
        let timeout = check_request(&request)?;
        let running = self.ensure_running(grants, &launch).await?;
        running.call(&request.method, request.params, timeout).await
    }

    async fn ensure_running(
        &self,
        grants: &GrantStore,
        launch: &BackendLaunch,
    ) -> Result<Arc<Running>, AppError> {
        let mut slots = self.slots.lock().await;
        let slot = slots
            .entry(Key {
                plugin_id: launch.plugin_id.clone(),
                feature_id: launch.feature_id,
            })
            .or_default();
        if let Some(running) = slot.usable() {
            if running.permissions_hash == launch.permissions_hash {
                return Ok(running.clone());
            }
            running.request_stop("its permissions changed");
        }
        slot.history.check_not_crash_looping()?;
        let running = process::spawn(launch, grants, slot.history.clone())?;
        slot.running = Some(running.clone());
        slot.orphaned_since = None;
        Ok(running)
    }

    /// The backend of `plugin_id` in `feature_id`; `None` if it never started.
    pub async fn status(&self, plugin_id: &str, feature_id: i64) -> Option<PluginTabBackendStatus> {
        let slots = self.slots.lock().await;
        let slot = slots.get(&Key {
            plugin_id: plugin_id.to_string(),
            feature_id,
        })?;
        Some(slot.history.status(slot.live().map(|running| running.pid)))
    }

    /// Stop it, and forget recent crashes so the next request starts afresh.
    pub async fn stop(&self, plugin_id: &str, feature_id: i64) {
        let mut slots = self.slots.lock().await;
        let Some(slot) = slots.get_mut(&Key {
            plugin_id: plugin_id.to_string(),
            feature_id,
        }) else {
            return;
        };
        slot.history.reset_crashes();
        if let Some(running) = slot.usable() {
            running.request_stop("stopped from the tab's Activity");
        }
    }

    /// Stop the backends whose tab has had no open instance (no live grant
    /// besides the backend's own) for [`ORPHAN_GRACE`]. The grace covers an
    /// instance renewing its grant.
    async fn reap(&self, grants: &GrantStore) {
        let mut slots = self.slots.lock().await;
        for (key, slot) in slots.iter_mut() {
            let Some(running) = slot.usable().cloned() else {
                slot.orphaned_since = None;
                continue;
            };
            if grants.has_other_live(&key.plugin_id, key.feature_id, &running.grant_key) {
                slot.orphaned_since = None;
                continue;
            }
            let since = *slot.orphaned_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= ORPHAN_GRACE {
                tracing::info!(
                    plugin_id = key.plugin_id,
                    feature_id = key.feature_id,
                    "custom tab closed; stopping its backend"
                );
                running.request_stop("its tab was closed");
                slot.orphaned_since = None;
            }
        }
    }
}

/// Runs for the life of the service: see [`BackendSupervisor::reap`].
pub async fn reap_orphans(supervisor: BackendSupervisor, grants: GrantStore) {
    let mut interval = tokio::time::interval(REAP_INTERVAL);
    loop {
        interval.tick().await;
        supervisor.reap(&grants).await;
    }
}

fn check_request(request: &PluginBackendRequest) -> Result<Duration, AppError> {
    let method_chars = request.method.chars().count();
    if method_chars == 0 || method_chars > MAX_METHOD_CHARS {
        return Err(AppError::BadRequest(format!(
            "method must be 1–{MAX_METHOD_CHARS} characters"
        )));
    }
    let params_bytes = serde_json::to_vec(&request.params).map_or(usize::MAX, |bytes| bytes.len());
    if params_bytes > MAX_PARAMS_BYTES {
        return Err(AppError::BadRequest(format!(
            "params must be at most {} KiB of JSON",
            MAX_PARAMS_BYTES / 1024
        )));
    }
    request_timeout(request.timeout_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, params: Value, timeout_ms: Option<u64>) -> PluginBackendRequest {
        PluginBackendRequest {
            method: method.into(),
            params,
            timeout_ms,
        }
    }

    #[test]
    fn requests_are_bounded() {
        assert_eq!(
            check_request(&request("list", json!({}), None)).ok(),
            Some(super::super::exec::DEFAULT_TIMEOUT)
        );
        for bad in [
            request("", Value::Null, None),
            request(&"m".repeat(129), Value::Null, None),
            request("m", json!("x".repeat(MAX_PARAMS_BYTES)), None),
            request("m", Value::Null, Some(0)),
            request("m", Value::Null, Some(120_001)),
        ] {
            assert!(check_request(&bad).is_err());
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
        let launch = |command: &str| BackendLaunch {
            plugin_id: "tab".into(),
            plugin_version: "0.1.0".into(),
            project_id: 1,
            feature_id: 2,
            plugin_dir: dir.clone(),
            worktree: dir.clone(),
            backend: TabBackend {
                command: command.into(),
                args: vec![],
                reasoning: Some("r".into()),
            },
            scopes: vec![Scope::FeaturesRead],
            permissions_hash: "h".into(),
            api_base_url: "http://127.0.0.1:1".into(),
        };
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
