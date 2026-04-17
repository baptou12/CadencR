use sqlx::SqlitePool;
use std::sync::Arc;

tokio::task_local! {
    /// Per-call feature scope. Set by each server's dispatcher from the tool's
    /// `feature_id` arg and read via `McpContext::feature_id()`.
    pub static CURRENT_FEATURE_ID: i64;
}

/// Shared context injected into all MCP tool handlers.
pub struct McpContext {
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
}

impl McpContext {
    pub fn new(read_pool: SqlitePool, write_pool: SqlitePool) -> Arc<Self> {
        Arc::new(Self {
            read_pool,
            write_pool,
        })
    }

    /// Panics if called outside a `CURRENT_FEATURE_ID.scope(...)`.
    pub fn feature_id(&self) -> i64 {
        CURRENT_FEATURE_ID
            .try_with(|id| *id)
            .expect("tool invoked outside CURRENT_FEATURE_ID scope — dispatcher bug")
    }
}

#[cfg(test)]
mod tests {
    use super::CURRENT_FEATURE_ID;

    #[tokio::test]
    async fn concurrent_scopes_stay_isolated() {
        // Spin up two tasks with different feature_id scopes and confirm neither
        // leaks into the other. This is the property that makes it safe to
        // share one MCP subprocess across features under OpenCode.
        let a = tokio::spawn(CURRENT_FEATURE_ID.scope(1, async {
            tokio::task::yield_now().await;
            CURRENT_FEATURE_ID.with(|id| *id)
        }));
        let b = tokio::spawn(CURRENT_FEATURE_ID.scope(2, async {
            tokio::task::yield_now().await;
            CURRENT_FEATURE_ID.with(|id| *id)
        }));
        assert_eq!(a.await.unwrap(), 1);
        assert_eq!(b.await.unwrap(), 2);
    }

    #[tokio::test]
    async fn try_with_is_none_outside_scope() {
        assert!(CURRENT_FEATURE_ID.try_with(|id| *id).is_err());
    }
}
