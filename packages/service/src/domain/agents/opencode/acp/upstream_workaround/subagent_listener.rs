//! REST polling listener for OpenCode sub-agent activity (upstream
//! issue sst/opencode#6573 — `Task`/`Agent` events never reach the ACP
//! wire). Polls `GET /session/{root}/children`, `/session/{child}/message`,
//! and `/permission` on the embedded HTTP backend.
//!
//! `prime_snapshot` runs eagerly so pre-existing children are not mispaired;
//! `surfaced_permissions` tracks currently pending permission ids.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex as StdMutex};

use opencode_sdk_rs::{
    Message, MessagePart, MessageRole, OpenCodeClient, PendingPermission, Session,
};
use serde_json::json;
use tokio::sync::{mpsc, RwLock};

use super::subagent_permission::{
    build_request, try_auto_allow_trusted_cadencr_browser_permission,
};
use crate::domain::agents::acp::runtime::permissions::permission_raw_event;
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimePermissionRequest,
};
use crate::domain::agents::opencode::stream_synthesizer::StreamSynthesizer;

pub type PendingSubagentTasks = Arc<StdMutex<VecDeque<String>>>;

/// Pending-permissions map; the adapter's `respond_permission_fallback`
/// reads it to route a reply to `POST /permission/{id}/reply`.
pub type PermissionRegistry = Arc<RwLock<HashMap<String, RuntimePermissionRequest>>>;

