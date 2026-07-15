//! Worktree-state hydration for `session.init`.
//!
//! A client that opens a conversation after worktree provisioning has already
//! run — e.g. the desktop opening a worktree conversation started on a phone —
//! would otherwise see no worktree state at all, since the live provisioning
//! envelopes only reach devices connected while they ran. Delegates to the
//! worktree domain's [`worktree::replay_persisted_state`], the single source of
//! truth for replaying the persisted state (shared with the prompt-time
//! existing-worktree path) so the emitted shape can never drift.

use super::WsSender;
use crate::app_state::AppState;
use crate::domain::workflow::worktree;

/// Replay the feature's current worktree provisioning state to `sender`. A
/// no-op for features with no worktree (skip mode or none yet).
pub(super) async fn restore_worktree_state(
    app_state: &AppState,
    sender: &WsSender,
    feature_id: i64,
) -> Result<(), String> {
    worktree::replay_persisted_state(&app_state.read_pool, feature_id, sender)
        .await
        .map(|_| ())
}
