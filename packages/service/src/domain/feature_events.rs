//! Global feature-lifecycle broadcast.
//!
//! Feature create/delete/archive happen over plain HTTP and previously
//! notified nobody: a conversation created on one device never appeared on
//! another until a manual refresh (which itself only refetched projects, not
//! their feature lists). Unlike the per-feature `ws_feature_senders` registry
//! — which only has subscribers for features a client has already opened, so a
//! brand-new feature reaches no one — this channel is global: every connected
//! client subscribes once (via `app/subscribe.feature_events`) and refetches
//! its sidebar feature lists when any feature changes.
//!
//! No `seq`/snapshot: the payload is a hint to invalidate, not state to merge.

use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FeatureEventAction {
    Created,
    Deleted,
    Updated,
}

/// A feature-list change broadcast to every connected client.
#[derive(Clone, Debug, Serialize)]
pub struct FeatureEvent {
    pub feature_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<i64>,
    pub action: FeatureEventAction,
}

/// Cloneable handle around the broadcast sender. Stored on `AppState`.
#[derive(Clone, Debug)]
pub struct FeatureEventBroadcaster {
    tx: broadcast::Sender<FeatureEvent>,
}

impl FeatureEventBroadcaster {
    pub fn new(tx: broadcast::Sender<FeatureEvent>) -> Self {
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<FeatureEvent> {
        self.tx.subscribe()
    }

    /// Emit a feature-list change. Send errors are swallowed — `send` only
    /// fails when there are no subscribers, the normal no-clients-connected
    /// state.
    pub fn emit(&self, feature_id: i64, project_id: Option<i64>, action: FeatureEventAction) {
        let _ = self.tx.send(FeatureEvent {
            feature_id,
            project_id,
            action,
        });
    }
}
