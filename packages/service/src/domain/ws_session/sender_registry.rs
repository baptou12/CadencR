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

    /// Return a sender that forwards each message to the owner and every other
    /// client currently viewing `feature_id`. The forwarder exits when all
    /// clones of the returned sender are dropped.
    pub fn fan_out_sender(
        &self,
        feature_id: i64,
        owner: mpsc::UnboundedSender<Message>,
    ) -> mpsc::UnboundedSender<Message> {
        let registry = self.clone();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Some(message) = receiver.recv().await {
                registry.send_and_mirror(feature_id, &owner, message).await;
            }
        });
        sender
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

    /// Mirror `message` to every sender registered for `feature_id` EXCEPT
    /// `exclude` — the connection that drives the turn and already received the
    /// message directly. This is how a live turn's output reaches other devices
    /// viewing the same feature (the remote-access mirror). `message` is taken
    /// by reference and cloned only per *other* recipient, so the common
    /// single-viewer case (only the driver is registered) does no work and no
    /// clones. Dead senders are pruned in place.
    pub async fn broadcast_others(
        &self,
        feature_id: i64,
        exclude: &mpsc::UnboundedSender<Message>,
        message: &Message,
    ) {
        let mut map = self.inner.lock().await;
        let Some(senders) = map.get_mut(&feature_id) else {
            return;
        };
        senders.retain(|s| !s.is_closed());
        for sender in senders.iter() {
            if sender.same_channel(exclude) {
                continue;
            }
            let _ = sender.send(message.clone());
        }
        if senders.is_empty() {
            map.remove(&feature_id);
        }
    }

    /// Send `msg` to the turn `owner` and mirror it to every *other* device
    /// viewing `feature_id`. Others are mirrored first so the owner send can
    /// move `msg` without a clone; with only the owner registered this is a
    /// plain send. Returns `true` when the owner socket is gone, so callers can
    /// stop a loop exactly as a bare `send().is_err()` would.
    pub async fn send_and_mirror(
        &self,
        feature_id: i64,
        owner: &mpsc::UnboundedSender<Message>,
        msg: Message,
    ) -> bool {
        self.broadcast_others(feature_id, owner, &msg).await;
        owner.send(msg).is_err()
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

    #[tokio::test]
    async fn broadcast_others_reaches_other_viewers_but_not_the_driver() {
        let registry = WsFeatureSenderRegistry::new();
        let (driver_tx, mut driver_rx) = mpsc::unbounded_channel::<Message>();
        let (viewer_tx, mut viewer_rx) = mpsc::unbounded_channel::<Message>();
        registry.register(1, driver_tx.clone()).await;
        registry.register(1, viewer_tx).await;

        registry
            .broadcast_others(1, &driver_tx, &Message::Text("hi".into()))
            .await;

        // The other viewer receives the mirror...
        assert!(matches!(viewer_rx.try_recv(), Ok(Message::Text(_))));
        // ...but the driver (excluded) does not — it already got it directly.
        assert!(driver_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn broadcast_others_is_a_noop_with_only_the_driver() {
        let registry = WsFeatureSenderRegistry::new();
        let (driver_tx, mut driver_rx) = mpsc::unbounded_channel::<Message>();
        registry.register(1, driver_tx.clone()).await;

        // Single-viewer (local) case: nobody else to mirror to, so the driver
        // never receives an echo of its own message.
        registry
            .broadcast_others(1, &driver_tx, &Message::Text("hi".into()))
            .await;
        assert!(driver_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn fan_out_sender_follows_viewers_that_connect_mid_run() {
        let registry = WsFeatureSenderRegistry::new();
        let (owner_tx, mut owner_rx) = mpsc::unbounded_channel::<Message>();
        let fan_out = registry.fan_out_sender(1, owner_tx);
        let (viewer_tx, mut viewer_rx) = mpsc::unbounded_channel::<Message>();
        registry.register(1, viewer_tx).await;

        fan_out.send(Message::Text("ready".into())).unwrap();

        assert!(matches!(
            tokio::time::timeout(std::time::Duration::from_secs(1), owner_rx.recv())
                .await
                .unwrap(),
            Some(Message::Text(_))
        ));
        assert!(matches!(
            tokio::time::timeout(std::time::Duration::from_secs(1), viewer_rx.recv())
                .await
                .unwrap(),
            Some(Message::Text(_))
        ));
    }
}
