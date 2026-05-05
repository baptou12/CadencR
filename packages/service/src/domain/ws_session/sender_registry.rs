use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::Message;
use tokio::sync::{mpsc, Mutex};

/// Lightweight registry that maps a `feature_id` to all active WebSocket
/// senders currently subscribed to that feature. Held by `AppState` so HTTP
/// handlers can push WS envelopes without a direct reference to the socket.
///
/// Senders are registered when a WS session opens and removed when it closes.
/// Dead senders (disconnected clients) are pruned lazily on the next broadcast.
#[derive(Clone, Default)]
pub struct WsFeatureSenderRegistry {
    inner: Arc<Mutex<HashMap<i64, Vec<mpsc::UnboundedSender<Message>>>>>,
}

impl WsFeatureSenderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register `sender` for the given `feature_id`.
    pub async fn register(&self, feature_id: i64, sender: mpsc::UnboundedSender<Message>) {
        let mut map = self.inner.lock().await;
        let senders = map.entry(feature_id).or_default();
        senders.retain(|s| !s.same_channel(&sender) && !s.is_closed());
        senders.push(sender);
    }

    /// Remove a specific `sender` for the given `feature_id`.
    #[allow(dead_code)]
    pub async fn unregister(&self, feature_id: i64, sender: &mpsc::UnboundedSender<Message>) {
        let mut map = self.inner.lock().await;
        if let Some(senders) = map.get_mut(&feature_id) {
            senders.retain(|s| !s.same_channel(sender));
            if senders.is_empty() {
                map.remove(&feature_id);
            }
        }
    }

    /// Remove `sender` from every feature it was registered under. Used during
    /// WS disconnect cleanup when the per-feature mapping is not known.
    pub async fn unregister_sender(&self, sender: &mpsc::UnboundedSender<Message>) {
        let mut map = self.inner.lock().await;
        for senders in map.values_mut() {
            senders.retain(|s| !s.same_channel(sender));
        }
        map.retain(|_, senders| !senders.is_empty());
    }

    /// Clone all live senders for `feature_id`. Dead senders are pruned in place.
    pub async fn get_senders(&self, feature_id: i64) -> Vec<mpsc::UnboundedSender<Message>> {
        let mut map = self.inner.lock().await;
        let Some(senders) = map.get_mut(&feature_id) else {
            return Vec::new();
        };
        senders.retain(|s| !s.is_closed());
        senders.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_get_senders() {
        let registry = WsFeatureSenderRegistry::new();
        let (tx, _rx) = mpsc::unbounded_channel::<Message>();

        registry.register(1, tx.clone()).await;
        let senders = registry.get_senders(1).await;
        assert_eq!(senders.len(), 1);
    }

    #[tokio::test]
    async fn register_replaces_same_sender_for_feature() {
        let registry = WsFeatureSenderRegistry::new();
        let (tx, _rx) = mpsc::unbounded_channel::<Message>();

        registry.register(1, tx.clone()).await;
        registry.register(1, tx.clone()).await;
        let senders = registry.get_senders(1).await;
        assert_eq!(senders.len(), 1);
    }

    #[tokio::test]
    async fn unregister_removes_sender() {
        let registry = WsFeatureSenderRegistry::new();
        let (tx, _rx) = mpsc::unbounded_channel::<Message>();

        registry.register(1, tx.clone()).await;
        registry.unregister(1, &tx).await;
        let senders = registry.get_senders(1).await;
        assert!(senders.is_empty());
    }

    #[tokio::test]
    async fn dead_senders_pruned_on_get() {
        let registry = WsFeatureSenderRegistry::new();
        let (tx, rx) = mpsc::unbounded_channel::<Message>();

        registry.register(1, tx).await;
        drop(rx); // close the receiver → sender is dead
        let senders = registry.get_senders(1).await;
        assert!(senders.is_empty());
    }
}
