use sqlx::SqlitePool;
use std::sync::Arc;

/// Shared context injected into all MCP tool handlers. The `feature_id` is
/// pinned at subprocess spawn time (1:1 subprocess ↔ feature, see
/// `mcp_spawn.rs`) so tools can access it via plain field reads without
/// depending on task-local propagation — `rmcp`'s internal request dispatch
/// sometimes runs handlers on freshly-spawned tokio tasks that don't inherit
/// a task-local scope, so the earlier scope-based approach was unreliable.
pub struct McpContext {
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub feature_id: i64,
}

impl McpContext {
    pub fn new(read_pool: SqlitePool, write_pool: SqlitePool, feature_id: i64) -> Arc<Self> {
        Arc::new(Self {
            read_pool,
            write_pool,
            feature_id,
        })
    }

    pub fn feature_id(&self) -> i64 {
        self.feature_id
    }
}
