use std::time::Duration;

use tokio::sync::broadcast;

/// Bounded capacity for the dispatcher status broadcast channel.
///
/// Mirrors Codex's `broadcast::channel(512)` choice but smaller because status
/// events are sparse (one per reconnect/recover, not per delta). 64 is well
/// above the realistic peak rate; if a consumer falls behind we treat
/// `RecvError::Lagged` as a hint to force a reconcile (see service adapter).
pub const STATUS_BUS_CAPACITY: usize = 64;

/// Health/transition states the dispatcher reports to the service adapter so
/// the UI can stop spinning silently. Every state change emits one of these
/// — silence is a bug. The variants are designed to map cleanly onto the
/// provider-neutral `RuntimeStreamStatus` enum on the service side.
#[derive(Debug, Clone)]
pub enum DispatcherStatus {
    /// SSE stream is connected and the watchdog has seen recent activity.
    Connected,
    /// Currently reconnecting after a disconnect / stall / connect failure.
    /// `attempt` increments on each failed connect; resets on success.
    Reconnecting {
        attempt: u32,
        last_error: Option<String>,
    },
    /// The watchdog fired because no events arrived within `since`. The
    /// dispatcher will tear down the stream and reconnect.
    StalledNoHeartbeat { since: Duration },
    /// Reconciliation after a reconnect failed for `session_id`. The
    /// dispatcher continues running; the service adapter decides how to
    /// surface this (degraded banner + retry).
    ReconcileFailed { session_id: String, error: String },
    /// Reconciliation after a reconnect completed; live events have caught
    /// up to authoritative state.
    ReconcileSucceeded {
        session_id: String,
        replayed_events: usize,
    },
    /// Hard failure: too many consecutive reconnect attempts. The dispatcher
    /// keeps trying at a slow cadence, but the service should surface a
    /// fatal-but-retryable error to the UI.
    Failed { error: String },
}

/// Thin wrapper around a `tokio::sync::broadcast::Sender` so the dispatcher
/// has one place to publish lifecycle events. Receivers are obtained via
/// `SseDispatcher::subscribe_status`.
#[derive(Debug, Clone)]
pub struct LifecycleBus {
    tx: broadcast::Sender<DispatcherStatus>,
}

impl LifecycleBus {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(STATUS_BUS_CAPACITY);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DispatcherStatus> {
        self.tx.subscribe()
    }

    /// Publish a status event. Errors mean nobody is listening, which is
    /// fine — we just drop the event. Receivers that fall behind get
    /// `RecvError::Lagged` and are expected to force a reconcile.
    pub fn publish(&self, status: DispatcherStatus) {
        let _ = self.tx.send(status);
    }
}

impl Default for LifecycleBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{DispatcherStatus, LifecycleBus};

    #[tokio::test]
    async fn status_bus_publishes_to_active_subscribers() {
        let bus = LifecycleBus::new();
        let mut rx = bus.subscribe();
        bus.publish(DispatcherStatus::Connected);
        let received = rx.recv().await.expect("expected one status event");
        assert!(matches!(received, DispatcherStatus::Connected));
    }

    #[tokio::test]
    async fn status_bus_drops_events_with_no_subscribers() {
        // No panic, no error — a publish with nobody listening is a no-op.
        let bus = LifecycleBus::new();
        bus.publish(DispatcherStatus::Connected);
    }

    #[tokio::test]
    async fn status_bus_delivers_to_multiple_subscribers() {
        let bus = LifecycleBus::new();
        let mut rx_a = bus.subscribe();
        let mut rx_b = bus.subscribe();
        bus.publish(DispatcherStatus::Reconnecting {
            attempt: 3,
            last_error: Some("boom".to_string()),
        });
        for rx in [&mut rx_a, &mut rx_b] {
            match rx
                .recv()
                .await
                .expect("status delivered to each subscriber")
            {
                DispatcherStatus::Reconnecting {
                    attempt,
                    last_error,
                } => {
                    assert_eq!(attempt, 3);
                    assert_eq!(last_error.as_deref(), Some("boom"));
                }
                other => panic!("unexpected status {other:?}"),
            }
        }
    }
}
