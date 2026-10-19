//! One run of a tab's backend process: spawn, supervise, shutdown. The stdio
//! protocol itself is in [`super::protocol`]. A stopped backend gets its stdin
//! closed; after a grace period the whole process tree is terminated.

use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{json, Value};
use tokio::process::Child;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::history::{ExitRecord, History};
use super::models::PluginBackendResponse;
use super::protocol::{lock, read_stderr, read_stdout, write_stdin, Pending, Reply};
use super::BackendLaunch;
use crate::domain::agents::acp::process_tree::ProcessTreeControl;
use crate::domain::agents::providers::installed::managed::process_policy::{
    managed_command, managed_process_tree_policy,
};
use crate::domain::plugin_tabs::grants::{GrantRequest, GrantStore, Lifetime};
use crate::error::AppError;

/// Requests one backend may have in flight.
pub const MAX_PENDING: usize = 16;
/// How long a backend has to exit after its stdin closes.
const EXIT_GRACE: Duration = Duration::from_secs(2);
const TERMINATE_GRACE: Duration = Duration::from_secs(3);
/// Upper bound on one stop: both graces, plus the tree cleanup.
pub const STOP_DEADLINE: Duration = Duration::from_secs(8);

/// A live backend process.
pub(super) struct Running {
    pub pid: u32,
    /// Which start of this backend it is (see [`History::record_start`]).
    run: u32,
    pub grant_key: String,
    pub permissions_hash: String,
    /// Cancelled to stop the process; [`Running::request_stop`] also says why.
    pub stop: CancellationToken,
    stop_reason: OnceLock<&'static str>,
    /// Cancelled once the process has exited and been cleaned up.
    pub exited: CancellationToken,
    stdin: mpsc::Sender<String>,
    pending: Pending,
    next_id: AtomicU64,
}

impl Running {
    /// The process has not exited yet (it may be stopping).
    pub fn is_live(&self) -> bool {
        !self.exited.is_cancelled()
    }

    /// Ask the process to stop. `reason` ends up in its Activity ("why it
    /// last stopped"); the first reason given wins.
    pub fn request_stop(&self, reason: &'static str) {
        let _ = self.stop_reason.set(reason);
        self.stop.cancel();
    }

    /// Live and not asked to stop: new requests may use it.
    pub fn is_usable(&self) -> bool {
        self.is_live() && !self.stop.is_cancelled()
    }

    /// Send one request and wait for its response.
    pub async fn call(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<PluginBackendResponse, AppError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = lock(&self.pending);
            if pending.len() >= MAX_PENDING {
                return Err(AppError::coded(
                    StatusCode::TOO_MANY_REQUESTS,
                    "PLUGIN_BACKEND_BUSY",
                    format!("at most {MAX_PENDING} backend requests at a time"),
                ));
            }
            pending.insert(id.clone(), tx);
        }
        // However this call ends — answered, timed out, or dropped because
        // the tab went away — its slot is freed.
        let _waiting = Waiting {
            pending: &self.pending,
            id: &id,
        };
        let line = json!({"type": "request", "id": id, "method": method, "params": params});
        // One deadline for both: a backend that stops reading stdin fills the
        // queue, and `send` would otherwise wait on it forever.
        let exchange = async {
            if self.stdin.send(line.to_string()).await.is_err() {
                return Err(exited_error("the backend is not running"));
            }
            match rx.await {
                Ok(Reply::Response(response)) => Ok(response),
                Ok(Reply::Exited(reason)) => Err(exited_error(&reason)),
                Err(_) => Err(exited_error("the backend stopped")),
            }
        };
        match tokio::time::timeout(timeout, exchange).await {
            Ok(result) => result,
            Err(_) => Err(AppError::coded(
                StatusCode::GATEWAY_TIMEOUT,
                "PLUGIN_BACKEND_TIMEOUT",
                format!(
                    "the backend did not answer `{method}` within {} ms",
                    timeout.as_millis()
                ),
            )),
        }
    }
}

/// One request's entry in [`Pending`], removed when the call ends.
struct Waiting<'a> {
    pending: &'a Pending,
    id: &'a str,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        lock(self.pending).remove(self.id);
    }
}

fn exited_error(reason: &str) -> AppError {
    AppError::coded(
        StatusCode::BAD_GATEWAY,
        "PLUGIN_BACKEND_EXITED",
        format!("the tab's backend exited before answering: {reason}"),
    )
}

fn unavailable(message: String) -> AppError {
    AppError::coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "PLUGIN_BACKEND_UNAVAILABLE",
        message,
    )
}

