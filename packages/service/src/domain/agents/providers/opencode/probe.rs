//! Short-lived `opencode serve` subprocess probe for `/config/providers`.
//!
//! Why `serve` and not `acp`? Both subcommands bind the same HTTP
//! backend, but `acp` expects a JSON-RPC ACP client to drive its stdin
//! — if stdin EOFs (which it does whenever we don't wire a full ACP
//! handshake), opencode tears the subprocess down before the listener
//! is reachable. `serve` is the headless variant: no stdin handshake,
//! the HTTP backend stays up until we kill the subprocess.

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_sdk_rs::{ConfigProvidersResponse, OpenCodeClient, SdkError};
use tokio::process::Command;

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

const PROBE_LOG_PREFIX: &str = "opencode /config/providers probe";

/// Run the probe, returning opencode's resolved provider/model list.
///
/// Errors bubble up so the cache layer can log + fall back. Caller must
/// not retry hot — the cache is responsible for TTL-bounding respawns.
pub(super) async fn run() -> Result<ConfigProvidersResponse, RuntimeError> {
    let port = reserve_local_port()?.into_port();
    let binary = opencode_sdk_rs::process::resolve_binary().await?;
    // `kill_on_drop(true)` on the `Command` reaps the subprocess for
    // every early-return / cancellation / panic path. We only need an
    // explicit `wait()` on the happy path so the child is fully
    // collected before we return.
    let mut child = Command::new(&binary)
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        // `serve` doesn't read stdin, but an inherited TTY/EOF would
        // shut the subprocess down. Pin to /dev/null so our `kill()`
        // is the only thing that ends the process.
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| RuntimeError::new(format!("{PROBE_LOG_PREFIX}: spawn failed: {error}")))?;

    let client = OpenCodeClient::new(port);
    // Stash the most recent SDK error so the timeout path can include
    // *why* we kept retrying. `Arc<Mutex<…>>` is load-bearing here:
    // when the outer `tokio::time::timeout` fires, the polling future
    // is dropped, so any state local to that future is lost. The Arc
    // gives the timeout's `map_err` a reader after the future is gone.
    let last_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let outcome = tokio::time::timeout(
        PROBE_TIMEOUT,
        poll_until_ready(&client, Arc::clone(&last_error)),
    )
    .await;

    let _ = child.kill().await;
    let _ = child.wait().await;

    match outcome {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(error)) => Err(RuntimeError::new(format!("{PROBE_LOG_PREFIX}: {error}"))),
        Err(_) => {
            let detail = last_error
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
                .unwrap_or_else(|| "no readiness response observed".to_string());
            Err(RuntimeError::new(format!(
                "{PROBE_LOG_PREFIX}: timed out after {PROBE_TIMEOUT:?} (last error: {detail})"
            )))
        }
    }
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
                if !is_retryable_readiness_error(&error) {
                    return Err(error);
                }
                if let Ok(mut guard) = last_error.lock() {
                    *guard = Some(error.to_string());
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
            http_error.is_connect() || http_error.is_request() || http_error.is_timeout()
        }
        SdkError::Io(_) => true,
        _ => false,
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
