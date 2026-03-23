use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::terminal::service::PtyManager;

/// A turn-state change for a single feature, broadcast to all connected clients.
#[derive(Clone, Debug, serde::Serialize)]
pub struct TurnStateEvent {
    pub feature_id: i64,
    /// "claude" | "askUser" | "none"
    pub turn: String,
}

#[derive(Clone)]
pub struct AppState {
    /// Read-only pool (max 4 connections, query_only pragma)
    pub read_pool: SqlitePool,
    /// Read-write pool (max 1 connection, serializes writes)
    pub write_pool: SqlitePool,
    /// Port of the Electron IPC HTTP server (for callbacks)
    pub electron_port: u16,
    /// Maximum number of parallel workflow agents. Defaults to 3.
    /// Overridden by CADENCE_MAX_PARALLEL env var.
    pub max_parallel_agents: usize,
    /// Agent timeout in minutes. Defaults to 30.
    /// Overridden by CADENCE_AGENT_TIMEOUT_MINUTES env var.
    pub agent_timeout_minutes: u64,
    /// Broadcast channel for turn-state changes (cross-feature, all WS clients).
    pub turn_state_tx: broadcast::Sender<TurnStateEvent>,
    /// PTY lifecycle manager for terminal sessions.
    pub pty_manager: PtyManager,
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
        Self {
            read_pool: pool.clone(),
            write_pool: pool,
            electron_port: 0,
            max_parallel_agents: 3,
            agent_timeout_minutes: 30,
            turn_state_tx,
            pty_manager: PtyManager::new(),
        }
    }
}
