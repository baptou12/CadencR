use std::collections::HashSet;

use tokio::sync::Mutex;

#[derive(Default)]
pub struct FeatureRunRegistry {
    active: Mutex<HashSet<i64>>,
}

impl FeatureRunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(&self, feature_id: i64) -> bool {
        self.active.lock().await.insert(feature_id)
    }

    pub async fn unregister(&self, feature_id: i64) {
        self.active.lock().await.remove(&feature_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_refuses_duplicate_feature_id() {
        let registry = FeatureRunRegistry::new();

        assert!(registry.register(7).await);
        assert!(!registry.register(7).await);
    }

    #[tokio::test]
    async fn unregister_allows_feature_to_register_again() {
        let registry = FeatureRunRegistry::new();

        assert!(registry.register(7).await);
        registry.unregister(7).await;
        assert!(registry.register(7).await);
    }
}