/// Start `launch`'s backend; its tasks report into `history`.
pub(super) fn spawn(
    launch: &BackendLaunch,
    grants: &GrantStore,
    history: Arc<History>,
) -> Result<Arc<Running>, AppError> {
    let executable = launch.executable().map_err(unavailable)?;
    let mut command = managed_command(
        &executable,
        &launch.backend.args,
        &BTreeMap::new(),
        &launch.plugin_dir,
    )
    .map_err(|error| unavailable(format!("the backend cannot start: {error}")))?;
    command.stdin(Stdio::piped());
    let tree = ProcessTreeControl::prepare(&mut command, managed_process_tree_policy())
        .map_err(|error| unavailable(format!("the backend cannot be contained: {error}")))?;
    let mut child = command
        .spawn()
        .map_err(|error| unavailable(format!("the backend failed to start: {error}")))?;
    if let Err(error) = tree.attach(&child) {
        let _ = child.start_kill();
        return Err(unavailable(format!(
            "the backend cannot be contained: {error}"
        )));
    }
    let (Some(pid), Some(stdin), Some(stdout), Some(stderr)) = (
        child.id(),
        child.stdin.take(),
        child.stdout.take(),
        child.stderr.take(),
    ) else {
        let _ = child.start_kill();
        return Err(unavailable("the backend's stdio was unavailable".into()));
    };
    let minted = grants.mint(
        GrantRequest::builder()
            .plugin_id(launch.plugin_id.clone())
            .project_id(launch.project_id)
            .feature_id(launch.feature_id)
            .scopes(launch.scopes.clone())
            .permissions_hash(launch.permissions_hash.clone())
            .lifetime(Lifetime::UntilRevoked)
            .build(),
    );
    let run = history.record_start();
    let (stdin_tx, stdin_rx) = mpsc::channel(MAX_PENDING);
    let running = Arc::new(Running {
        pid,
        run,
        grant_key: minted.grant.key.clone(),
        permissions_hash: launch.permissions_hash.clone(),
        stop: CancellationToken::new(),
        stop_reason: OnceLock::new(),
        exited: CancellationToken::new(),
        stdin: stdin_tx,
        pending: Pending::default(),
        next_id: AtomicU64::new(1),
    });
    let hello = launch.hello(&minted.token).to_string();
    tokio::spawn(write_stdin(stdin, hello, stdin_rx, running.stop.clone()));
    tokio::spawn(read_stdout(
        stdout,
        running.pending.clone(),
        history.clone(),
    ));
    tokio::spawn(read_stderr(stderr, history.clone()));
    tokio::spawn(supervise(
        child,
        tree,
        running.clone(),
        minted.grant.revoked.clone(),
        grants.clone(),
        history,
    ));
    Ok(running)
}

enum Ending {
    Exited(std::io::Result<std::process::ExitStatus>),
    Stopped(&'static str),
}

/// Wait for the process to exit or be stopped, then clean up: terminate the
/// tree, fail pending requests, revoke the backend's grant, record the exit.
async fn supervise(
    mut child: Child,
    tree: ProcessTreeControl,
    running: Arc<Running>,
    revoked: CancellationToken,
    grants: GrantStore,
    history: Arc<History>,
) {
    let pid = running.pid;
    let ending = tokio::select! {
        status = child.wait() => Ending::Exited(status),
        () = running.stop.cancelled() => {
            Ending::Stopped(running.stop_reason.get().copied().unwrap_or("stopped by Cadencr"))
        }
        () = revoked.cancelled() => Ending::Stopped("its permissions changed or it was turned off"),
    };
    let exit = match ending {
        Ending::Exited(status) => exit_record(status),
        Ending::Stopped(reason) => {
            // Closes stdin, the backend's cue to exit (a revoked grant has
            // not cancelled `stop` yet).
            running.stop.cancel();
            let code = match tokio::time::timeout(EXIT_GRACE, child.wait()).await {
                Ok(Ok(status)) => status.code(),
                _ => tree
                    .terminate(&mut child, TERMINATE_GRACE)
                    .await
                    .ok()
                    .and_then(|status| status.code()),
            };
            ExitRecord {
                code,
                reason: reason.into(),
                crashed: false,
            }
        }
    };
    if let Err(error) = tree.cleanup_after_exit(Some(pid)).await {
        history.push_stderr(format!(
            "[cadencr] could not clean up its processes: {error}"
        ));
    }
    tracing::info!(
        pid,
        reason = exit.reason,
        crashed = exit.crashed,
        "custom tab backend exited"
    );
    let reason = exit.reason.clone();
    // Recorded before `exited` fires, so a status read as "not running"
    // already says why.
    history.record_exit(running.run, exit);
    // Ends `write_stdin` after a process that exited on its own.
    running.stop.cancel();
    running.exited.cancel();
    grants.revoke_key(&running.grant_key);
    for (_, waiter) in lock(&running.pending).drain() {
        let _ = waiter.send(Reply::Exited(reason.clone()));
    }
}

fn exit_record(status: std::io::Result<std::process::ExitStatus>) -> ExitRecord {
    match status {
        Ok(status) if status.success() => ExitRecord {
            code: Some(0),
            reason: "exited on its own".into(),
            crashed: false,
        },
        Ok(status) => ExitRecord {
            code: status.code(),
            reason: match status.code() {
                Some(code) => format!("exited with status {code}"),
                None => "was killed by a signal".into(),
            },
            crashed: true,
        },
        Err(error) => ExitRecord {
            code: None,
            reason: format!("could not be waited for: {error}"),
            crashed: true,
        },
    }
}
