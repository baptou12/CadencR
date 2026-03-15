use std::sync::Arc;
use sqlx::SqlitePool;

use crate::domain::ws_session::store::SessionStore;

#[derive(Clone)]
pub struct AppState {
    /// Read-only pool (max 4 connections, query_only pragma)
    pub read_pool: SqlitePool,
    /// Read-write pool (max 1 connection, serializes writes)
    pub write_pool: SqlitePool,
    /// Port of the Electron IPC HTTP server (for callbacks)
    pub electron_port: u16,
    /// In-memory store for ephemeral WebSocket sessions
    pub ws_session_store: Arc<dyn SessionStore>,
}
