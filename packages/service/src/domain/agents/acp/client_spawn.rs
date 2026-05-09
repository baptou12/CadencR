//! Subprocess spawn + in-memory test ctor for `AcpClient`.
//!
//! Split out of `client.rs` to keep that file under the 400-line limit
//! while letting the public API surface (`request`, `notify`, `subscribe`,
//! `respond_server_request`, `shutdown`) stay readable in one place.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::process::Command;
use tokio::sync::{broadcast, oneshot, Mutex};

use crate::domain::agents::acp::client::{AcpClient, AcpSpawnOptions};
use crate::domain::agents::acp::client_io::{
    spawn_reader, spawn_reaper, spawn_stderr_reader, ReaderState,
};
use crate::domain::agents::acp::client_state::Inner;
use crate::domain::agents::acp::error::AcpError;

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Spawn the subprocess and start the reader / stderr / reaper tasks.
///
/// The caller's `Command` is augmented with piped stdio and
/// `kill_on_drop(true)` here so adapters don't have to remember.
pub(super) async fn spawn_acp_subprocess(
    mut options: AcpSpawnOptions,
) -> Result<AcpClient, AcpError> {
    options
        .command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    drop(options.spawn_guard.take());

    let mut child = options
        .command
        .spawn()
        .map_err(|error| AcpError::Spawn(error.to_string()))?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AcpError::Protocol("missing ACP stdin".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AcpError::Protocol("missing ACP stdout".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AcpError::Protocol("missing ACP stderr".to_string()))?;

    Ok(assemble(
        Box::new(stdin),
        stdout,
        stderr,
        Some(child),
        pid,
        options,
    ))
}

/// Test-only: build a client around in-memory streams instead of a real
/// subprocess. Drives `assemble` with no `Child`, so the kill switch and
/// reaper task are skipped entirely.
#[allow(dead_code)] // Reachable only from `#[cfg(test)]` callers in adapter
                    // modules; the bin target's dead-code analysis can't see
                    // them.
pub(super) fn spawn_acp_with_streams<R, E>(
    stdin: Box<dyn AsyncWrite + Send + Unpin>,
    stdout: R,
    stderr: E,
    client_info: crate::domain::agents::acp::types::AcpClientInfo,
) -> AcpClient
where
    R: AsyncRead + Send + Unpin + 'static,
    E: AsyncRead + Send + Unpin + 'static,
{
    let options = AcpSpawnOptions {
        command: Command::new("/bin/false"), // never used
        client_info,
        request_timeout: None,
        max_line_bytes: None,
        spawn_guard: None,
    };
    assemble(stdin, stdout, stderr, None, None, options)
}

fn assemble<R, E>(
    stdin: Box<dyn AsyncWrite + Send + Unpin>,
    stdout: R,
    stderr: E,
    child: Option<tokio::process::Child>,
    pid: Option<u32>,
    options: AcpSpawnOptions,
) -> AcpClient
where
    R: AsyncRead + Send + Unpin + 'static,
    E: AsyncRead + Send + Unpin + 'static,
{
    let (events, _) = broadcast::channel(4096);
    let pending = Arc::new(StdMutex::new(HashMap::new()));
    let exit_sent = Arc::new(AtomicBool::new(false));
    let max_line_bytes = options.max_line_bytes.unwrap_or(DEFAULT_MAX_LINE_BYTES);
    let (kill_tx, kill_rx) = oneshot::channel();

    let inner = Arc::new(Inner {
        stdin: Mutex::new(stdin),
        next_id: AtomicU64::new(1),
        pid,
        pending: Arc::clone(&pending),
        events: events.clone(),
        reader_task: StdMutex::new(None),
        stderr_task: StdMutex::new(None),
        reaper_task: StdMutex::new(None),
        kill_tx: StdMutex::new(Some(kill_tx)),
        exit_sent: Arc::clone(&exit_sent),
        client_info: options.client_info,
        request_timeout: options.request_timeout.unwrap_or(DEFAULT_REQUEST_TIMEOUT),
    });

    let reader_task = spawn_reader(
        ReaderState {
            pending: Arc::clone(&inner.pending),
            events: inner.events.clone(),
            exit_sent: Arc::clone(&inner.exit_sent),
            max_line_bytes,
        },
        stdout,
    );
    if let Ok(mut slot) = inner.reader_task.lock() {
        slot.replace(reader_task);
    }
    if let Ok(mut slot) = inner.stderr_task.lock() {
        slot.replace(spawn_stderr_reader(stderr, max_line_bytes));
    }
    if let Some(child) = child {
        if let Ok(mut slot) = inner.reaper_task.lock() {
            slot.replace(spawn_reaper(
                child,
                kill_rx,
                pending,
                events,
                Arc::clone(&inner.exit_sent),
            ));
        }
    } else {
        // No real child to reap — drop the kill_rx so it never fires.
        drop(kill_rx);
    }

    AcpClient::from_inner(inner)
}
