use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::agents::adapter::RuntimeEvent;
use crate::domain::sessions::models::SessionStatusSnapshotEntry;

use super::live::{LiveStatusBook, Source, Transition, TurnStart};
use super::{
    derive_broadcast_status, event_starts_fresh_turn, provider_signal_for_event, AgentStatus,
    PendingKind, SessionStatusEvent, TurnOutcome,
};

/// The live status of every non-idle session, as sent to a (re)connecting
/// client. Read from the same book, under the same lock, as the events.
#[derive(Clone, Debug, Serialize)]
pub struct SessionStatusSnapshot {
    pub states: HashMap<String, SessionStatusSnapshotEntry>,
    /// Every later event has a higher seq; every earlier one is folded in.
    pub seq: u64,
    /// Identifies this server process: `seq` restarts at zero with every
    /// process, so a client compares seqs only within one epoch.
    pub epoch: i64,
    pub server_now_ms: i64,
}

/// The single writer for live agent status. Wraps a tokio broadcast channel
/// plus the [`LiveStatusBook`] every event is a transition of, so the
/// snapshot a client receives can never disagree with the events it gets.
///
/// Cloning is cheap (shared state). Stored on `AppState`.
#[derive(Clone, Debug)]
pub struct SessionStatusBroadcaster {
    tx: broadcast::Sender<SessionStatusEvent>,
    book: Arc<Mutex<LiveStatusBook>>,
    epoch: i64,
}

