//! Single source of truth for agent status (idle / agent / question).
//!
//! See `.claude/plans/nous-avons-encore-des-idempotent-sundae.md` for the
//! design rationale. The short version:
//!
//! - Every status mutation goes through [`SessionStatusBroadcaster::broadcast`].
//! - The wire format is per-session: every event carries `session_id` so a
//!   feature with session and sub-agent activity doesn't collapse into a
//!   single ambiguous turn.
//! - The frontend aggregates per-feature client-side via the same rule
//!   encoded in [`aggregate_feature`] — `Question > Agent > Idle`.
//! - [`derive_status_from_db`] is the canonical mapping from the persisted
//!   DB columns (`status`, `pending_*`) to the 3-value [`AgentStatus`]. It
//!   is what the snapshot path uses to hydrate clients on (re)connect.
//!
//! No call site outside this module decides what an "agent is working" or
//! "agent is asking" event looks like — they emit a [`ProviderSignal`] and
//! the broker translates.
//!
//! Provider neutrality is enforced by [`RuntimeStreamEvent`]'s exhaustive
//! match in [`provider_signal_for_stream_event`]: adding a new variant
//! without a mapping is a compile error.
//!
//! Conforms to `.claude/rules/inline-rust-tests.md` (tests live below).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::broadcast;

use crate::domain::agents::adapter::{RuntimeEvent, RuntimeStreamEvent};

/// The canonical 3-value agent status, identical wire format on Rust and TS.
///
/// `Idle` — no active turn, no pending input.
/// `Agent` — runtime is producing output for this session.
/// `Question` — turn paused waiting for the user (carries a [`PendingKind`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Agent,
    Question,
}

/// The two DB-backed user-input gate kinds. Mirrors
/// [`crate::domain::ws_session::persistence::PendingUserInputKind`] — kept
/// separate so this module has no dependency on `ws_session/persistence`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PendingKind {
    Permission,
    Question,
}

/// Provider-neutral signal derived from a runtime event.
///
/// Stream events emitted directly from the runtime carry only Agent/Idle
/// information (turn started / turn ended). User-input gates are detected
/// out-of-band via the adapter's `parse_permission_request` and routed
/// through `mark_awaiting_user_static`, which sets the DB pending column
/// AND broadcasts Question — they don't flow through this enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderSignal {
    /// The agent has started (or is actively producing) a turn.
    TurnStarted,
    /// The turn is finished (provider sent `Result`, stream closed, etc.).
    TurnEnded,
}

impl ProviderSignal {
    pub fn status(self) -> AgentStatus {
        match self {
            Self::TurnStarted => AgentStatus::Agent,
            Self::TurnEnded => AgentStatus::Idle,
        }
    }
}

/// Live status update broadcast to subscribed WS clients.
#[derive(Clone, Debug, Serialize)]
pub struct SessionStatusEvent {
    pub session_id: i64,
    pub feature_id: i64,
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<PendingKind>,
    /// Server wall-clock (epoch ms) when the current turn started. Carried on
    /// `Agent` events (and in the snapshot for a running session) so every
    /// connected client anchors its elapsed timer to one source of truth
    /// instead of each device's local clock-at-first-render.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_started_at_ms: Option<i64>,
    pub seq: u64,
}

/// The single writer for live agent status. Wraps a tokio broadcast channel
/// + a monotonic seq counter so the frontend can reject out-of-order events.
///
/// Cloning is cheap (`broadcast::Sender` and `Arc<AtomicU64>` both share
/// state). Stored on `AppState`; every status mutation goes through
/// [`Self::broadcast`].
#[derive(Clone, Debug)]
pub struct SessionStatusBroadcaster {
    tx: broadcast::Sender<SessionStatusEvent>,
    seq: Arc<AtomicU64>,
}

