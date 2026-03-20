use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Shared context injected into all MCP tool handlers
pub struct McpContext {
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub feature_id: i64,
    /// Channel to signal agent completion
    pub done_sender: tokio::sync::Mutex<Option<oneshot::Sender<Option<String>>>>,
}

impl McpContext {
    pub fn new(
        read_pool: SqlitePool,
        write_pool: SqlitePool,
        feature_id: i64,
        done_sender: oneshot::Sender<Option<String>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            read_pool,
            write_pool,
            feature_id,
            done_sender: tokio::sync::Mutex::new(Some(done_sender)),
        })
    }
}
