//! Short-lived `opencode serve` subprocess probe for `/config/providers`.
//!
//! Lifecycle: reserve a free local port → spawn `opencode serve
//! --hostname 127.0.0.1 --port <port>` → poll `GET /config/providers`
//! until it succeeds or the probe timeout fires → kill the subprocess.
//!
//! Why `serve` and not `acp`? Both subcommands bind the same HTTP
//! backend, but `acp` expects a JSON-RPC ACP client to drive its stdin
//! — if stdin EOFs (which it does whenever we don't wire a full ACP
//! handshake), opencode tears the subprocess down before the listener
//! is reachable. `serve` is the headless variant: no stdin handshake,
//! the HTTP backend stays up until we kill the subprocess.
//!
//! The TTL cache in `cache.rs` is what keeps us from doing this on
//! every catalog request — see that file's docstring.

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_sdk_rs::{ConfigProvidersResponse, OpenCodeClient, SdkError};
use tokio::process::{Child, Command};

use crate::domain::agents::adapter::RuntimeError;
use crate::domain::agents::opencode::acp::port::reserve_local_port;

/// `opencode serve` typically binds in well under a second once the
/// binary has been warm-loaded, but a cold first run after install
/// (models.dev fetch, config validation) can take noticeably longer.
/// The cache TTL keeps respawns infrequent, so we err generous here
/// rather than fall back to the static `default/default` entry just
/// because the user's first probe hit a cold start.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const READINESS_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Run the probe, returning opencode's resolved provider/model list.
///
/// Errors bubble up so the cache layer can log + fall back. Caller must
/// not retry hot — the cache is responsible for TTL-bounding respawns.
pub(super) async fn run() -> Result<ConfigProvidersResponse, RuntimeError> {
    let port = reserve_local_port()?.into_port();
    let binary = opencode_sdk_rs::process::resolve_binary().await?;
    let child = Command::new(&binary)
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        // `serve` doesn't read stdin, but inheriting our stdin (or
        // leaving it as a TTY pipe) would let an EOF leak in and shut
        // the subprocess down. Pin it to /dev/null so the lifecycle is
        // entirely controlled by us via `kill()` below.
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            RuntimeError::new(format!("failed to spawn opencode serve probe: {error}"))
        })?;

    // `ChildGuard::Drop` runs the kill+wait in a detached background task.
    // That covers panic / early-return paths; the happy path explicitly
    // awaits cleanup via `shutdown()` so the subprocess is reaped before
    // we return.
    let mut guard = ChildGuard::new(child);

    let client = OpenCodeClient::new(port);
    // Stash the most recent SDK error so the timeout path can include
    // *why* we kept retrying (connection refused vs. 404 vs. JSON
    // decode failure all look identical from the outside otherwise).
    let last_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let response = tokio::time::timeout(
        PROBE_TIMEOUT,
        poll_until_ready(&client, Arc::clone(&last_error)),
    )
    .await
    .map_err(|_| {
        let detail = last_error
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .unwrap_or_else(|| "no readiness response observed".to_string());
        RuntimeError::new(format!(
            "opencode /config/providers probe timed out after {:?} (last error: {detail})",
            PROBE_TIMEOUT
        ))
    })?
    .map_err(|error| {
        RuntimeError::new(format!("opencode /config/providers probe failed: {error}"))
    })?;

    guard.shutdown().await;
    Ok(response)
}

/// Drives the readiness loop. Connection-refused / IO errors are
/// treated as "subprocess not listening yet"; persistent failures
/// (HTTP 4xx/5xx, JSON decode) short-circuit immediately so we don't
/// chew the full timeout on a permanent error.
async fn poll_until_ready(
    client: &OpenCodeClient,
    last_error: Arc<Mutex<Option<String>>>,
) -> Result<ConfigProvidersResponse, SdkError> {
    loop {
        match client.list_config_providers().await {
            Ok(response) => return Ok(response),
            Err(error) => {
                let retry = is_retryable_readiness_error(&error);
                if let Ok(mut guard) = last_error.lock() {
                    *guard = Some(error.to_string());
                }
                if !retry {
                    return Err(error);
                }
                tokio::time::sleep(READINESS_POLL_INTERVAL).await;
            }
        }
    }
}

/// Errors that mean "subprocess hasn't bound the port yet" — keep
/// retrying. Everything else (HTTP 4xx/5xx, JSON decode, etc.) is a
/// permanent failure: opencode is up but answering wrong, so we'd just
/// be spinning until the outer timeout.
fn is_retryable_readiness_error(error: &SdkError) -> bool {
    match error {
        SdkError::Http(http_error) => {
            // `reqwest::Error::is_connect()` covers ECONNREFUSED while
            // the subprocess is still starting; we also tolerate raw
            // request-builder / IO errors that surface here on macOS
            // before the listener appears.
            http_error.is_connect() || http_error.is_request() || http_error.is_timeout()
        }
        SdkError::Io(_) => true,
        _ => false,
    }
}

/// Scope guard for the `opencode acp` child. Ensures the subprocess is
/// killed even on panic or early return.
///
/// Two cleanup paths:
/// * `shutdown()` — happy path. Awaits kill + wait so the OS reaps the
///   process before we return; the cache won't observe a zombie.
/// * `Drop` — panic / early-error path. We can't `.await` in `Drop`, so
///   we fire-and-forget a kill via `start_kill()` and let
///   `kill_on_drop(true)` from the spawn config handle the rest.
struct ChildGuard {
    child: Option<Child>,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    async fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            // Best-effort SIGKILL from a sync context; `kill_on_drop`
            // from the original spawn also reaps the process.
            let _ = child.start_kill();
        }
    }
}

#[cfg(test)]
mod tests {
    //! End-to-end probe against the real `opencode` binary. Ignored by
    //! default — requires `opencode` on PATH (or the SDK binary
    //! override pointed at a working install). Run manually with
    //! `cargo test -p cadencr-service probe_end_to_end -- --ignored`.

    use super::run;

    #[tokio::test]
    #[ignore]
    async fn probe_end_to_end_requires_opencode_binary() {
        let response = run().await.expect("probe ok");
        assert!(
            !response.providers.is_empty(),
            "expected at least one provider from a real opencode install"
        );
    }
}
