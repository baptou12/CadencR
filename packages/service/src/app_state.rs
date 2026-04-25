use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::custom_actions::scheduler::CustomActionScheduler;
use crate::domain::editor::watcher::{FileChangeEvent, SharedFileWatcher};
use crate::domain::terminal::service::PtyManager;

/// A turn-state change for a single feature, broadcast to all connected clients.
///
/// `seq` is a monotonic global counter: when the frontend receives two events
/// for the same feature, it ignores the one with the lower `seq`. The counter
/// is also stamped on `turn_states.snapshot` payloads so a lag-recovery
/// snapshot can't overwrite a more recent live update.
#[derive(Clone, Debug, serde::Serialize)]
pub struct TurnStateEvent {
    pub feature_id: i64,
    /// "agent" | "askUser" | "none"
    pub turn: String,
    /// When `turn == "askUser"`, which input gate: "permission" | "question" |
    /// "plan-approval" | "prd-approval". `None` for `agent`/`none` turns, and
    /// for legacy call sites that don't carry the information.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub seq: u64,
}

/// Bundles the broadcast sender with the monotonic seq counter so every
/// producer stamps `TurnStateEvent.seq` without forgetting. Cloning is cheap
/// (`broadcast::Sender` and `Arc<AtomicU64>` both wrap shared state).
#[derive(Clone, Debug)]
pub struct TurnStateBroadcaster {
    pub tx: broadcast::Sender<TurnStateEvent>,
    pub seq: Arc<AtomicU64>,
}

impl TurnStateBroadcaster {
    pub fn new(tx: broadcast::Sender<TurnStateEvent>, seq: Arc<AtomicU64>) -> Self {
        Self { tx, seq }
    }

    /// Bump the counter and send the event. Returns the new seq so callers
    /// can stamp a matching value on snapshot payloads.
    pub fn send(&self, feature_id: i64, turn: &str) -> u64 {
        self.send_with_kind(feature_id, turn, None)
    }

    /// Same as `send`, but also propagates a pending-input kind tag so
    /// askUser listeners can distinguish permission / question / plan /
    /// prd gates without waiting for the next DB snapshot.
    pub fn send_with_kind(&self, feature_id: i64, turn: &str, kind: Option<&str>) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.tx.send(TurnStateEvent {
            feature_id,
            turn: turn.to_string(),
            kind: kind.map(str::to_string),
            seq,
        });
        seq
    }

    /// Current value of the counter (for stamping snapshot payloads without
    /// advancing it).
    pub fn current_seq(&self) -> u64 {
        self.seq.load(Ordering::Relaxed)
    }
}

#[derive(Clone)]
pub struct AppState {
    /// Read-only pool (max 4 connections, query_only pragma)
    pub read_pool: SqlitePool,
    /// Read-write pool (max 1 connection, serializes writes)
    pub write_pool: SqlitePool,
    /// Maximum number of parallel workflow agents. Defaults to 3.
    /// Overridden by CADENCE_MAX_PARALLEL env var.
    pub max_parallel_agents: usize,
    /// Agent timeout in minutes. Defaults to 30.
    /// Overridden by CADENCE_AGENT_TIMEOUT_MINUTES env var.
    pub agent_timeout_minutes: u64,
    /// Broadcast channel + monotonic seq counter for turn-state changes
    /// (cross-feature, all WS clients). Always mutate turn state via this —
    /// it stamps a monotonic `seq` on every event so the frontend can reject
    /// out-of-order updates and stale snapshots.
    pub turn_state_tx: TurnStateBroadcaster,
    /// PTY lifecycle manager for terminal sessions.
    pub pty_manager: PtyManager,
    /// Broadcast channel for file-system change events.
    pub file_change_tx: broadcast::Sender<FileChangeEvent>,
    /// Shared file watcher (one project at a time).
    pub file_watcher: SharedFileWatcher,
    /// Per-launch bearer token required on every HTTP request (via the
    /// `X-Cadence-Token` header) and WebSocket upgrade (via the
    /// `cadence-token.<tok>` `Sec-WebSocket-Protocol` entry).
    pub auth_token: String,
    /// Frontend dev server port used for WebSocket origin allowlisting.
    pub frontend_port: u16,
    /// Listener port, pinned against the `Host` header for DNS-rebinding defense.
    pub port: u16,
    /// Scheduler for periodic custom-action runs. Holds one tokio task per
    /// enabled `custom_action_schedules` row.
    pub custom_action_scheduler: CustomActionScheduler,
}

impl AppState {
    /// Read max_parallel_agents from CADENCE_MAX_PARALLEL env var, defaulting to 3.
    pub fn max_parallel_from_env() -> usize {
        std::env::var("CADENCE_MAX_PARALLEL")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(3)
    }

    /// Read agent_timeout_minutes from CADENCE_AGENT_TIMEOUT_MINUTES env var, defaulting to 30.
    pub fn agent_timeout_minutes_from_env() -> u64 {
        std::env::var("CADENCE_AGENT_TIMEOUT_MINUTES")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30)
    }

    /// Create an AppState for tests with a shared pool and default config.
    #[cfg(test)]
    pub fn with_pool(pool: SqlitePool) -> Self {
        let (turn_state_tx, _) = broadcast::channel(64);
        let (file_change_tx, _) = broadcast::channel(16);
        Self {
            read_pool: pool.clone(),
            write_pool: pool,
            max_parallel_agents: 3,
            agent_timeout_minutes: 30,
            turn_state_tx: TurnStateBroadcaster::new(turn_state_tx, Arc::new(AtomicU64::new(0))),
            pty_manager: PtyManager::new(),
            file_change_tx,
            file_watcher: crate::domain::editor::watcher::new_shared(),
            auth_token: "test-token".to_string(),
            frontend_port: 1420,
            port: 0,
            custom_action_scheduler: CustomActionScheduler::new(),
        }
    }
}
