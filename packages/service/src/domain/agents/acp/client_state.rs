use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::io::AsyncWrite;
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;

use crate::domain::agents::acp::client_io::PendingMap;
use crate::domain::agents::acp::types::{AcpClientInfo, AcpEvent};

/// Shared state behind `AcpClient`. Held in `Arc` so the client can be cloned
/// freely (each clone shares pending requests, broadcast subscribers, and the
/// kill switch).
///
/// The stdin half is generic over `AsyncWrite + Send + Unpin` so that tests
/// can drive the client over a `tokio::io::duplex` pair without spawning a
/// real subprocess.
pub(crate) struct Inner {
    pub(crate) stdin: Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    pub(crate) next_id: AtomicU64,
    pub(crate) pid: Option<u32>,
    pub(crate) pending: Arc<StdMutex<PendingMap>>,
    pub(crate) events: broadcast::Sender<AcpEvent>,
    pub(crate) reader_task: StdMutex<Option<JoinHandle<()>>>,
    pub(crate) stderr_task: StdMutex<Option<JoinHandle<()>>>,
    pub(crate) reaper_task: StdMutex<Option<JoinHandle<()>>>,
    pub(crate) kill_tx: StdMutex<Option<oneshot::Sender<()>>>,
    pub(crate) exit_sent: Arc<AtomicBool>,
    pub(crate) client_info: AcpClientInfo,
    #[allow(dead_code)]
    pub(crate) request_timeout: Duration,
}

/// RAII guard that auto-removes a pending-request entry on drop.
///
/// Without this, a request that times out (the `tokio::time::timeout` future
/// returns `Err`) would leak its oneshot sender in `pending`, potentially
/// holding it forever if the agent eventually replies. Drop runs on every
/// exit path — timeout, cancellation, success — so the map stays bounded.
pub(crate) struct PendingRequestGuard {
    pub(crate) pending: Arc<StdMutex<PendingMap>>,
    pub(crate) id: u64,
}

impl Drop for PendingRequestGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&self.id);
        }
    }
}

impl Drop for Inner {
    /// Best-effort kill on last-clone drop. The reaper task will observe the
    /// kill signal and let the child exit; if it's already gone this is a
    /// no-op. We never block in `Drop`.
    fn drop(&mut self) {
        if let Ok(mut kill_tx) = self.kill_tx.lock() {
            if let Some(tx) = kill_tx.take() {
                let _ = tx.send(());
            }
        }
    }
}
