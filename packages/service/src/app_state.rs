use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::custom_actions::scheduler::CustomActionScheduler;
use crate::domain::editor::watcher::{FileChangeEvent, SharedFileWatcher};
use crate::domain::git::push_sessions::PushSessionRegistry;
use crate::domain::git::watcher::GitWatcherRegistry;
use crate::domain::session_status::SessionStatusBroadcaster;
use crate::domain::terminal::service::PtyManager;
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;

#[derive(Clone)]
pub struct AppState {
    /// Read-only pool (max 4 connections, query_only pragma)
    pub read_pool: SqlitePool,
    /// Read-write pool (max 1 connection, serializes writes)
    pub write_pool: SqlitePool,
    /// Maximum number of parallel workflow agents. Defaults to 3.
    /// Overridden by CADENCR_MAX_PARALLEL env var.
    pub max_parallel_agents: usize,
    /// Agent timeout in minutes. Defaults to 30.
    /// Overridden by CADENCR_AGENT_TIMEOUT_MINUTES env var.
    pub agent_timeout_minutes: u64,
    /// Single source of truth for live agent status changes (per-session,
    /// 3-value enum). Every status mutation goes through this broadcaster;
    /// it stamps a monotonic `seq` on every event so the frontend can
    /// reject out-of-order updates and stale snapshots. See
    /// `domain::session_status` for the wire format and rules.
    pub session_status_tx: SessionStatusBroadcaster,
    /// PTY lifecycle manager for terminal sessions.
    pub pty_manager: PtyManager,
    /// Broadcast channel for file-system change events.
    pub file_change_tx: broadcast::Sender<FileChangeEvent>,
    /// Shared file watcher (one project at a time).
    pub file_watcher: SharedFileWatcher,
    /// Per-launch bearer token required on every HTTP request (via the
    /// `X-Cadencr-Token` header) and WebSocket upgrade (via the
    /// `cadencr-token.<tok>` `Sec-WebSocket-Protocol` entry).
    pub auth_token: String,
    /// Frontend dev server port used for WebSocket origin allowlisting.
    pub frontend_port: u16,
    /// Listener port, pinned against the `Host` header for DNS-rebinding defense.
    pub port: u16,
    /// Scheduler for periodic custom-action runs. Holds one tokio task per
    /// enabled `custom_action_schedules` row.
    pub custom_action_scheduler: CustomActionScheduler,
    /// Per-worktree filesystem watchers driving real-time `git.status`
    /// envelopes. Refcounted by WS subscriptions; see `domain::git::watcher`.
    pub git_watcher: Arc<GitWatcherRegistry>,
    /// Active `git push` sessions keyed by feature_id. Lets the
    /// `POST /api/git/push-input` handler route user-typed bytes
    /// (passphrase, `yes`/`no`) into the push's PTY stdin while it's
    /// running. See `domain::git::push_sessions`.
    pub push_sessions: Arc<PushSessionRegistry>,
    /// Maps feature_id → active WS senders. Lets HTTP handlers push WS
    /// envelopes (e.g. auto-naming events) without holding a socket ref.
    pub ws_feature_senders: WsFeatureSenderRegistry,
}

impl AppState {
    /// Read max_parallel_agents from CADENCR_MAX_PARALLEL env var, defaulting to 3.
    pub fn max_parallel_from_env() -> usize {
        std::env::var("CADENCR_MAX_PARALLEL")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(3)
    }

    /// Read agent_timeout_minutes from CADENCR_AGENT_TIMEOUT_MINUTES env var, defaulting to 30.
    pub fn agent_timeout_minutes_from_env() -> u64 {
        std::env::var("CADENCR_AGENT_TIMEOUT_MINUTES")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30)
    }

    /// Create an AppState for tests with a shared pool and default config.
    /// Intentionally not behind `#[cfg(test)]` so integration tests under
    /// `tests/` (which compile the crate as a library, *without* `cfg(test)`)
    /// can build it too. Production code never calls this — the
    /// `#[allow(dead_code)]` keeps the bin target's `-D dead-code` lint happy.
    #[allow(dead_code)]
    pub fn with_pool(pool: SqlitePool) -> Self {
        let (session_status_tx, _) = broadcast::channel(64);
        let (file_change_tx, _) = broadcast::channel(16);
        Self {
            read_pool: pool.clone(),
            write_pool: pool,
            max_parallel_agents: 3,
            agent_timeout_minutes: 30,
            session_status_tx: SessionStatusBroadcaster::new(
                session_status_tx,
                std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
            ),
            pty_manager: PtyManager::new(),
            file_change_tx,
            file_watcher: crate::domain::editor::watcher::new_shared(),
            auth_token: "test-token".to_string(),
            frontend_port: 1420,
            port: 0,
            custom_action_scheduler: CustomActionScheduler::new(),
            git_watcher: Arc::new(GitWatcherRegistry::new()),
            push_sessions: Arc::new(PushSessionRegistry::new()),
            ws_feature_senders: WsFeatureSenderRegistry::new(),
        }
    }
}
