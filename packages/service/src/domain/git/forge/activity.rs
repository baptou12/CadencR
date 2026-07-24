use std::collections::HashMap;

use tokio::sync::RwLock;

/// Visibility state for every app-level WebSocket subscribed to forge status.
/// Polling pauses when every connected client is hidden or unfocused.
#[derive(Default)]
pub struct ForgeActivityTracker {
    clients: RwLock<HashMap<String, bool>>,
}

impl ForgeActivityTracker {
    pub async fn register(&self, client_id: String, visible: bool) {
        self.clients.write().await.insert(client_id, visible);
    }

    pub async fn update(&self, client_id: &str, visible: bool) {
        if let Some(entry) = self.clients.write().await.get_mut(client_id) {
            *entry = visible;
        }
    }

    pub async fn remove(&self, client_id: &str) {
        self.clients.write().await.remove(client_id);
    }

    pub async fn has_visible_clients(&self) -> bool {
        self.clients.read().await.values().any(|visible| *visible)
    }
}

#[cfg(test)]
mod tests {
    use super::ForgeActivityTracker;

    #[tokio::test]
    async fn tracks_visibility_across_multiple_clients() {
        let tracker = ForgeActivityTracker::default();
        tracker.register("one".into(), false).await;
        tracker.register("two".into(), true).await;
        assert!(tracker.has_visible_clients().await);

        tracker.update("two", false).await;
        assert!(!tracker.has_visible_clients().await);

        tracker.remove("one").await;
        tracker.remove("two").await;
        assert!(!tracker.has_visible_clients().await);
    }
}
