use std::collections::{HashMap, HashSet};

use tokio::sync::RwLock;

use super::provider::PrStatusSnapshot;

#[derive(Default)]
pub struct ForgeStatusCache {
    by_feature: RwLock<HashMap<i64, PrStatusSnapshot>>,
    pub(super) refresh_lock: tokio::sync::Mutex<()>,
}

impl ForgeStatusCache {
    pub async fn list(&self) -> Vec<PrStatusSnapshot> {
        let mut values = self
            .by_feature
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        values.sort_by_key(|snapshot| snapshot.feature_id);
        values
    }

    pub async fn get(&self, feature_id: i64) -> Option<PrStatusSnapshot> {
        self.by_feature.read().await.get(&feature_id).cloned()
    }

    /// Store a snapshot and report whether a semantically-visible field changed.
    /// `fetched_at` alone never emits a WebSocket event.
    pub async fn upsert(&self, snapshot: PrStatusSnapshot) -> bool {
        let mut cache = self.by_feature.write().await;
        let changed = cache
            .get(&snapshot.feature_id)
            .is_none_or(|existing| !existing.semantic_eq(&snapshot));
        cache.insert(snapshot.feature_id, snapshot);
        changed
    }

    pub async fn retain_features(&self, feature_ids: &HashSet<i64>) {
        self.by_feature
            .write()
            .await
            .retain(|feature_id, _| feature_ids.contains(feature_id));
    }
}
