//! Background storage maintenance.
//!
//! Cadencr's database grows without bound: every agent turn appends tool calls
//! and results verbatim, and nothing has ever removed any of it. On a real
//! installation that reached 5.5 GB, of which `agent_messages` was 3.6 GB and
//! its FTS index another 1.5 GB.
//!
//! This job runs the passes that keep that in check. Each pass is independent,
//! resumable, and best-effort — a failure costs disk space, never correctness,
//! so nothing here is allowed to fail startup or a turn.
//!
//! Passes are deliberately ordered cheapest-and-safest first:
//!
//! 1. [`tool_output_backfill`] — lossless. Drops `tool_call` output copies whose
//!    `tool_result` row holds the same bytes. Not gated on any user setting or
//!    retention window, because deleting a verified duplicate can't lose
//!    anything.
//! 2. [`image_backfill`] — lossless. Moves inline base64 images onto disk,
//!    leaving a reference. The bytes are still there, just not in SQLite.
//! 3. [`retention`] — the only lossy pass, and so the only one behind a user
//!    setting and a retention window. Trims oversized tool payloads on features
//!    archived long enough ago. It runs last so the lossless passes have
//!    already shrunk whatever they can, leaving it less to trim.
//!
//! Everything here runs on the write pool, so passes pause between batches
//! rather than holding SQLite's single writer for long stretches.

pub mod compaction;
pub mod database_compaction;
pub mod image_backfill;
pub mod retention;
pub mod state;
pub mod tool_output_backfill;

use sqlx::SqlitePool;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

/// User-visible lifecycle for the only lossy maintenance pass.
///
/// These events deliberately describe archived-feature compaction rather than
/// the lossless backfills that precede it. The desktop uses one stable toast id
/// to turn `Started` into either `Completed` or `Failed`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum StorageMaintenanceEvent {
    Started {
        features: u64,
        window_days: i64,
    },
    Completed {
        features: u64,
        rewritten_messages: u64,
    },
    Cancelled {
        completed_features: u64,
        remaining_features: u64,
        rewritten_messages: u64,
    },
    Failed {
        completed_features: u64,
        failed_features: u64,
        rewritten_messages: u64,
    },
}

/// Broadcast plus a reconnect snapshot for a sweep that is currently running.
#[derive(Clone)]
pub struct StorageMaintenanceBroadcaster {
    tx: broadcast::Sender<StorageMaintenanceEvent>,
    active: Arc<RwLock<Option<StorageMaintenanceEvent>>>,
}

impl StorageMaintenanceBroadcaster {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self {
            tx,
            active: Arc::new(RwLock::new(None)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StorageMaintenanceEvent> {
        self.tx.subscribe()
    }

    pub fn active(&self) -> Option<StorageMaintenanceEvent> {
        match self.active.read() {
            Ok(active) => active.clone(),
            Err(poisoned) => {
                tracing::warn!("storage maintenance state lock was poisoned; recovering");
                poisoned.into_inner().clone()
            }
        }
    }

    pub fn emit(&self, event: StorageMaintenanceEvent) {
        let active =
            matches!(event, StorageMaintenanceEvent::Started { .. }).then(|| event.clone());
        match self.active.write() {
            Ok(mut stored) => *stored = active,
            Err(poisoned) => {
                tracing::warn!("storage maintenance state lock was poisoned; recovering");
                *poisoned.into_inner() = active;
            }
        }
        // No connected desktop is a normal state during startup and shutdown.
        let _ = self.tx.send(event);
    }
}

/// Delay before the first sweep, so maintenance never competes with session
/// restore, worktree scanning, and the rest of a cold launch.
const STARTUP_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

/// Gap between sweeps. Long: the passes are cursor-based, so a sweep with
/// nothing to do is nearly free, and there is no urgency to reclaiming bytes.
const SWEEP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// Run every maintenance pass once.
pub async fn run_once(pool: &SqlitePool, events: &StorageMaintenanceBroadcaster) {
    let stripped = tool_output_backfill::run(pool).await;
    if stripped > 0 {
        tracing::info!(
            stripped,
            "storage maintenance: duplicated tool output removed"
        );
    }
    let offloaded = image_backfill::run(pool).await;
    if offloaded > 0 {
        tracing::info!(
            offloaded,
            "storage maintenance: inline images moved to disk"
        );
    }
    let compacted = retention::run(pool, events).await;
    if compacted > 0 {
        tracing::info!(
            compacted,
            "storage maintenance: archived features compacted"
        );
    }
    if stripped > 0 || offloaded > 0 || compacted > 0 {
        // `VACUUM` cannot run while the service is serving reads and writes.
        // Request one for the next startup, where only the write pool exists.
        state::set(pool, state::DATABASE_COMPACTION_REQUESTED, "1").await;
    }
}

/// Spawn the periodic maintenance loop. Detached: the caller doesn't wait on it
/// and it has no shutdown signal, because every pass is safe to abandon
/// mid-flight — the cursor simply stays where it was.
pub fn spawn(pool: SqlitePool, events: StorageMaintenanceBroadcaster) {
    tokio::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            run_once(&pool, &events).await;
            tokio::time::sleep(SWEEP_INTERVAL).await;
        }
    });
}
