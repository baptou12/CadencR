use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;

use tokio::sync::RwLock;

use super::provider::PrStatusSnapshot;

#[derive(Default)]
pub struct ForgeStatusCache {
    by_feature: RwLock<HashMap<i64, PrStatusSnapshot>>,
    /// The branch each published snapshot's top-level proposal belongs to.
    current_branches: RwLock<HashMap<i64, String>>,
    pub(super) refresh_lock: tokio::sync::Mutex<()>,
    /// A forced refresh is queued and has not started yet.
    pub(super) refresh_requested: AtomicBool,
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

    /// Record the branch the poller just treated as `feature_id`'s current one.
    pub(super) async fn set_current_branch(&self, feature_id: i64, branch: Option<&str>) {
        let mut branches = self.current_branches.write().await;
        match branch {
            Some(branch) => branches.insert(feature_id, branch.to_string()),
            None => branches.remove(&feature_id),
        };
    }

    /// Note `current` as `feature_id`'s current branch and report whether the
    /// published snapshot describes another one — the conversation switched
    /// branches since the last poll. True once per switch: the git status
    /// recomputes that follow see `current` already noted.
    pub async fn note_current_branch(&self, feature_id: i64, current: &str) -> bool {
        // Read first: nearly every recompute finds nothing new.
        let unchanged = self
            .current_branches
            .read()
            .await
            .get(&feature_id)
            .is_none_or(|known| known == current);
        if unchanged {
            return false;
        }
        let mut branches = self.current_branches.write().await;
        match branches.get_mut(&feature_id) {
            Some(known) if known != current => {
                *known = current.to_string();
                true
            }
            _ => false,
        }
    }

    pub async fn retain_features(&self, feature_ids: &HashSet<i64>) {
        self.by_feature
            .write()
            .await
            .retain(|feature_id, _| feature_ids.contains(feature_id));
        self.current_branches
            .write()
            .await
            .retain(|feature_id, _| feature_ids.contains(feature_id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_branch_switch_is_reported_once_and_only_after_a_poll() {
        let cache = ForgeStatusCache::default();
        // Nothing published yet: the first poll will describe the branch anyway.
        assert!(!cache.note_current_branch(1, "fix/b").await);

        cache.set_current_branch(1, Some("feature/a")).await;
        assert!(!cache.note_current_branch(1, "feature/a").await);
        assert!(cache.note_current_branch(1, "fix/b").await);
        assert!(!cache.note_current_branch(1, "fix/b").await);
        assert!(cache.note_current_branch(1, "feature/a").await);
    }
}
