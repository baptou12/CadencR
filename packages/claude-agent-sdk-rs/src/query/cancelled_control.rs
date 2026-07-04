use std::collections::HashSet;
use std::sync::Arc;

use tokio::sync::Mutex;

/// Tracks CLI-cancelled control request IDs until the matching detached
/// permission task observes and consumes the cancellation.
#[derive(Clone, Default)]
pub(super) struct CancelledControlRequests {
    inner: Arc<Mutex<HashSet<String>>>,
}

impl CancelledControlRequests {
    pub(super) async fn mark(&self, request_id: &str) -> bool {
        self.inner.lock().await.insert(request_id.to_string())
    }

    pub(super) async fn take(&self, request_id: &str) -> bool {
        self.inner.lock().await.remove(request_id)
    }
}
