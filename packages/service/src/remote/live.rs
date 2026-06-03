//! Tracks live remote WebSocket sessions so that revoking a device can
//! force-close its open connections immediately (not just block reconnects).
//!
//! Each remote WS upgrade registers a [`CancellationToken`]; the connection
//! task races the socket against `token.cancelled()`, so cancelling drops the
//! socket without any change to the streaming loops themselves. Revoke cancels
//! every token belonging to the device.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Inner {
    next_id: u64,
    sessions: HashMap<u64, (i64, CancellationToken)>,
}

/// Registry of live remote sessions keyed by an internal connection id.
#[derive(Default)]
pub struct LiveSessions {
    inner: Mutex<Inner>,
}

/// RAII guard returned by [`LiveSessions::register`]. Dropping it deregisters
/// the session, so a normal disconnect can't leak entries.
pub struct SessionGuard {
    registry: std::sync::Weak<LiveSessions>,
    id: u64,
    pub token: CancellationToken,
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.upgrade() {
            registry.inner.lock().unwrap().sessions.remove(&self.id);
        }
    }
}

impl LiveSessions {
    /// Register a session for `device_id`, returning a guard whose `token` the
    /// connection should select on. The guard deregisters on drop.
    pub fn register(self: &std::sync::Arc<Self>, device_id: i64) -> SessionGuard {
        let token = CancellationToken::new();
        let id = {
            let mut inner = self.inner.lock().unwrap();
            let id = inner.next_id;
            inner.next_id += 1;
            inner.sessions.insert(id, (device_id, token.clone()));
            id
        };
        SessionGuard {
            registry: std::sync::Arc::downgrade(self),
            id,
            token,
        }
    }

    /// Cancel every live session belonging to `device_id` (called on revoke).
    pub fn cancel_device(&self, device_id: i64) {
        let inner = self.inner.lock().unwrap();
        for (other, token) in inner.sessions.values() {
            if *other == device_id {
                token.cancel();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn cancel_targets_only_the_revoked_device() {
        let registry = Arc::new(LiveSessions::default());
        let keep = registry.register(1);
        let drop_me = registry.register(2);

        registry.cancel_device(2);

        assert!(!keep.token.is_cancelled());
        assert!(drop_me.token.is_cancelled());
    }

    #[test]
    fn guard_deregisters_on_drop() {
        let registry = Arc::new(LiveSessions::default());
        {
            let _guard = registry.register(7);
            assert_eq!(registry.inner.lock().unwrap().sessions.len(), 1);
        }
        assert_eq!(registry.inner.lock().unwrap().sessions.len(), 0);
        // Cancelling a now-empty device is a no-op (must not panic).
        registry.cancel_device(7);
    }
}