impl SessionStatusBroadcaster {
    pub fn new(tx: broadcast::Sender<SessionStatusEvent>) -> Self {
        Self {
            tx,
            book: Arc::default(),
            epoch: now_ms(),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionStatusEvent> {
        self.tx.subscribe()
    }

    /// Load the sessions persisted as running or gated, at boot.
    pub fn seed(&self, entries: impl IntoIterator<Item = SessionStatusSnapshotEntry>) {
        let mut book = self.lock();
        for entry in entries {
            book.seed(entry);
        }
    }

    pub fn snapshot(&self) -> SessionStatusSnapshot {
        let book = self.lock();
        SessionStatusSnapshot {
            states: book.snapshot(),
            seq: book.seq(),
            epoch: self.epoch,
            server_now_ms: now_ms(),
        }
    }

    /// Whether a session has a live turn or a pending user-input gate.
    pub fn is_busy(&self, session_id: i64) -> bool {
        self.lock().is_busy(session_id)
    }

    /// Broadcast a status transition of the current turn. Returns the new
    /// seq, or `None` when nothing changed.
    pub fn broadcast(
        &self,
        session_id: i64,
        feature_id: i64,
        status: AgentStatus,
        kind: Option<PendingKind>,
    ) -> Option<u64> {
        let derived = derive_broadcast_status(status, kind);
        self.apply(Transition {
            kind: derived.kind,
            ..Transition::new(session_id, feature_id, derived.status)
        })
    }

    /// Broadcast a pending user-input gate with its stable request identity.
    pub fn broadcast_gate(
        &self,
        session_id: i64,
        feature_id: i64,
        kind: PendingKind,
        request_id: String,
    ) -> Option<u64> {
        self.apply(Transition {
            kind: Some(kind),
            request_id: Some(request_id),
            ..Transition::new(session_id, feature_id, AgentStatus::Question)
        })
    }

    /// Resolve a gate without clearing one published during answer delivery.
    pub fn broadcast_gate_resolved(
        &self,
        session_id: i64,
        feature_id: i64,
        request_id: &str,
        status: AgentStatus,
    ) -> Option<u64> {
        self.apply(Transition {
            source: Source::GateResponse {
                request_id: request_id.to_string(),
            },
            ..Transition::new(session_id, feature_id, status)
        })
    }

    /// Broadcast that a new turn starts now. Every later event of the turn
    /// carries that start.
    pub fn broadcast_running(&self, session_id: i64, feature_id: i64) -> Option<u64> {
        self.apply(Transition {
            turn_start: TurnStart::Fresh,
            ..Transition::new(session_id, feature_id, AgentStatus::Agent)
        })
    }

    /// Broadcast that the session went idle because its turn failed.
    pub fn broadcast_turn_failed(&self, session_id: i64, feature_id: i64) -> Option<u64> {
        self.apply(Transition {
            outcome: Some(TurnOutcome::Failed),
            ..Transition::new(session_id, feature_id, AgentStatus::Idle)
        })
    }

    /// Reflect a runtime event. Called for every event of a live turn, so
    /// repeats are absorbed here. Stream activity never answers a pending
    /// gate, and only an event that starts a turn brings an idle session back.
    pub fn stream_event(
        &self,
        session_id: i64,
        feature_id: i64,
        event: &RuntimeEvent,
    ) -> Option<u64> {
        let signal = provider_signal_for_event(event)?;
        self.apply(Transition {
            source: Source::Stream {
                starts_turn: event_starts_fresh_turn(event),
            },
            ..Transition::new(session_id, feature_id, signal.status())
        })
    }

    /// Mark idle every tracked session whose row is gone (its feature or
    /// project was deleted): no turn will ever end for it to say so.
    pub async fn forget_deleted_sessions(&self, pool: &SqlitePool) -> Result<(), sqlx::Error> {
        let tracked = self.lock().tracked();
        if tracked.is_empty() {
            return Ok(());
        }
        let ids = serde_json::to_string(&tracked.iter().map(|(id, _)| id).collect::<Vec<_>>())
            .expect("session ids serialize");
        let existing: HashSet<i64> = sqlx::query_scalar(
            "SELECT id FROM agent_sessions WHERE id IN (SELECT value FROM json_each(?))",
        )
        .bind(ids)
        .fetch_all(pool)
        .await?
        .into_iter()
        .collect();
        for (session_id, feature_id) in tracked {
            if !existing.contains(&session_id) {
                self.broadcast(session_id, feature_id, AgentStatus::Idle, None);
            }
        }
        Ok(())
    }

    /// Apply and send under one lock, so the channel order is the seq order.
    /// Send errors are intentionally ignored — `broadcast::Sender::send` only
    /// fails when there are no receivers, the normal state with no client.
    fn apply(&self, transition: Transition) -> Option<u64> {
        let mut book = self.lock();
        let event = book.apply(&transition, now_ms())?;
        let seq = event.seq;
        let _ = self.tx.send(event);
        Some(seq)
    }

    fn lock(&self) -> MutexGuard<'_, LiveStatusBook> {
        // The book is plain data mutated in one step; a panic elsewhere can't
        // leave it half-written.
        self.book
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::agents::adapter::{
        RuntimeEventKind, RuntimeEventMetadata, RuntimeStreamEvent,
    };

    fn broadcaster() -> SessionStatusBroadcaster {
        let (tx, _) = broadcast::channel(16);
        SessionStatusBroadcaster::new(tx)
    }

    fn message_start() -> RuntimeEvent {
        RuntimeEvent::new(
            RuntimeEventMetadata::default(),
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::MessageStart {
                    model: None,
                    input_tokens: None,
                },
                parent_tool_use_id: None,
            },
        )
    }

    #[tokio::test]
    async fn failed_turn_goes_idle_with_a_failed_outcome() {
        let broadcaster = broadcaster();
        let mut rx = broadcaster.subscribe();

        broadcaster.broadcast(7, 8, AgentStatus::Agent, None);
        broadcaster.broadcast(7, 8, AgentStatus::Idle, None);
        broadcaster.broadcast_turn_failed(7, 8);

        rx.recv().await.unwrap();
        let completed = rx.recv().await.unwrap();
        assert_eq!(completed.outcome, None);
        assert!(serde_json::to_value(&completed)
            .unwrap()
            .get("outcome")
            .is_none());
        let failed = rx.recv().await.unwrap();
        assert_eq!(failed.status, AgentStatus::Idle);
        assert_eq!(failed.outcome, Some(TurnOutcome::Failed));
        assert_eq!(serde_json::to_value(&failed).unwrap()["outcome"], "failed");
        assert!(failed.seq > completed.seq);
    }

    #[tokio::test]
    async fn gate_broadcast_carries_request_identity_and_the_turn_start() {
        let broadcaster = broadcaster();
        let mut rx = broadcaster.subscribe();

        broadcaster.broadcast_running(7, 8);
        broadcaster.broadcast_gate(7, 8, PendingKind::Permission, "req-42".into());

        let started = rx.recv().await.unwrap();
        let event = rx.recv().await.unwrap();
        assert_eq!(event.status, AgentStatus::Question);
        assert_eq!(event.kind, Some(PendingKind::Permission));
        assert_eq!(event.request_id.as_deref(), Some("req-42"));
        assert_eq!(event.turn_started_at_ms, started.turn_started_at_ms);
    }

    #[test]
    fn a_delayed_answer_cannot_overwrite_the_next_questions_status() {
        let broadcaster = broadcaster();
        broadcaster.broadcast_gate(7, 8, PendingKind::Question, "first".into());
        // The next form arrives while the previous answer is being persisted.
        broadcaster.broadcast_gate(7, 8, PendingKind::Question, "second".into());
        let mut rx = broadcaster.subscribe();
        assert!(broadcaster
            .broadcast_gate_resolved(7, 8, "first", AgentStatus::Agent)
            .is_none());
        assert!(rx.try_recv().is_err());
        let pending = &broadcaster.snapshot().states["7"];
        assert_eq!(pending.status, AgentStatus::Question);
        assert_eq!(pending.request_id.as_deref(), Some("second"));
        assert!(broadcaster
            .broadcast_gate_resolved(7, 8, "second", AgentStatus::Agent)
            .is_some());
        assert_eq!(
            broadcaster.snapshot().states["7"].status,
            AgentStatus::Agent
        );
    }

    #[tokio::test]
    async fn stream_repeats_are_absorbed_and_the_snapshot_folds_the_events() {
        let broadcaster = broadcaster();
        let mut rx = broadcaster.subscribe();

        broadcaster.broadcast_running(7, 8);
        broadcaster.stream_event(7, 8, &message_start());

        let event = rx.recv().await.unwrap();
        assert!(rx.try_recv().is_err(), "stream repeat must be absorbed");
        let snapshot = broadcaster.snapshot();
        assert_eq!(snapshot.seq, event.seq);
        assert_eq!(
            snapshot.states["7"].turn_started_at_ms,
            event.turn_started_at_ms
        );
        let wire = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(wire["epoch"], broadcaster.epoch);
        assert!(wire["server_now_ms"].as_i64().unwrap() > 0);
    }

    #[tokio::test]
    async fn deleted_sessions_are_forgotten() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_sessions (id) VALUES (1)")
            .execute(&pool)
            .await
            .unwrap();
        let broadcaster = broadcaster();
        broadcaster.broadcast_running(1, 10);
        broadcaster.broadcast_running(2, 20);
        let mut rx = broadcaster.subscribe();

        broadcaster.forget_deleted_sessions(&pool).await.unwrap();

        let event = rx.recv().await.unwrap();
        assert_eq!((event.session_id, event.status), (2, AgentStatus::Idle));
        assert!(rx.try_recv().is_err());
        assert_eq!(broadcaster.snapshot().states.len(), 1);
    }
}
