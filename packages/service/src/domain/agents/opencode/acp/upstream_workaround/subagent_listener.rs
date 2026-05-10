//! Side-channel listener for OpenCode sub-agent (`Task` / `Agent`)
//! child-session events. See the parent `upstream_workaround` module
//! for the "why this exists" overview and the upstream limitation it
//! works around. This file documents the *implementation* choices.
//!
//! ## Why polling instead of SSE
//!
//! OpenCode's embedded HTTP backend also exposes `GET /event` as an SSE
//! stream that would in principle let us push these events. In practice
//! `reqwest_eventsource::EventSource` against the embedded `opencode acp`
//! HTTP server returned an established TCP connection but never yielded a
//! single typed event — neither `Event::Open` nor `Event::Message` —
//! whereas a direct `curl -N` to the same endpoint streamed events fine.
//! Rather than dig further into a transport interaction we don't own, we
//! poll the two REST endpoints (`/session/{id}/children` and
//! `/session/{id}/message`) directly. The cost is bounded (only when
//! sub-agents are pending or active) and the behaviour is provider-neutral
//! and trivially testable.
//!
//! ## Polling cadence
//!
//! Active polling at 250 ms when there's a pending Task call or a known
//! child session; idle polling at 2 s otherwise. Active is short enough
//! that streamed text feels live in the UI; idle is long enough not to
//! flood the embedded backend during normal turns.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use opencode_sdk_rs::{Message, MessagePart, MessageRole, OpenCodeClient, Session};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};
use crate::domain::agents::opencode::stream_synthesizer::StreamSynthesizer;

/// Shared queue of Task/Agent tool_call ids the ACP wire has just announced
/// but for which we haven't yet learned a child session id. The OpenCode
/// adapter pushes onto it from `record_tool_call_start`; this listener pops
/// in FIFO order when a new child session appears under our root.
pub type PendingSubagentTasks = Arc<StdMutex<VecDeque<String>>>;

/// How often we re-list children + re-list messages for known children.
/// Short enough that streaming text feels live in the UI but long enough
/// not to flood the embedded HTTP server during normal turns. Polling is
/// gated: when there's no pending Task call and no registered child, the
/// loop sleeps for `IDLE_INTERVAL` instead.
const ACTIVE_INTERVAL: Duration = Duration::from_millis(250);
const IDLE_INTERVAL: Duration = Duration::from_secs(2);

