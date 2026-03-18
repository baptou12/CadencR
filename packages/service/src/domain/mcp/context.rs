use dashmap::DashMap;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Result of a blocking approval operation (show_plan, show_prd)
#[derive(Debug, Clone)]
pub struct ApprovalResult {
    pub approved: bool,
    pub feedback: Option<String>,
}

/// Shared context injected into all MCP tool handlers
pub struct McpContext {
    pub read_pool: SqlitePool,
    pub write_pool: SqlitePool,
    pub feature_id: i64,
    /// Pending approval gates keyed by a unique request ID
    pub pending_approvals: DashMap<String, oneshot::Sender<ApprovalResult>>,
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
            pending_approvals: DashMap::new(),
            done_sender: tokio::sync::Mutex::new(Some(done_sender)),
        })
    }

    /// Convenience constructor for feature-scoped MCP contexts.
    /// Creates a context with fresh channels, suitable for sharing across
    /// all queue items within a single feature's workflow.
    pub fn for_feature(
        feature_id: i64,
        read_pool: SqlitePool,
        write_pool: SqlitePool,
    ) -> (Arc<Self>, oneshot::Receiver<Option<String>>) {
        let (done_tx, done_rx) = oneshot::channel();
        let ctx = Self::new(read_pool, write_pool, feature_id, done_tx);
        (ctx, done_rx)
    }

    /// Resolve a pending approval by request ID. Returns true if the approval was found and resolved.
    pub fn resolve_approval(&self, request_id: &str, result: ApprovalResult) -> bool {
        if let Some((_, sender)) = self.pending_approvals.remove(request_id) {
            sender.send(result).is_ok()
        } else {
            false
        }
    }
}