impl SessionStatusBroadcaster {
    pub fn new(tx: broadcast::Sender<SessionStatusEvent>, seq: Arc<AtomicU64>) -> Self {
        Self { tx, seq }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionStatusEvent> {
        self.tx.subscribe()
    }

    /// Read the counter without advancing it. Used to stamp snapshot
    /// payloads so a snapshot built at instant T tells the frontend
    /// "every event with seq > T is yours, every event with seq <= T was
    /// folded into this snapshot".
    pub fn current_seq(&self) -> u64 {
        self.seq.load(Ordering::Relaxed)
    }

    /// Stamp a fresh seq, send the event. Returns the new seq.
    ///
    /// Send errors are intentionally swallowed — `broadcast::Sender::send`
    /// only fails when there are no receivers, which is the normal state
    /// when no client is connected.
    pub fn broadcast(
        &self,
        session_id: i64,
        feature_id: i64,
        status: AgentStatus,
        kind: Option<PendingKind>,
    ) -> u64 {
        self.broadcast_inner(session_id, feature_id, status, kind, None)
    }

    /// Broadcast that a turn has started, carrying the server-stamped start
    /// time so all clients render a synchronized elapsed timer.
    pub fn broadcast_running_with_start(
        &self,
        session_id: i64,
        feature_id: i64,
        turn_started_at_ms: i64,
    ) -> u64 {
        self.broadcast_inner(
            session_id,
            feature_id,
            AgentStatus::Agent,
            None,
            Some(turn_started_at_ms),
        )
    }

    fn broadcast_inner(
        &self,
        session_id: i64,
        feature_id: i64,
        status: AgentStatus,
        kind: Option<PendingKind>,
        turn_started_at_ms: Option<i64>,
    ) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.tx.send(SessionStatusEvent {
            session_id,
            feature_id,
            status,
            kind,
            turn_started_at_ms,
            seq,
        });
        seq
    }

    /// Convenience: emit a [`ProviderSignal`]. Stream-derived signals
    /// never carry a [`PendingKind`] (those go through
    /// `mark_awaiting_user_static`), so we hardcode `kind = None`.
    pub fn signal(&self, session_id: i64, feature_id: i64, signal: ProviderSignal) -> u64 {
        self.broadcast(session_id, feature_id, signal.status(), None)
    }
}

/// The persisted-DB columns we need to derive a status. Mirrors the
/// relevant subset of `AgentSessionRow`/`SessionRow` so this module has no
/// dependency on either struct.
#[derive(Clone, Copy, Debug)]
pub struct DbStatusInputs<'a> {
    /// `agent_sessions.status` — see persistence module for the legal set
    /// (`idle | running | paused | completed | error | waiting`). This
    /// module only branches on `running` vs. anything else.
    pub status_col: &'a str,
    pub pending_permission: bool,
    pub pending_question: bool,
}

/// Pure mapping from persisted state to the canonical 3-value status.
///
/// Pending columns win over `status_col` because a row that's persisted as
/// `paused` while a permission is pending is semantically a Question, not
/// an Idle. `running` without any pending column is Agent. Everything else
/// is Idle. This is the rule encoded in `get_feature_turn_states` today,
/// just normalized to 3 values.
pub fn derive_status_from_db(inputs: DbStatusInputs<'_>) -> (AgentStatus, Option<PendingKind>) {
    // Question wins. Order of precedence matches today's SQL `MAX(CASE …)`:
    // question > permission.
    if inputs.pending_question {
        return (AgentStatus::Question, Some(PendingKind::Question));
    }
    if inputs.pending_permission {
        return (AgentStatus::Question, Some(PendingKind::Permission));
    }
    if inputs.status_col == "running" {
        return (AgentStatus::Agent, None);
    }
    (AgentStatus::Idle, None)
}

/// Aggregate per-session statuses into a single feature-level status.
///
/// `Question` wins over `Agent` wins over `Idle`. When multiple sessions
/// report `Question`, the first kind encountered wins (callers iterate in
/// session-id order today; this is an arbitrary but stable choice).
///
/// Today the frontend ports this rule to TypeScript so the sidebar can
/// fold per-session entries into a per-feature icon. Kept here as a
/// reference implementation that the TS port mirrors and our tests pin.
#[allow(dead_code)]
pub fn aggregate_feature<I>(entries: I) -> (AgentStatus, Option<PendingKind>)
where
    I: IntoIterator<Item = (AgentStatus, Option<PendingKind>)>,
{
    let mut best = (AgentStatus::Idle, None);
    for (status, kind) in entries {
        match (best.0, status) {
            (_, AgentStatus::Question) => return (status, kind),
            (AgentStatus::Idle, AgentStatus::Agent) => best = (status, kind),
            _ => {}
        }
    }
    best
}

