use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, Notify};

/// Tracks in-flight custom-action runs so a `cancel` request can interrupt one
/// by `run_id`, even though the run executes in a detached background task.
///
/// Each running run registers an `Arc<Notify>`; the run task awaits it inside
/// its wait loop and tears the process down (Ctrl-C, then escalate) when it
/// fires. The map is keyed by the `custom_action_runs` row id.
#[derive(Default)]
pub struct CustomActionRunRegistry {
    inner: Mutex<HashMap<i64, Arc<Notify>>>,
}

impl CustomActionRunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register `run_id` and hand back its cancel signal. The run task holds the
    /// returned handle and awaits `notified()`.
    pub async fn register(&self, run_id: i64) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.inner.lock().await.insert(run_id, notify.clone());
        notify
    }

    /// Drop the run once it has finished (cancelled or not).
    pub async fn unregister(&self, run_id: i64) {
        self.inner.lock().await.remove(&run_id);
    }

    /// Request cancellation of a running run. Returns `false` when the run is
    /// not tracked — already finished, never existed, or finalised between the
    /// UI seeing it and the request landing.
    pub async fn cancel(&self, run_id: i64) -> bool {
        match self.inner.lock().await.get(&run_id) {
            Some(notify) => {
                notify.notify_one();
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancel_unknown_run_returns_false() {
        let registry = CustomActionRunRegistry::new();
        assert!(!registry.cancel(1).await);
    }

    #[tokio::test]
    async fn registered_run_can_be_cancelled_then_unregistered() {
        let registry = CustomActionRunRegistry::new();
        let signal = registry.register(7).await;

        // The notify fires for the awaiting run task.
        let waiter = tokio::spawn(async move { signal.notified().await });
        assert!(registry.cancel(7).await);
        waiter.await.unwrap();

        registry.unregister(7).await;
        assert!(
            !registry.cancel(7).await,
            "no longer tracked after unregister"
        );
    }
}
