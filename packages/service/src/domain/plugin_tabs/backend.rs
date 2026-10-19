//! Native backends (`docs/CUSTOM_TABS.md` §4.7): the process a tab declares in
//! `tab.json` `backend`, started by Cadencr when the tab first calls
//! `backend.request`.
//!
//! One backend runs per tab and conversation, shared by that conversation's
//! open instances of the tab. It runs with the user's rights — Cadencr does
//! not sandbox it — but it never receives the main token: its first stdin line
//! carries its own grant, with the tab's consented scopes, bound to the
//! conversation. It is stopped once no instance holds a presence lease
//! ([`reap_orphans`], however long the tab stays open before that), when its
//! grant is revoked (permissions changed, tab turned off), or from the tab's
//! Activity dialog.

mod history;
mod launch;
mod lines;
pub mod models;
mod process;
mod protocol;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use tokio::sync::Mutex;

use self::history::History;
pub use self::launch::BackendLaunch;
use self::models::{PluginBackendRequest, PluginBackendResponse, PluginTabBackendStatus};
use self::process::Running;
use super::exec::request_timeout;
use super::grants::GrantStore;
use super::presence::PresenceStore;
use crate::error::AppError;

pub const MAX_METHOD_CHARS: usize = 128;
pub const MAX_PARAMS_BYTES: usize = 1024 * 1024;
/// How long a backend survives with no open instance of its tab: covers a
/// tab moved between panes, which releases its lease and takes a new one.
const ORPHAN_GRACE: Duration = Duration::from_secs(30);
const REAP_INTERVAL: Duration = Duration::from_secs(10);

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

#[derive(Default)]
struct Slots {
    by_key: HashMap<Key, Slot>,
    /// Set by [`BackendSupervisor::shutdown`]: nothing starts after it.
    closed: bool,
}

