//! Features the poller can answer for without talking to a forge at all.

use super::super::provider::PrStatusSnapshot;
use super::super::repository::FeatureForgeTarget;

/// The snapshot to publish for a feature that cannot be polled, or `None` when
/// it can be.
pub(super) fn target_without_repo_snapshot(
    target: &FeatureForgeTarget,
) -> Option<PrStatusSnapshot> {
    if let Some(error) = &target.error {
        return Some(snapshot(target.feature_id, Some(error.clone())));
    }
    // Not an error: plenty of features never get a remote, and saying so in the
    // sidebar would be noise rather than news.
    if target.remote.is_none() {
        return Some(snapshot(target.feature_id, None));
    }
    if target.branch.is_none() {
        return Some(snapshot(
            target.feature_id,
            Some("Could not determine the feature branch".into()),
        ));
    }
    None
}

fn snapshot(feature_id: i64, error: Option<String>) -> PrStatusSnapshot {
    PrStatusSnapshot::unpolled(feature_id, error, false)
}
