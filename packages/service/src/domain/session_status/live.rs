//! The live status book: the server's one record of every non-idle session's
//! status, gate and turn start.
//!
//! Every broadcast is a transition of this book, applied under the lock that
//! stamps the event's `seq`, and every snapshot is a read of it under that same
//! lock. A snapshot is therefore exactly the fold of every event up to its seq:
//! a device that (re)connects sees what the connected ones see.

use std::collections::HashMap;

use crate::domain::sessions::models::SessionStatusSnapshotEntry;

use super::{AgentStatus, PendingKind, SessionStatusEvent, TurnOutcome};

/// Who is asking for a transition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Source {
    /// The code path that owns the change: a prompt, a gate, a stop, a turn end.
    Authoritative,
    /// Runtime stream activity. It proves the turn is alive but cannot answer a
    /// pending gate, so it never turns a `Question` back into `Agent`; and only
    /// an event that `starts_turn` revives a session another path marked idle
    /// (trailing deltas of an interrupted turn must not).
    Stream { starts_turn: bool },
}

/// Where the turn's clock starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TurnStart {
    /// A new turn, starting now.
    Fresh,
    /// The same turn as before. A session leaving idle starts its clock now.
    Continue,
}

#[derive(Clone, Debug)]
pub(super) struct Transition {
    pub session_id: i64,
    pub feature_id: i64,
    pub status: AgentStatus,
    pub kind: Option<PendingKind>,
    pub request_id: Option<String>,
    pub turn_start: TurnStart,
    pub outcome: Option<TurnOutcome>,
    pub source: Source,
}

impl Transition {
    /// An authoritative transition of the current turn; callers override the rest.
    pub(super) fn new(session_id: i64, feature_id: i64, status: AgentStatus) -> Self {
        Self {
            session_id,
            feature_id,
            status,
            kind: None,
            request_id: None,
            turn_start: TurnStart::Continue,
            outcome: None,
            source: Source::Authoritative,
        }
    }
}

/// Non-idle sessions keyed by `session_id`.
#[derive(Debug, Default)]
pub(super) struct LiveStatusBook {
    seq: u64,
    sessions: HashMap<i64, SessionStatusSnapshotEntry>,
}

impl LiveStatusBook {
    pub(super) fn seq(&self) -> u64 {
        self.seq
    }

    /// Load a persisted non-idle session at boot, before any client connects.
    /// A persisted entry has no turn start: the DB doesn't keep one.
    pub(super) fn seed(&mut self, entry: SessionStatusSnapshotEntry) {
        if entry.status != AgentStatus::Idle {
            self.sessions.insert(entry.session_id, entry);
        }
    }

    /// `(session_id, feature_id)` of every non-idle session.
    pub(super) fn tracked(&self) -> Vec<(i64, i64)> {
        self.sessions
            .values()
            .map(|entry| (entry.session_id, entry.feature_id))
            .collect()
    }

    /// Apply a transition. `None` when it changes nothing (a repeat, or stream
    /// activity under a pending gate); otherwise the event to broadcast.
    pub(super) fn apply(
        &mut self,
        transition: &Transition,
        now_ms: i64,
    ) -> Option<SessionStatusEvent> {
        let current = self.sessions.get(&transition.session_id);
        if stream_cannot_apply(current, transition) {
            return None;
        }
        let next = next_entry(current, transition, now_ms);
        // A failed outcome is news even for an already-idle session.
        if next.as_ref() == current && transition.outcome.is_none() {
            return None;
        }
        let turn_started_at_ms = next.as_ref().and_then(|entry| entry.turn_started_at_ms);
        match next {
            Some(entry) => self.sessions.insert(transition.session_id, entry),
            None => self.sessions.remove(&transition.session_id),
        };
        self.seq += 1;
        Some(SessionStatusEvent {
            session_id: transition.session_id,
            feature_id: transition.feature_id,
            status: transition.status,
            kind: transition.kind,
            request_id: transition.request_id.clone(),
            turn_started_at_ms,
            outcome: transition.outcome,
            seq: self.seq,
            server_now_ms: now_ms,
        })
    }

    /// Every non-idle session, keyed by `session_id` for the wire.
    pub(super) fn snapshot(&self) -> HashMap<String, SessionStatusSnapshotEntry> {
        self.sessions
            .iter()
            .map(|(session_id, entry)| (session_id.to_string(), entry.clone()))
            .collect()
    }
}

fn stream_cannot_apply(
    current: Option<&SessionStatusSnapshotEntry>,
    transition: &Transition,
) -> bool {
    let Source::Stream { starts_turn } = transition.source else {
        return false;
    };
    if transition.status != AgentStatus::Agent {
        return false;
    }
    match current {
        Some(entry) => entry.status == AgentStatus::Question,
        None => !starts_turn,
    }
}

