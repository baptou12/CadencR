use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Clone, Copy, PartialEq, Eq)]
enum RunOwnership {
    Active,
    Recovery,
}

#[derive(Clone, Default)]
pub struct FeatureRunRegistry {
    active: Arc<Mutex<HashMap<i64, RunOwnership>>>,
}

impl FeatureRunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn try_acquire(&self, feature_id: i64) -> Option<FeatureRunPermit> {
        self.try_acquire_as(feature_id, RunOwnership::Active)
    }

    pub fn try_acquire_recovery(&self, feature_id: i64) -> Option<FeatureRunPermit> {
        self.try_acquire_as(feature_id, RunOwnership::Recovery)
    }

    fn try_acquire_as(&self, feature_id: i64, ownership: RunOwnership) -> Option<FeatureRunPermit> {
        let mut active = self.active();
        let std::collections::hash_map::Entry::Vacant(entry) = active.entry(feature_id) else {
            return None;
        };
        entry.insert(ownership);
        drop(active);
        Some(FeatureRunPermit {
            registry: Some(self.clone()),
            feature_id,
        })
    }

    pub fn is_owned(&self, feature_id: i64) -> bool {
        self.active().contains_key(&feature_id)
    }

    /// Run a synchronous action only while `feature_id` owns an active run.
    /// Recovery claims are excluded: callers should wait and replay their
    /// terminal result instead of presenting them as live work.
    pub fn if_active<R>(&self, feature_id: i64, action: impl FnOnce() -> R) -> Option<R> {
        let active = self.active();
        (active.get(&feature_id) == Some(&RunOwnership::Active)).then(action)
    }

    fn active(&self) -> MutexGuard<'_, HashMap<i64, RunOwnership>> {
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub struct FeatureRunPermit {
    registry: Option<FeatureRunRegistry>,
    feature_id: i64,
}

impl FeatureRunPermit {
    /// Release the slot and emit its terminal event under one lock.
    pub fn finish<R>(mut self, action: impl FnOnce() -> R) -> R {
        let registry = self.registry.take().expect("permit owns its registry");
        let mut active = registry.active();
        active.remove(&self.feature_id);
        action()
    }
}

impl Drop for FeatureRunPermit {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.take() {
            registry.active().remove(&self.feature_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permit_refuses_duplicate_feature_id() {
        let registry = FeatureRunRegistry::new();

        let _permit = registry.try_acquire(7).unwrap();
        assert!(registry.try_acquire(7).is_none());
    }

    #[test]
    fn dropping_permit_allows_feature_to_run_again() {
        let registry = FeatureRunRegistry::new();

        let permit = registry.try_acquire(7).unwrap();
        drop(permit);
        assert!(registry.try_acquire(7).is_some());
    }

    #[test]
    fn finish_orders_running_before_terminal_action() {
        let registry = FeatureRunRegistry::new();
        let permit = registry.try_acquire(7).unwrap();
        let events = std::cell::RefCell::new(Vec::new());

        registry.if_active(7, || events.borrow_mut().push("running"));
        permit.finish(|| events.borrow_mut().push("ready"));
        assert_eq!(events.into_inner(), vec!["running", "ready"]);
        assert!(!registry.is_owned(7));
    }

    #[test]
    fn recovery_claim_is_owned_but_not_reported_as_active() {
        let registry = FeatureRunRegistry::new();
        let _permit = registry.try_acquire_recovery(7).unwrap();

        assert!(registry.is_owned(7));
        assert!(registry.if_active(7, || ()).is_none());
        assert!(registry.try_acquire(7).is_none());
    }
}
