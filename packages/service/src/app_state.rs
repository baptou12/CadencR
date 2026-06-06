use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::custom_actions::run_registry::CustomActionRunRegistry;
use crate::domain::custom_actions::scheduler::CustomActionScheduler;
use crate::domain::editor::watcher::{FileChangeEvent, SharedFileWatcher};
use crate::domain::feature_events::FeatureEventBroadcaster;
use crate::domain::features::run_registry::FeatureRunRegistry;
use crate::domain::git::push_sessions::PushSessionRegistry;
use crate::domain::git::watcher::GitWatcherRegistry;
use crate::domain::imports::jobs::ImportJobRegistry;
use crate::domain::lsp::lifecycle::CrashTracker;
use crate::domain::lsp::LspRegistry;
use crate::domain::session_status::SessionStatusBroadcaster;
use crate::domain::terminal::service::PtyManager;
use crate::domain::ws_session::handler::ActiveTurnRegistry;
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;
use crate::remote::{RemoteConfig, RemoteController};

#[derive(Clone)]
pub struct AppState {
    /// Read-only pool (max 4 connections, query_only pragma)
    pub read_pool: SqlitePool,
    /// Read-write pool (max 1 connection, serializes writes)
    pub write_pool: SqlitePool,
    /// Maximum number of parallel agents. Defaults to 3.
    /// Overridden by CADENCR_MAX_PARALLEL env var.
    #[allow(dead_code)]
    pub max_parallel_agents: usize,
    /// Agent timeout in minutes. Defaults to 30.
    /// Overridden by CADENCR_AGENT_TIMEOUT_MINUTES env var.
    #[allow(dead_code)]
    pub agent_timeout_minutes: u64,
    /// Single source of truth for live agent status changes (per-session,
    /// 3-value enum). Every status mutation goes through this broadcaster;
    /// it stamps a monotonic `seq` on every event so the frontend can
    /// reject out-of-order updates and stale snapshots. See
    /// `domain::session_status` for the wire format and rules.
    pub session_status_tx: SessionStatusBroadcaster,
    /// Global feature-lifecycle broadcast (create/delete/archive). Every
    /// connected client subscribes once so a conversation created on one
    /// device shows up on the others without a manual refresh.
    pub feature_events_tx: FeatureEventBroadcaster,
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
    /// In-flight custom-action runs keyed by `run_id`, so a `cancel` request can
    /// interrupt a running command (Ctrl-C) even after the triggering UI closes.
    pub custom_action_runs: Arc<CustomActionRunRegistry>,
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
    /// Maps `agent_sessions.id` → the connection driving its live turn. Lets a
    /// remote client answer a permission/question/plan against the host's live
    /// query, and carries the server-stamped turn start for synced timers.
    pub active_turns: Arc<ActiveTurnRegistry>,
    /// Active explicit auto-rename requests keyed by feature_id. Prevents
    /// duplicate model runs racing to update the same title.
    pub auto_name_runs: Arc<FeatureRunRegistry>,
    /// Pending LSP session reservations. The renderer POSTs
    /// `/api/lsp/sessions` to reserve, then upgrades
    /// `/api/lsp/sessions/{id}/connect`; this map is the bridge between the
    /// two requests. See `domain::lsp`.
    pub lsp_sessions: Arc<LspRegistry>,
    /// Per-`(workspace, language)` crash backoff. Stops a misconfigured
    /// language server from being relaunched on every WS reconnect. See
    /// `domain::lsp::lifecycle`.
    pub lsp_crashes: Arc<CrashTracker>,
    /// In-flight import-conversation jobs (`POST /api/imports/...`).
    /// Polled by the frontend via `GET /api/imports/jobs/{id}`. Not
    /// persisted: a service restart drops jobs, which is fine because
    /// already-imported sessions are skipped on re-run.
    pub import_jobs: ImportJobRegistry,
    /// Lifecycle owner for the optional remote-access TLS listener. Shared
    /// (`Arc`) and interior-mutable; the loopback server is unaffected.
    pub remote: Arc<RemoteController>,
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

    /// Production constructor used by `main`. Creates the broadcast channels and
    /// every shared registry. Kept next to the struct (mirroring `with_pool`) so
    /// the entrypoint stays lean.
    pub fn for_server(
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        auth_token: String,
        frontend_port: u16,
        port: u16,
        remote: Arc<RemoteController>,
    ) -> Self {
        let (session_status_tx, _) = broadcast::channel(64);
        let (feature_events_tx, _) = broadcast::channel(64);
        let (file_change_tx, _) = broadcast::channel(16);
        Self {
            read_pool,
            write_pool,
            max_parallel_agents: Self::max_parallel_from_env(),
            agent_timeout_minutes: Self::agent_timeout_minutes_from_env(),
            session_status_tx: SessionStatusBroadcaster::new(
                session_status_tx,
                Arc::new(std::sync::atomic::AtomicU64::new(0)),
            ),
            feature_events_tx: FeatureEventBroadcaster::new(feature_events_tx),
            pty_manager: PtyManager::new(),
            file_change_tx,
            file_watcher: crate::domain::editor::watcher::new_shared(),
            auth_token,
            frontend_port,
            port,
            custom_action_scheduler: CustomActionScheduler::new(),
            custom_action_runs: Arc::new(CustomActionRunRegistry::new()),
            git_watcher: Arc::new(GitWatcherRegistry::new()),
            push_sessions: Arc::new(PushSessionRegistry::new()),
            ws_feature_senders: WsFeatureSenderRegistry::new(),
            active_turns: Arc::new(ActiveTurnRegistry::new()),
            auto_name_runs: Arc::new(FeatureRunRegistry::new()),
            lsp_sessions: LspRegistry::new(),
            lsp_crashes: CrashTracker::new(),
            import_jobs: ImportJobRegistry::new(),
            remote,
        }
    }

    /// Create an AppState for tests with a shared pool and default config.
    /// Intentionally not behind `#[cfg(test)]` so integration tests under
    /// `tests/` (which compile the crate as a library, *without* `cfg(test)`)
    /// can build it too. Production code never calls this — the
    /// `#[allow(dead_code)]` keeps the bin target's `-D dead-code` lint happy.
    #[allow(dead_code)]
    pub fn with_pool(pool: SqlitePool) -> Self {
        let (session_status_tx, _) = broadcast::channel(64);
        let (feature_events_tx, _) = broadcast::channel(64);
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
            feature_events_tx: FeatureEventBroadcaster::new(feature_events_tx),
            pty_manager: PtyManager::new(),
            file_change_tx,
            file_watcher: crate::domain::editor::watcher::new_shared(),
            auth_token: "test-token".to_string(),
            frontend_port: 1420,
            port: 0,
            custom_action_scheduler: CustomActionScheduler::new(),
            custom_action_runs: Arc::new(CustomActionRunRegistry::new()),
            git_watcher: Arc::new(GitWatcherRegistry::new()),
            push_sessions: Arc::new(PushSessionRegistry::new()),
            ws_feature_senders: WsFeatureSenderRegistry::new(),
            active_turns: Arc::new(ActiveTurnRegistry::new()),
            auto_name_runs: Arc::new(FeatureRunRegistry::new()),
            lsp_sessions: LspRegistry::new(),
            lsp_crashes: CrashTracker::new(),
            import_jobs: ImportJobRegistry::new(),
            remote: Arc::new(RemoteController::new(RemoteConfig {
                renderer_dir: None,
                remote_port: 0,
                data_dir: std::env::temp_dir().join("cadencr-remote-test"),
            })),
        }
    }
}
