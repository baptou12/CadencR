//! Process-global registry of which WS connection owns each session's live
//! turn.
//!
//! The per-connection `sdk_sessions` map (see [`super::types`]) holds the
//! running query handle + permission channel only inside the connection that
//! started the turn. That breaks multi-device use: a remote viewer's
//! connection holds a `Pending` handle, so it can't answer a
//! permission/question/plan. This registry maps `agent_sessions.id` to a
//! `Weak` pointer to the owning connection's map, so any connection can
//! resolve the authoritative live handle and answer against it.
//!
//! Liveness always comes from the owner's handle (we store a `Weak`, never a
//! clone of the query/channel), so a turn that ended or a connection that
//! dropped is reflected automatically — there is no stale channel to send to.
//! It also stores the server-stamped turn start time so every client renders
//! a synchronized elapsed timer (single source of truth).

use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;

use super::types::{SdkHandle, SdkSessions};

/// Inner of [`SdkSessions`] (`Arc<Mutex<HashMap<i64, SdkHandle>>>`) — the
/// target a [`Weak`] points at.
type SdkSessionsInner = Mutex<HashMap<i64, SdkHandle>>;

struct ActiveTurn {
    /// Weak handle to the owning connection's per-connection session map.
    /// Weak so a dropped connection's map is freed and this entry becomes
    /// inert automatically — no manual teardown on every exit path.
    owner: Weak<SdkSessionsInner>,
    /// Server wall-clock (epoch ms) when the current turn started.
    started_at_ms: i64,
}

/// Maps `agent_sessions.id` → the connection that owns its live turn.
#[derive(Default)]
pub struct ActiveTurnRegistry {
    turns: Mutex<HashMap<i64, ActiveTurn>>,
}

impl ActiveTurnRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that `owner`'s connection is driving a turn for `db_session_id`,
    /// stamping a fresh start time. Called at every turn start
    /// (`mark_agent_running`); a mid-turn respawn keeps the same owner map, so
    /// it does not need to touch the registry.
    pub(crate) async fn begin_turn(
        &self,
        db_session_id: i64,
        owner: &SdkSessions,
        started_at_ms: i64,
    ) {
        let mut turns = self.turns.lock().await;
        turns.insert(
            db_session_id,
            ActiveTurn {
                owner: Arc::downgrade(owner),
                started_at_ms,
            },
        );
    }

    /// The server-stamped start time for a session's live turn, if its owner
    /// is still connected. Used to hydrate a (re)connecting client's timer.
    pub(crate) async fn started_at(&self, db_session_id: i64) -> Option<i64> {
        let turns = self.turns.lock().await;
        let entry = turns.get(&db_session_id)?;
        entry.owner.upgrade().map(|_| entry.started_at_ms)
    }

    /// Resolve the owning connection's session map for a session, if the owner
    /// is still connected. Lets a non-owning connection answer a pending
    /// permission/question/plan against the live query. Prunes the entry if
    /// the owner has gone away.
    pub(crate) async fn owner_sessions(&self, db_session_id: i64) -> Option<SdkSessions> {
        let mut turns = self.turns.lock().await;
        let entry = turns.get(&db_session_id)?;
        match entry.owner.upgrade() {
            Some(arc) => Some(arc),
            None => {
                turns.remove(&db_session_id);
                None
            }
        }
    }

    /// Drop every entry owned by `owner` — called when its connection closes.
    pub(crate) async fn remove_owned_by(&self, owner: &SdkSessions) {
        // Compare by address-as-`usize` rather than holding a raw pointer
        // across the lock `.await` (a raw pointer is `!Send`, which would
        // poison the whole connection future).
        let target = Arc::as_ptr(owner) as usize;
        let mut turns = self.turns.lock().await;
        turns.retain(|_, t| match t.owner.upgrade() {
            Some(arc) => Arc::as_ptr(&arc) as usize != target,
            None => false,
        });
    }
}

/// Server wall-clock in epoch milliseconds. Matches the frontend's
/// `Date.now()` reference so the synchronized timer's only error is device
/// clock skew (a constant per-device offset).
pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    fn empty_sessions() -> SdkSessions {
        Arc::new(Mutex::new(StdHashMap::new()))
    }

    #[tokio::test]
    async fn begin_turn_records_owner_and_start() {
        let reg = ActiveTurnRegistry::new();
        let owner = empty_sessions();
        reg.begin_turn(42, &owner, 1_000).await;

        assert_eq!(reg.started_at(42).await, Some(1_000));
        assert!(reg.owner_sessions(42).await.is_some());
    }

    #[tokio::test]
    async fn dropped_owner_makes_entry_inert() {
        let reg = ActiveTurnRegistry::new();
        let owner = empty_sessions();
        reg.begin_turn(7, &owner, 5).await;
        drop(owner);

        assert_eq!(reg.started_at(7).await, None);
        assert!(reg.owner_sessions(7).await.is_none());
    }

    #[tokio::test]
    async fn remove_owned_by_drops_only_matching_entries() {
        let reg = ActiveTurnRegistry::new();
        let a = empty_sessions();
        let b = empty_sessions();
        reg.begin_turn(1, &a, 0).await;
        reg.begin_turn(2, &b, 0).await;

        reg.remove_owned_by(&a).await;

        assert!(reg.owner_sessions(1).await.is_none());
        assert!(reg.owner_sessions(2).await.is_some());
    }
}
