use sqlx::SqlitePool;

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
}

impl AppState {
    /// Read max_parallel_agents from CADENCE_MAX_PARALLEL env var, defaulting to 3.
    pub fn max_parallel_from_env() -> usize {
        std::env::var("CADENCE_MAX_PARALLEL")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(3)
    }
}
