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

use crate::domain::mcp::control::archive_cleanup::CleanupReport;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FeatureEventAction {
    Created,
    Deleted,
    Updated,
    /// A new user message landed, changing the most-recent-user-message sort
    /// key. Clients re-sort their conversation lists but, unlike `Updated`,
    /// the title is unchanged so no single-feature refetch is needed.
    Reordered,
}

/// A feature-list change broadcast to every connected client.
#[derive(Clone, Debug, Serialize)]
pub struct FeatureEvent {
    pub feature_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<i64>,
    pub action: FeatureEventAction,
}

/// An agent archived a conversation with `project_archive_session`. Every
/// client turns it into what the Archive dialog does locally: a toast with the
/// cleanup outcome, closing the conversation's session and terminal panes, and
/// leaving it when it is the one on screen.
///
/// A channel of its own rather than a `FeatureEvent` field: custom tabs receive
/// `FeatureEvent`s, and this payload (titles, branch names, git errors) is not
/// part of their contract.
#[derive(Clone, Debug, Serialize)]
pub struct AgentArchivedEvent {
    pub project_id: i64,
    pub feature_id: i64,
    pub title: String,
    /// Title of the conversation whose agent archived it.
    pub archived_by: String,
    pub archived_feature_ids: Vec<i64>,
    /// The tool's per-step cleanup report, as the agent received it.
    pub cleanup: CleanupReport,
}

/// One toast per agent archive: a lagging client only misses toasts.
const AGENT_ARCHIVED_CAPACITY: usize = 16;

/// Cloneable handle around the broadcast senders. Stored on `AppState`.
#[derive(Clone, Debug)]
pub struct FeatureEventBroadcaster {
    tx: broadcast::Sender<FeatureEvent>,
    agent_archived_tx: broadcast::Sender<AgentArchivedEvent>,
}

impl FeatureEventBroadcaster {
    pub fn new(tx: broadcast::Sender<FeatureEvent>) -> Self {
        let (agent_archived_tx, _) = broadcast::channel(AGENT_ARCHIVED_CAPACITY);
        Self {
            tx,
            agent_archived_tx,
        }
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

    pub fn subscribe_agent_archived(&self) -> broadcast::Receiver<AgentArchivedEvent> {
        self.agent_archived_tx.subscribe()
    }

    /// Same swallowed send error as [`Self::emit`]: no client, no toast.
    pub fn emit_agent_archived(&self, event: AgentArchivedEvent) {
        let _ = self.agent_archived_tx.send(event);
    }
}