fn next_entry(
    current: Option<&SessionStatusSnapshotEntry>,
    transition: &Transition,
    now_ms: i64,
) -> Option<SessionStatusSnapshotEntry> {
    if transition.status == AgentStatus::Idle {
        return None;
    }
    let turn_started_at_ms = match transition.turn_start {
        TurnStart::Fresh => now_ms,
        TurnStart::Continue => current
            .and_then(|entry| entry.turn_started_at_ms)
            .unwrap_or(now_ms),
    };
    Some(SessionStatusSnapshotEntry {
        session_id: transition.session_id,
        feature_id: transition.feature_id,
        status: transition.status,
        kind: transition.kind,
        request_id: transition.request_id.clone(),
        turn_started_at_ms: Some(turn_started_at_ms),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authoritative(status: AgentStatus) -> Transition {
        Transition {
            kind: (status == AgentStatus::Question).then_some(PendingKind::Permission),
            ..Transition::new(7, 8, status)
        }
    }

    fn stream(starts_turn: bool) -> Transition {
        Transition {
            source: Source::Stream { starts_turn },
            ..Transition::new(7, 8, AgentStatus::Agent)
        }
    }

    #[test]
    fn a_turn_keeps_its_start_through_gates_and_stream_activity() {
        let mut book = LiveStatusBook::default();
        let fresh = Transition {
            turn_start: TurnStart::Fresh,
            ..Transition::new(7, 8, AgentStatus::Agent)
        };
        let started = book.apply(&fresh, 1_000).unwrap();
        assert_eq!(started.turn_started_at_ms, Some(1_000));

        let gate = book.apply(&authoritative(AgentStatus::Question), 2_000);
        assert_eq!(gate.unwrap().turn_started_at_ms, Some(1_000));
        let resumed = book.apply(&authoritative(AgentStatus::Agent), 3_000);
        assert_eq!(resumed.unwrap().turn_started_at_ms, Some(1_000));
        assert!(book.apply(&stream(false), 4_000).is_none());
        assert_eq!(book.snapshot()["7"].turn_started_at_ms, Some(1_000));

        let next_turn = book.apply(&fresh, 5_000).unwrap();
        assert_eq!(next_turn.turn_started_at_ms, Some(5_000));
    }

    #[test]
    fn leaving_idle_without_a_stamp_starts_the_clock_now() {
        let mut book = LiveStatusBook::default();
        let event = book.apply(&stream(true), 4_200).unwrap();
        assert_eq!(event.turn_started_at_ms, Some(4_200));
        assert_eq!(event.server_now_ms, 4_200);
    }

    #[test]
    fn repeats_are_not_broadcast_and_do_not_consume_a_seq() {
        let mut book = LiveStatusBook::default();
        assert!(book.apply(&authoritative(AgentStatus::Agent), 1).is_some());
        assert!(book.apply(&authoritative(AgentStatus::Agent), 2).is_none());
        assert!(book.apply(&authoritative(AgentStatus::Idle), 3).is_some());
        assert!(book.apply(&authoritative(AgentStatus::Idle), 4).is_none());
        assert_eq!(book.seq(), 2);
    }

    #[test]
    fn stream_activity_cannot_answer_a_pending_gate() {
        let mut book = LiveStatusBook::default();
        book.apply(&authoritative(AgentStatus::Question), 1);

        assert!(book.apply(&stream(true), 2).is_none());
        assert_eq!(book.snapshot()["7"].status, AgentStatus::Question);
        assert!(book.apply(&authoritative(AgentStatus::Agent), 3).is_some());
    }

    #[test]
    fn only_a_turn_start_revives_a_session_another_path_marked_idle() {
        let mut book = LiveStatusBook::default();
        book.apply(&authoritative(AgentStatus::Agent), 1);
        book.apply(&authoritative(AgentStatus::Idle), 2);

        assert!(book.apply(&stream(false), 3).is_none());
        assert_eq!(
            book.apply(&stream(true), 4).unwrap().status,
            AgentStatus::Agent
        );
    }

    #[test]
    fn idle_sessions_leave_the_snapshot_and_a_failure_is_always_reported() {
        let mut book = LiveStatusBook::default();
        book.apply(&authoritative(AgentStatus::Agent), 1);
        book.apply(&authoritative(AgentStatus::Idle), 2);
        assert!(book.snapshot().is_empty());
        assert!(book.tracked().is_empty());

        let failed = Transition {
            outcome: Some(TurnOutcome::Failed),
            ..authoritative(AgentStatus::Idle)
        };
        let event = book.apply(&failed, 3).unwrap();
        assert_eq!(event.outcome, Some(TurnOutcome::Failed));
        assert_eq!(event.turn_started_at_ms, None);
    }

    #[test]
    fn seeded_entries_join_the_snapshot_without_a_seq() {
        let mut book = LiveStatusBook::default();
        book.seed(SessionStatusSnapshotEntry {
            session_id: 3,
            feature_id: 4,
            status: AgentStatus::Question,
            kind: Some(PendingKind::Question),
            request_id: Some("req-1".into()),
            turn_started_at_ms: None,
        });

        assert_eq!(book.seq(), 0);
        assert_eq!(book.tracked(), vec![(3, 4)]);
        let entry = &book.snapshot()["3"];
        assert_eq!(entry.status, AgentStatus::Question);
        assert_eq!(entry.request_id.as_deref(), Some("req-1"));
    }
}
