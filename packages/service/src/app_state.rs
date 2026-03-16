use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    /// Read-only pool (max 4 connections, query_only pragma)
    pub read_pool: SqlitePool,
    /// Read-write pool (max 1 connection, serializes writes)
    pub write_pool: SqlitePool,
    /// Port of the Electron IPC HTTP server (for callbacks)
    pub electron_port: u16,
}