pub(super) async fn poll_once(
    client: &OpenCodeClient,
    directory: &str,
    root_session_id: &str,
    state: &mut ListenerState,
    pending_tasks: &PendingSubagentTasks,
    permissions: &PermissionRegistry,
    runtime_tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> Result<(), ()> {
    match client
        .list_children_in_directory(root_session_id, Some(directory))
        .await
    {
        Ok(children) => state.absorb_children(&children, pending_tasks),
        Err(error) => {
            tracing::debug!(%error, "OpenCode sub-agent listener: list_children failed")
        }
    }
    for child_id in state.known_children() {
        if poll_child_messages(client, &child_id, state, runtime_tx)
            .await
            .is_err()
        {
            return Err(());
        }
    }
    poll_permissions(client, directory, state, permissions, runtime_tx).await
}

async fn poll_child_messages(
    client: &OpenCodeClient,
    child_id: &str,
    state: &mut ListenerState,
    runtime_tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> Result<(), ()> {
    let messages = match client.list_messages(child_id).await {
        Ok(messages) => messages,
        Err(error) => {
            tracing::debug!(%error, child = %child_id, "OpenCode sub-agent listener: list_messages failed");
            return Ok(());
        }
    };
    for message in messages {
        for event in state.handle_message(message) {
            if runtime_tx.send(Ok(event)).await.is_err() {
                return Err(());
            }
        }
    }
    Ok(())
}

async fn poll_permissions(
    client: &OpenCodeClient,
    directory: &str,
    state: &mut ListenerState,
    permissions: &PermissionRegistry,
    runtime_tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> Result<(), ()> {
    let entries = match client.list_permissions(Some(directory)).await {
        Ok(entries) => entries,
        Err(error) => {
            tracing::debug!(%error, "OpenCode sub-agent listener: list_permissions failed");
            return Ok(());
        }
    };
    state.prune_surfaced_permissions(&entries);
    for entry in entries {
        if try_auto_allow_trusted_cadencr_browser_permission(client, directory, &entry).await {
            continue;
        }
        if let Some(event) = state.surface_permission(entry, permissions).await {
            if runtime_tx.send(Ok(event)).await.is_err() {
                return Err(());
            }
        }
    }
    Ok(())
}

pub(super) struct ListenerState {
    root_session_id: String,
    /// Baseline of pre-existing children; `None` until `prime_snapshot` runs.
    historical_children: Option<HashSet<String>>,
    child_to_parent: HashMap<String, String>,
    synthesizers: HashMap<String, StreamSynthesizer>,
    surfaced_permissions: HashSet<String>,
}

impl ListenerState {
    pub(super) fn new(root_session_id: String) -> Self {
        Self {
            root_session_id,
            historical_children: None,
            child_to_parent: HashMap::new(),
            synthesizers: HashMap::new(),
            surfaced_permissions: HashSet::new(),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.child_to_parent.is_empty()
    }
    fn known_children(&self) -> Vec<String> {
        self.child_to_parent.keys().cloned().collect()
    }

    /// Capture pre-existing children. MUST run before `absorb_children`,
    /// else this turn's new sub-agents are mispaired.
    pub(super) fn prime_snapshot(&mut self, children: &[Session]) {
        let baseline: HashSet<String> = children
            .iter()
            .filter(|s| s.parent_id.as_deref() == Some(self.root_session_id.as_str()))
            .map(|s| s.id.clone())
            .collect();
        tracing::info!(root = %self.root_session_id, historical = baseline.len(), "OpenCode sub-agent listener: primed historical-children snapshot");
        self.historical_children = Some(baseline);
    }

    fn absorb_children(&mut self, children: &[Session], pending_tasks: &PendingSubagentTasks) {
        for session in children {
            self.maybe_register_child(session, pending_tasks);
        }
    }

    fn maybe_register_child(&mut self, session: &Session, pending_tasks: &PendingSubagentTasks) {
        if session.parent_id.as_deref() != Some(self.root_session_id.as_str()) {
            return;
        }
        let historical = self
            .historical_children
            .as_ref()
            .expect("prime_snapshot must run before absorb_children");
        if historical.contains(&session.id) || self.child_to_parent.contains_key(&session.id) {
            return;
        }
        let parent_tool_use_id = match pending_tasks.lock().ok().and_then(|mut q| q.pop_front()) {
            Some(id) => id,
            None => {
                tracing::warn!(child = %session.id, "OpenCode sub-agent listener: child session has no pending Task call_id to pair with");
                return;
            }
        };
        tracing::info!(child = %session.id, %parent_tool_use_id, "OpenCode sub-agent listener: registered child");
        self.child_to_parent
            .insert(session.id.clone(), parent_tool_use_id);
    }

    fn handle_message(&mut self, message: Message) -> Vec<RuntimeEvent> {
        if !matches!(message.role, MessageRole::Assistant) {
            return Vec::new();
        }
        let Some(parent_tool_use_id) = self.child_to_parent.get(&message.session_id).cloned()
        else {
            return Vec::new();
        };
        let synth = self
            .synthesizers
            .entry(message.session_id.clone())
            .or_insert_with(|| StreamSynthesizer::new(message.model.clone()));
        let mut output = Vec::new();
        for part in &message.parts {
            if matches!(part, MessagePart::StepFinish { .. } | MessagePart::Other(_)) {
                continue;
            }
            output.extend(synth.ingest_part(
                &message.session_id,
                part,
                Some(parent_tool_use_id.as_str()),
            ));
        }
        output
    }

    /// Drop dedupe ids no longer pending upstream — bounds the set.
    fn prune_surfaced_permissions(&mut self, live: &[PendingPermission]) {
        let live_ids: HashSet<&str> = live.iter().map(|p| p.id.as_str()).collect();
        self.surfaced_permissions
            .retain(|id| live_ids.contains(id.as_str()));
    }

    async fn surface_permission(
        &mut self,
        entry: PendingPermission,
        permissions: &PermissionRegistry,
    ) -> Option<RuntimeEvent> {
        if self.surfaced_permissions.contains(&entry.id) {
            return None;
        }
        if entry.session_id == self.root_session_id {
            // Root-session permissions still flow through the ACP wire.
            self.surfaced_permissions.insert(entry.id);
            return None;
        }
        let parent_tool_use_id = self.child_to_parent.get(&entry.session_id).cloned()?;
        self.surfaced_permissions.insert(entry.id.clone());
        let request = build_request(&entry);
        permissions
            .write()
            .await
            .insert(entry.id.clone(), request.clone());
        let acp_params = json!({ "transport": "opencode_http", "permission_id": entry.id });
        let metadata = RuntimeEventMetadata {
            session_id: Some(entry.session_id),
            raw: permission_raw_event(&request, &acp_params),
            ..RuntimeEventMetadata::default()
        };
        let mut event = RuntimeEvent::new(metadata, RuntimeEventKind::Other);
        event.set_parent_tool_use_id(Some(parent_tool_use_id));
        Some(event)
    }
}

#[cfg(test)]
mod tests {
    use super::{ListenerState, PendingSubagentTasks, PermissionRegistry};
    use opencode_sdk_rs::{
        Message, MessagePart, MessageRole, PendingPermission, Session, SessionStatus,
    };
    use serde_json::json;
    use std::collections::{HashMap, VecDeque};
    use std::sync::{Arc, Mutex};
    use tokio::sync::RwLock;

    fn pending(ids: &[&str]) -> PendingSubagentTasks {
        Arc::new(Mutex::new(
            ids.iter().map(|s| s.to_string()).collect::<VecDeque<_>>(),
        ))
    }
    fn registry() -> PermissionRegistry {
        Arc::new(RwLock::new(HashMap::new()))
    }
    fn child(id: &str, parent: &str) -> Session {
        Session {
            id: id.into(),
            title: None,
            directory: "/tmp".into(),
            status: SessionStatus::Active,
            parent_id: Some(parent.into()),
            created_at: None,
            updated_at: None,
        }
    }
    fn asst_text(sess: &str, text: &str) -> Message {
        Message {
            id: "m".into(),
            session_id: sess.into(),
            role: MessageRole::Assistant,
            parts: vec![MessagePart::Text {
                id: "p".into(),
                text: text.into(),
            }],
            created_at: None,
            model: None,
            tokens: None,
            finished: false,
        }
    }
    fn perm(id: &str, session: &str) -> PendingPermission {
        PendingPermission {
            id: id.into(),
            session_id: session.into(),
            tool: Some("bash".into()),
            title: None,
            call_id: None,
            message_id: None,
            patterns: vec!["ls".into()],
            metadata: json!({}),
        }
    }
    fn primed_state() -> (ListenerState, PendingSubagentTasks) {
        let (mut state, queue) = (ListenerState::new("root".into()), pending(&[]));
        state.prime_snapshot(&[]);
        (state, queue)
    }

    #[test]
    fn prime_snapshot_records_baseline_then_absorb_pairs_new_children_fifo() {
        let mut state = ListenerState::new("root".into());
        let queue = pending(&["call_a", "call_b"]);
        state.prime_snapshot(&[child("ses_old", "root"), child("not_mine", "other_root")]);
        assert!(state.child_to_parent.is_empty());
        assert_eq!(queue.lock().unwrap().len(), 2);
        let after = [
            child("ses_old", "root"),
            child("ses_new_1", "root"),
            child("ses_new_2", "root"),
        ];
        state.absorb_children(&after, &queue);
        assert_eq!(state.child_to_parent.get("ses_new_1").unwrap(), "call_a");
        assert_eq!(state.child_to_parent.get("ses_new_2").unwrap(), "call_b");
        assert!(queue.lock().unwrap().is_empty());
    }

    #[test]
    fn registration_is_idempotent_and_ignores_wrong_or_missing_parent() {
        let (mut state, queue) = primed_state();
        queue.lock().unwrap().push_back("call_a".into());
        state.absorb_children(&[child("ses_child", "root")], &queue);
        state.absorb_children(&[child("ses_child", "root")], &queue);
        assert_eq!(state.child_to_parent.len(), 1);
        let mut loose = child("loose", "root");
        loose.parent_id = None;
        state.absorb_children(&[loose, child("other", "different_root")], &queue);
        assert_eq!(state.child_to_parent.len(), 1);
    }

    #[test]
    fn handles_assistant_message_deltas_for_known_child_only() {
        let (mut state, queue) = primed_state();
        queue.lock().unwrap().push_back("call_task".into());
        state.absorb_children(&[child("ses_child", "root")], &queue);
        let first = state.handle_message(asst_text("ses_child", "Hello"));
        let second = state.handle_message(asst_text("ses_child", "Hello world"));
        assert!(!first.is_empty());
        assert_eq!(second.len(), 1, "second poll must emit only the delta");
        assert!(first
            .iter()
            .all(|e| e.parent_tool_use_id() == Some("call_task")));
        assert!(state
            .handle_message(asst_text("ses_unknown", "stray"))
            .is_empty());
    }

    #[tokio::test]
    async fn surface_permission_handles_known_dedupe_root_unknown_pair_and_prune() {
        let (mut state, queue) = primed_state();
        queue.lock().unwrap().push_back("call_task_1".into());
        state.absorb_children(&[child("ses_child", "root")], &queue);
        let reg = registry();
        // Known child → event stamped with parent_tool_use_id + registry entry.
        let event = state
            .surface_permission(perm("per_1", "ses_child"), &reg)
            .await
            .expect("event");
        let raw = event.raw_json();
        assert_eq!(raw["request_id"], "per_1");
        assert_eq!(raw["tool_name"], "Bash");
        assert_eq!(raw["parent_tool_use_id"], "call_task_1");
        assert!(reg.read().await.contains_key("per_1"));
        // Dedupe across re-polls.
        assert!(state
            .surface_permission(perm("per_1", "ses_child"), &reg)
            .await
            .is_none());
        // Live list no longer mentions per_1 → prune drops the dedupe entry.
        state.prune_surfaced_permissions(&[]);
        assert!(state.surfaced_permissions.is_empty());
        // Root-session permission flows over ACP wire — skipped.
        let mut root = ListenerState::new("root".into());
        assert!(root
            .surface_permission(perm("p_r", "root"), &reg)
            .await
            .is_none());
        // Unknown child does NOT mark surfaced — emits once paired.
        let (mut s, q) = primed_state();
        assert!(s
            .surface_permission(perm("per_x", "ses_late"), &reg)
            .await
            .is_none());
        q.lock().unwrap().push_back("call_late".into());
        s.absorb_children(&[child("ses_late", "root")], &q);
        assert!(s
            .surface_permission(perm("per_x", "ses_late"), &reg)
            .await
            .is_some());
    }
}