/// Provider-neutral mapping from a [`RuntimeStreamEvent`] to a signal.
///
/// Exhaustive on every variant — adding a new `RuntimeStreamEvent` arm
/// without updating this match is a build error. That is the regression
/// guard for the Codex `MessageStart`-never-broadcast bug.
pub fn provider_signal_for_stream_event(event: &RuntimeStreamEvent) -> Option<ProviderSignal> {
    match event {
        RuntimeStreamEvent::MessageStart { .. }
        | RuntimeStreamEvent::ContentBlockStart { .. }
        | RuntimeStreamEvent::ContentBlockDelta { .. }
        | RuntimeStreamEvent::ContentBlockStop { .. } => Some(ProviderSignal::TurnStarted),
        RuntimeStreamEvent::Other => None,
    }
}

/// Provider-neutral mapping from a [`RuntimeEvent`] to a signal.
///
/// Permission / question gates are NOT derived here — they go through
/// `parse_permission_request` on the adapter, then call
/// `mark_awaiting_user_static` which calls `broadcaster.signal` directly
/// with the right [`PendingKind`].
pub fn provider_signal_for_event(event: &RuntimeEvent) -> Option<ProviderSignal> {
    if event.is_result() {
        return Some(ProviderSignal::TurnEnded);
    }
    match event.stream_event() {
        Some(stream_event) => provider_signal_for_stream_event(stream_event),
        None if event.is_turn_started_signal() => Some(ProviderSignal::TurnStarted),
        None => match event_kind_implies_turn_started(event) {
            true => Some(ProviderSignal::TurnStarted),
            false => None,
        },
    }
}

/// `AssistantMessage` / `UserMessage` (tool result) imply the turn is in
/// progress for every provider. `Init` / `ToolUseSummary` / `CompactBoundary`
/// / `Other` do NOT — they're metadata the agent emits without owning the
/// turn (e.g. a CompactBoundary fires when summarizing in the background).
fn event_kind_implies_turn_started(event: &RuntimeEvent) -> bool {
    match event {
        e if e.assistant_message().is_some() => true,
        e if e.user_message().is_some() => true,
        _ => false,
    }
}