/// Spawn the listener. The returned `JoinHandle` is owned by the runtime
/// session and aborted on close.
pub fn spawn_subagent_listener(
    opencode_http_port: u16,
    cwd: PathBuf,
    root_session_id: String,
    pending_tasks: PendingSubagentTasks,
    runtime_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> JoinHandle<()> {
    tracing::info!(
        port = opencode_http_port,
        cwd = %cwd.display(),
        root_session_id = %root_session_id,
        "OpenCode sub-agent listener: spawning HTTP polling task"
    );
    tokio::spawn(async move {
        run_listener(
            opencode_http_port,
            cwd,
            root_session_id,
            pending_tasks,
            runtime_tx,
        )
        .await;
    })
}

async fn run_listener(
    port: u16,
    cwd: PathBuf,
    root_session_id: String,
    pending_tasks: PendingSubagentTasks,
    runtime_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) {
    let client = OpenCodeClient::new(port);
    let directory = cwd.to_string_lossy().to_string();
    let mut state = ListenerState::new(root_session_id.clone());

    loop {
        let pending_present = pending_tasks
            .lock()
            .ok()
            .map(|q| !q.is_empty())
            .unwrap_or(false);
        let active = pending_present || !state.is_empty();

        if active {
            if poll_once(
                &client,
                &directory,
                &root_session_id,
                &mut state,
                &pending_tasks,
                &runtime_tx,
            )
            .await
            .is_err()
            {
                tracing::debug!("OpenCode sub-agent listener: runtime channel closed; exiting");
                return;
            }
            tokio::time::sleep(ACTIVE_INTERVAL).await;
        } else {
            tokio::time::sleep(IDLE_INTERVAL).await;
        }
    }
}

/// One poll cycle: re-list children of `root` to discover newly-spawned
/// sub-agent sessions, then re-list messages for every known child and
/// stream any new content through the per-child synthesizer.
///
/// Returns `Err(())` when the runtime channel is closed (caller should
/// stop polling). HTTP errors are logged at debug and swallowed so a brief
/// hiccup doesn't kill the listener for the rest of the session.
async fn poll_once(
    client: &OpenCodeClient,
    directory: &str,
    root_session_id: &str,
    state: &mut ListenerState,
    pending_tasks: &PendingSubagentTasks,
    runtime_tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> Result<(), ()> {
    match client
        .list_children_in_directory(root_session_id, Some(directory))
        .await
    {
        Ok(children) => {
            for session in children {
                state.maybe_register_child(&session, pending_tasks);
            }
        }
        Err(error) => {
            tracing::debug!(%error, "OpenCode sub-agent listener: list_children failed");
        }
    }

    let known_children = state.known_children();
    for child_id in known_children {
        match client.list_messages(&child_id).await {
            Ok(messages) => {
                for message in messages {
                    let events = state.handle_message(message);
                    for event in events {
                        if runtime_tx.send(Ok(event)).await.is_err() {
                            return Err(());
                        }
                    }
                }
            }
            Err(error) => {
                tracing::debug!(
                    %error,
                    child = %child_id,
                    "OpenCode sub-agent listener: list_messages failed"
                );
            }
        }
    }
    Ok(())
}

/// Per-listener state. Pure logic over (input → events) so it's trivially
/// unit-testable; the spawning task only owns I/O. Same shape regardless
/// of whether we feed it from SSE or polling, so swapping transports later
/// is a localized change.
struct ListenerState {
    root_session_id: String,
    /// `child_session_id → parent_tool_use_id`. Lifetime is the runtime
    /// session; children may keep emitting across multiple root turns.
    child_to_parent: HashMap<String, String>,
    /// Per-child synthesizer so streaming part deltas keep stable indices.
    synthesizers: HashMap<String, StreamSynthesizer>,
}

impl ListenerState {
    fn new(root_session_id: String) -> Self {
        Self {
            root_session_id,
            child_to_parent: HashMap::new(),
            synthesizers: HashMap::new(),
        }
    }

    fn is_empty(&self) -> bool {
        self.child_to_parent.is_empty()
    }

    fn known_children(&self) -> Vec<String> {
        self.child_to_parent.keys().cloned().collect()
    }

    fn maybe_register_child(&mut self, session: &Session, pending_tasks: &PendingSubagentTasks) {
        let Some(parent_id) = session.parent_id.as_deref() else {
            return;
        };
        if parent_id != self.root_session_id {
            return;
        }
        if self.child_to_parent.contains_key(&session.id) {
            return;
        }
        let Some(parent_tool_use_id) = pending_tasks
            .lock()
            .ok()
            .and_then(|mut queue| queue.pop_front())
        else {
            tracing::warn!(
                child_session_id = %session.id,
                "OpenCode sub-agent listener: child session created but no pending Task call_id to pair with"
            );
            return;
        };
        tracing::info!(
            child_session_id = %session.id,
            %parent_tool_use_id,
            "OpenCode sub-agent listener: registered child session"
        );
        self.child_to_parent
            .insert(session.id.clone(), parent_tool_use_id);
    }

    fn handle_message(&mut self, message: Message) -> Vec<RuntimeEvent> {
        // Only assistant messages carry the visible tool/text/thinking work.
        // User messages on a child session are the parent's spawn prompt —
        // already rendered by the parent block's input.
        if !matches!(message.role, MessageRole::Assistant) {
            return Vec::new();
        }
        let parent_tool_use_id = match self.child_to_parent.get(&message.session_id).cloned() {
            Some(parent) => parent,
            None => return Vec::new(),
        };
        let synthesizer = self
            .synthesizers
            .entry(message.session_id.clone())
            .or_insert_with(|| StreamSynthesizer::new(message.model.clone()));

        let mut output = Vec::new();
        for part in &message.parts {
            if matches!(part, MessagePart::StepFinish { .. } | MessagePart::Other(_)) {
                continue;
            }
            output.extend(synthesizer.ingest_part(
                &message.session_id,
                part,
                Some(parent_tool_use_id.as_str()),
            ));
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::{ListenerState, PendingSubagentTasks};
    use opencode_sdk_rs::{Message, MessagePart, MessageRole, Session, SessionStatus};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    fn empty_pending() -> PendingSubagentTasks {
        Arc::new(Mutex::new(VecDeque::new()))
    }

    fn child_session(id: &str, parent_id: &str) -> Session {
        Session {
            id: id.to_string(),
            title: None,
            directory: "/tmp".to_string(),
            status: SessionStatus::Active,
            parent_id: Some(parent_id.to_string()),
            created_at: None,
            updated_at: None,
        }
    }

    fn assistant_message_with_text(
        session_id: &str,
        msg_id: &str,
        part_id: &str,
        text: &str,
    ) -> Message {
        Message {
            id: msg_id.to_string(),
            session_id: session_id.to_string(),
            role: MessageRole::Assistant,
            parts: vec![MessagePart::Text {
                id: part_id.to_string(),
                text: text.to_string(),
            }],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: false,
        }
    }

    fn assistant_message_with_tool_use(
        session_id: &str,
        msg_id: &str,
        part_id: &str,
        name: &str,
    ) -> Message {
        Message {
            id: msg_id.to_string(),
            session_id: session_id.to_string(),
            role: MessageRole::Assistant,
            parts: vec![MessagePart::ToolUse {
                id: part_id.to_string(),
                tool_id: part_id.to_string(),
                name: name.to_string(),
                input: serde_json::json!({}),
            }],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: false,
        }
    }

    #[test]
    fn ignores_session_events_without_a_parent_id() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        let session = Session {
            id: "loose".into(),
            parent_id: None,
            ..child_session("loose", "irrelevant")
        };
        state.maybe_register_child(&session, &pending);
        assert!(state.child_to_parent.is_empty());
    }

    #[test]
    fn ignores_child_sessions_of_other_roots() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        state.maybe_register_child(&child_session("ses_x", "other_root"), &pending);
        assert!(state.child_to_parent.is_empty());
    }

    #[test]
    fn skips_registration_when_no_pending_task_is_queued() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);
        assert!(state.child_to_parent.is_empty());
    }

    #[test]
    fn registers_child_when_pending_task_call_id_available() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        pending.lock().unwrap().push_back("call_task_1".to_string());
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);
        assert_eq!(
            state.child_to_parent.get("ses_child").map(String::as_str),
            Some("call_task_1")
        );
        assert!(pending.lock().unwrap().is_empty());
    }

    #[test]
    fn pairs_concurrent_tasks_in_fifo_order() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        {
            let mut queue = pending.lock().unwrap();
            queue.push_back("call_a".into());
            queue.push_back("call_b".into());
        }
        state.maybe_register_child(&child_session("ses_first", "root"), &pending);
        state.maybe_register_child(&child_session("ses_second", "root"), &pending);
        assert_eq!(
            state.child_to_parent.get("ses_first").map(String::as_str),
            Some("call_a")
        );
        assert_eq!(
            state.child_to_parent.get("ses_second").map(String::as_str),
            Some("call_b")
        );
    }

    #[test]
    fn re_registration_attempts_are_idempotent() {
        // Polling re-lists every cycle; calling maybe_register_child for the
        // same child twice must not pop a second pending task or clobber the
        // existing mapping.
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        {
            let mut queue = pending.lock().unwrap();
            queue.push_back("call_a".into());
            queue.push_back("call_b".into());
        }
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);
        assert_eq!(state.child_to_parent.len(), 1);
        // Only one pop happened; "call_b" is still queued for the next child.
        assert_eq!(pending.lock().unwrap().len(), 1);
    }

    #[test]
    fn emits_runtime_events_for_known_child_assistant_message() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        pending.lock().unwrap().push_back("call_task".into());
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);

        let events = state.handle_message(assistant_message_with_text(
            "ses_child",
            "msg_1",
            "part_1",
            "Hello from the sub-agent",
        ));
        assert!(!events.is_empty(), "expected at least one runtime event");
        for event in &events {
            assert_eq!(event.parent_tool_use_id(), Some("call_task"));
        }
    }

    #[test]
    fn ignores_messages_for_unknown_child_sessions() {
        let mut state = ListenerState::new("root".into());
        let events = state.handle_message(assistant_message_with_text(
            "ses_child",
            "msg_1",
            "part_1",
            "stray text",
        ));
        assert!(events.is_empty());
    }

    #[test]
    fn ignores_user_role_messages_for_known_children() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        pending.lock().unwrap().push_back("call_task".into());
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);

        let mut user_msg = assistant_message_with_text("ses_child", "msg_u", "p_u", "user echo");
        user_msg.role = MessageRole::User;
        let events = state.handle_message(user_msg);
        assert!(events.is_empty());
    }

    #[test]
    fn deduplicates_repeated_tool_use_parts_across_polls() {
        // Polling re-lists the full message every cycle. A ToolUse part must
        // not produce a duplicate ContentBlockStart on each poll — the
        // synthesizer's part_index gives us idempotency for free.
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        pending.lock().unwrap().push_back("call_task".into());
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);

        let first = state.handle_message(assistant_message_with_tool_use(
            "ses_child",
            "msg_1",
            "tool_1",
            "Read",
        ));
        let second = state.handle_message(assistant_message_with_tool_use(
            "ses_child",
            "msg_1",
            "tool_1",
            "Read",
        ));
        assert!(!first.is_empty(), "first poll should emit tool_use start");
        assert!(
            second.is_empty(),
            "second poll of identical tool_use must not duplicate"
        );
    }

    #[test]
    fn streaming_text_emits_only_the_delta_on_subsequent_polls() {
        let mut state = ListenerState::new("root".into());
        let pending = empty_pending();
        pending.lock().unwrap().push_back("call_task".into());
        state.maybe_register_child(&child_session("ses_child", "root"), &pending);

        let _ = state.handle_message(assistant_message_with_text(
            "ses_child",
            "msg_1",
            "part_1",
            "Hello",
        ));
        let second = state.handle_message(assistant_message_with_text(
            "ses_child",
            "msg_1",
            "part_1",
            "Hello world",
        ));
        // Second poll: same part_id so no new ContentBlockStart, only one
        // delta event for " world".
        assert_eq!(second.len(), 1);
    }
}