/// Every tab backend of this process. Cheap to clone.
#[derive(Clone, Default)]
pub struct BackendSupervisor {
    slots: Arc<Mutex<Slots>>,
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
        if slots.closed {
            return Err(AppError::coded(
                StatusCode::SERVICE_UNAVAILABLE,
                "PLUGIN_BACKEND_UNAVAILABLE",
                "Cadencr is quitting",
            ));
        }
        let slot = slots
            .by_key
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
        let slot = slots.by_key.get(&Key {
            plugin_id: plugin_id.to_string(),
            feature_id,
        })?;
        Some(slot.history.status(slot.live().map(|running| running.pid)))
    }

    /// Stop it, and forget recent crashes so the next request starts afresh.
    pub async fn stop(&self, plugin_id: &str, feature_id: i64) {
        let mut slots = self.slots.lock().await;
        let Some(slot) = slots.by_key.get_mut(&Key {
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

    /// Stop the backends whose tab has had no open instance (no presence
    /// lease) in their conversation for [`ORPHAN_GRACE`].
    async fn reap(&self, presence: &PresenceStore) {
        let mut slots = self.slots.lock().await;
        for (key, slot) in slots.by_key.iter_mut() {
            let Some(running) = slot.usable().cloned() else {
                slot.orphaned_since = None;
                continue;
            };
            if presence.is_open(&key.plugin_id, key.feature_id) {
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

    /// Cadencr is quitting: stop every backend and wait, bounded, for each
    /// process tree to be gone — dropping the supervising tasks with the
    /// runtime would only kill each backend's main process.
    pub async fn shutdown(&self) {
        let running: Vec<Arc<Running>> = {
            let mut slots = self.slots.lock().await;
            slots.closed = true;
            slots
                .by_key
                .values()
                .filter_map(Slot::live)
                .cloned()
                .collect()
        };
        for backend in &running {
            backend.request_stop("Cadencr quit");
        }
        let exited =
            futures::future::join_all(running.iter().map(|backend| backend.exited.cancelled()));
        if tokio::time::timeout(process::STOP_DEADLINE, exited)
            .await
            .is_err()
        {
            // Cadencr is going away, so its log is the only place left to say
            // which processes may outlive it.
            let pids: Vec<u32> = running
                .iter()
                .filter(|backend| backend.is_live())
                .map(|backend| backend.pid)
                .collect();
            tracing::error!(
                ?pids,
                "custom tab backends had not exited when Cadencr quit; they may still be running"
            );
        }
    }

    /// Start [`reap_orphans`] for the life of the service: a tab's backend
    /// stops once no instance of the tab is open.
    pub fn spawn_reaper(&self, presence: &PresenceStore) {
        tokio::spawn(reap_orphans(self.clone(), presence.clone()));
    }
}

/// Runs for the life of the service: see [`BackendSupervisor::reap`].
async fn reap_orphans(supervisor: BackendSupervisor, presence: PresenceStore) {
    let mut interval = tokio::time::interval(REAP_INTERVAL);
    loop {
        interval.tick().await;
        supervisor.reap(&presence).await;
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
    use std::path::PathBuf;

    use serde_json::{json, Value};

    use super::launch::tests::launch_in;
    use super::*;

    fn request(method: &str, params: Value, timeout_ms: Option<u64>) -> PluginBackendRequest {
        PluginBackendRequest {
            method: method.into(),
            params,
            timeout_ms,
        }
    }

    /// A tab folder whose backend never reads stdin and leaves a child
    /// process (its pid in `child.pid`) behind it.
    #[cfg(unix)]
    fn deaf_backend() -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().canonicalize().unwrap();
        std::fs::create_dir(dir.join("bin")).unwrap();
        let script = dir.join("bin/backend");
        std::fs::write(
            &script,
            "#!/bin/sh\n/bin/sleep 300 &\necho $! > child.pid\nexec /bin/sleep 300\n",
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        (root, dir)
    }

    #[cfg(unix)]
    fn is_alive(pid: &str) -> bool {
        std::process::Command::new("kill")
            .args(["-0", pid])
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_backend_that_stops_reading_times_requests_out() {
        let (_root, dir) = deaf_backend();
        let (supervisor, grants) = (BackendSupervisor::default(), GrantStore::default());
        // Big enough to fill the stdin pipe, then the request queue behind it.
        let params = json!("x".repeat(MAX_PARAMS_BYTES - 16));
        let calls = async {
            for _ in 0..process::MAX_PENDING + 4 {
                let error = supervisor
                    .request(
                        &grants,
                        launch_in(&dir, "bin/backend"),
                        request("m", params.clone(), Some(50)),
                    )
                    .await
                    .unwrap_err();
                assert!(
                    matches!(
                        error,
                        AppError::Coded {
                            code: "PLUGIN_BACKEND_TIMEOUT",
                            ..
                        }
                    ),
                    "{error:?}"
                );
            }
        };
        tokio::time::timeout(Duration::from_secs(20), calls)
            .await
            .expect("every request ends at its own deadline");
        supervisor.shutdown().await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_stops_whole_backend_trees_and_refuses_new_ones() {
        let (_root, dir) = deaf_backend();
        let (supervisor, grants) = (BackendSupervisor::default(), GrantStore::default());
        let call = || {
            supervisor.request(
                &grants,
                launch_in(&dir, "bin/backend"),
                request("m", Value::Null, Some(200)),
            )
        };
        assert!(call().await.is_err(), "the backend never answers");
        let child = std::fs::read_to_string(dir.join("child.pid")).unwrap();
        let child = child.trim();
        assert!(is_alive(child));
        supervisor.shutdown().await;
        assert!(
            !is_alive(child),
            "the backend's child outlived the shutdown"
        );
        let refused = call().await.unwrap_err();
        assert!(matches!(
            refused,
            AppError::Coded {
                code: "PLUGIN_BACKEND_UNAVAILABLE",
                ..
            }
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_backend_stops_only_once_its_tab_holds_no_lease() {
        let (_root, dir) = deaf_backend();
        let (supervisor, grants) = (BackendSupervisor::default(), GrantStore::default());
        let presence = PresenceStore::default();
        presence.renew("lease", "tab", 2).unwrap();
        let _ = supervisor
            .request(
                &grants,
                launch_in(&dir, "bin/backend"),
                request("m", Value::Null, Some(50)),
            )
            .await;
        let running = || async {
            let slots = supervisor.slots.lock().await;
            slots.by_key.values().find_map(Slot::usable).is_some()
        };
        // Its grant never lapses and the tab, however idle, holds a lease.
        supervisor.reap(&presence).await;
        assert!(running().await);
        presence.release("lease", "tab");
        supervisor.reap(&presence).await;
        assert!(running().await, "the grace has not run out yet");
        for slot in supervisor.slots.lock().await.by_key.values_mut() {
            slot.orphaned_since = Instant::now().checked_sub(ORPHAN_GRACE);
        }
        supervisor.reap(&presence).await;
        assert!(!running().await);
        supervisor.shutdown().await;
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
}