/// Whether this event explicitly starts a fresh turn.
///
/// After a turn ends (Result event), tool_results, content deltas, etc.
/// can still arrive on a stale stream — these must NOT re-enter the
/// "Agent is working" state. Only an explicit `MessageStart` is a valid
/// turn-start signal post-Result. Provider-neutral: every adapter is
/// expected to synthesize `MessageStart` at the top of every turn (Codex
/// emits one on `turn/started`, Claude on `message_start`, OpenCode on
/// stream open). See `stream_reader.rs` for the call site that uses this
/// to gate post-turn status broadcasts.
pub fn event_starts_fresh_turn(event: &RuntimeEvent) -> bool {
    event.is_turn_started_signal()
        || matches!(
            event.stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_inputs(status_col: &str) -> DbStatusInputs<'_> {
        DbStatusInputs {
            status_col,
            pending_permission: false,
            pending_question: false,
        }
    }

    #[test]
    fn agent_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&AgentStatus::Idle).unwrap(),
            "\"idle\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Agent).unwrap(),
            "\"agent\""
        );
        assert_eq!(
            serde_json::to_string(&AgentStatus::Question).unwrap(),
            "\"question\""
        );
    }

    #[test]
    fn pending_kind_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&PendingKind::Permission).unwrap(),
            "\"permission\""
        );
        assert_eq!(
            serde_json::to_string(&PendingKind::Question).unwrap(),
            "\"question\""
        );
    }

    #[test]
    fn provider_signal_status_mapping() {
        assert_eq!(ProviderSignal::TurnStarted.status(), AgentStatus::Agent);
        assert_eq!(ProviderSignal::TurnEnded.status(), AgentStatus::Idle);
    }

    #[test]
    fn derive_running_with_no_pending_is_agent() {
        assert_eq!(
            derive_status_from_db(db_inputs("running")),
            (AgentStatus::Agent, None)
        );
    }

    #[test]
    fn derive_idle_default() {
        assert_eq!(
            derive_status_from_db(db_inputs("idle")),
            (AgentStatus::Idle, None)
        );
        assert_eq!(
            derive_status_from_db(db_inputs("paused")),
            (AgentStatus::Idle, None)
        );
        assert_eq!(
            derive_status_from_db(db_inputs("completed")),
            (AgentStatus::Idle, None)
        );
    }

    #[test]
    fn derive_pending_question_wins_over_running() {
        let mut input = db_inputs("running");
        input.pending_question = true;
        assert_eq!(
            derive_status_from_db(input),
            (AgentStatus::Question, Some(PendingKind::Question))
        );
    }

    #[test]
    fn derive_pending_permission_wins_over_paused() {
        let mut input = db_inputs("paused");
        input.pending_permission = true;
        assert_eq!(
            derive_status_from_db(input),
            (AgentStatus::Question, Some(PendingKind::Permission))
        );
    }

    #[test]
    fn aggregate_feature_idle_when_empty() {
        let agg = aggregate_feature::<Vec<(AgentStatus, Option<PendingKind>)>>(vec![]);
        assert_eq!(agg, (AgentStatus::Idle, None));
    }

    #[test]
    fn aggregate_feature_question_beats_agent() {
        let entries = vec![
            (AgentStatus::Agent, None),
            (AgentStatus::Question, Some(PendingKind::Permission)),
            (AgentStatus::Idle, None),
        ];
        assert_eq!(
            aggregate_feature(entries),
            (AgentStatus::Question, Some(PendingKind::Permission))
        );
    }

    #[test]
    fn aggregate_feature_agent_beats_idle() {
        let entries = vec![(AgentStatus::Idle, None), (AgentStatus::Agent, None)];
        assert_eq!(aggregate_feature(entries), (AgentStatus::Agent, None));
    }

    #[test]
    fn event_starts_fresh_turn_only_on_message_start() {
        use crate::domain::agents::adapter::{
            RuntimeAssistantMessage, RuntimeContentBlock, RuntimeEvent, RuntimeEventKind,
            RuntimeEventMetadata,
        };

        let message_start = RuntimeEvent::new(
            RuntimeEventMetadata::default(),
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::MessageStart {
                    model: None,
                    input_tokens: None,
                },
                parent_tool_use_id: None,
            },
        );
        assert!(event_starts_fresh_turn(&message_start));

        // Tool result (UserMessage), assistant text, content deltas, content
        // stops, and Result events are NOT fresh-turn starts. After a Result
        // sets `between_turns = true`, none of these may flip status back
        // to Agent — only an explicit MessageStart can.
        let assistant = RuntimeEvent::new(
            RuntimeEventMetadata::default(),
            RuntimeEventKind::AssistantMessage {
                message: RuntimeAssistantMessage {
                    model: None,
                    content: vec![RuntimeContentBlock::Text { text: "x".into() }],
                },
                parent_tool_use_id: None,
            },
        );
        assert!(!event_starts_fresh_turn(&assistant));

        let content_block_stop = RuntimeEvent::new(
            RuntimeEventMetadata::default(),
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::ContentBlockStop { index: 0 },
                parent_tool_use_id: None,
            },
        );
        assert!(!event_starts_fresh_turn(&content_block_stop));

        let result = RuntimeEvent::new(RuntimeEventMetadata::default(), RuntimeEventKind::Result);
        assert!(!event_starts_fresh_turn(&result));
    }

    // RuntimeStreamEvent / RuntimeEvent mapping tests live in
    // domain/runtime_stream.rs alongside the helpers they exercise. We
    // re-test the exhaustiveness here so a new variant breaks build at
    // this site too.
    #[test]
    fn provider_signal_for_stream_event_covers_all_variants() {
        use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeContentDelta};

        let cases: Vec<(RuntimeStreamEvent, Option<ProviderSignal>)> = vec![
            (
                RuntimeStreamEvent::MessageStart {
                    model: None,
                    input_tokens: None,
                },
                Some(ProviderSignal::TurnStarted),
            ),
            (
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::Other,
                },
                Some(ProviderSignal::TurnStarted),
            ),
            (
                RuntimeStreamEvent::ContentBlockDelta {
                    index: 0,
                    delta: RuntimeContentDelta::Text { text: "x".into() },
                },
                Some(ProviderSignal::TurnStarted),
            ),
            (
                RuntimeStreamEvent::ContentBlockStop { index: 0 },
                Some(ProviderSignal::TurnStarted),
            ),
            (RuntimeStreamEvent::Other, None),
        ];

        for (event, expected) in cases {
            assert_eq!(provider_signal_for_stream_event(&event), expected);
        }
    }
}
