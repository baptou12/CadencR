//! Interrupting a session's current work, shared by the WebSocket
//! `session.interrupt` handler and the MCP `project_stop_session` control
//! endpoint. Deliberately free of `WsSender`/envelope concerns: callers map the
//! outcome onto their own reply shape.

use std::sync::atomic::Ordering;

use tracing::error;

use super::super::types::{QueryState, SdkSessions};
use crate::app_state::AppState;

/// What an interrupt request actually did to the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InterruptOutcome {
    /// A Cadencr-managed `!` shell run was cancelled; no agent turn was live.
    ShellRunCancelled,
    /// The live turn received the interrupt.
    Interrupted,
    /// No runtime handle for this session on any connection.
    SessionNotFound,
    /// A handle exists but no turn is running. A pending manual compact has
    /// been flagged for cancellation.
    NotActive,
}

/// Gracefully interrupt `db_session_id`'s current work. The session stays
/// resumable: nothing is killed or closed, only the running turn is asked to
/// stop.
///
/// `own_sessions` is the caller's own connection map, tried first; a turn owned
/// by a different connection (or by no connection at all, for MCP-started
/// turns) is resolved through the global owner registry.
pub(crate) async fn interrupt_session(
    app_state: &AppState,
    own_sessions: &SdkSessions,
    db_session_id: i64,
) -> Result<InterruptOutcome, String> {
    if app_state.user_shell_runs.cancel(db_session_id).await {
        return Ok(InterruptOutcome::ShellRunCancelled);
    }

    // The live turn may be owned by another connection (e.g. the host stopping a
    // conversation started on a remote device). Resolve the owning map so the
    // interrupt reaches the running CLI rather than failing with NOT_FOUND. The
    // resulting Idle status already broadcasts to every device via
    // `session_status_tx`, so no extra mirror is needed here.
    let sdk_sessions = super::resolve_owner_sessions(own_sessions, app_state, db_session_id).await;

    let active_query = {
        let sessions = sdk_sessions.lock().await;
        let Some(handle) = sessions.get(&db_session_id) else {
            return Ok(InterruptOutcome::SessionNotFound);
        };

        match &handle.state {
            QueryState::Active { query, .. } => std::sync::Arc::clone(query),
            QueryState::Pending(_) => {
                handle.manual_compact_cancel.store(true, Ordering::SeqCst);
                return Ok(InterruptOutcome::NotActive);
            }
        }
    };

    // Stop is an intentional user control, not a responder failure. Mark
    // it before interrupting so the concurrently running stream reader can
    // classify Claude's error-result / EOF (and equivalent provider
    // terminal events) as benign. The reply wait deliberately remains
    // armed: a later instruction may resume this same child and should be
    // the result eventually reported to its parent.
    let interrupted_generation = app_state
        .active_turns
        .request_interruption(db_session_id, &active_query)
        .await;
    let q = active_query.read().await;
    if let Err(e) = q.interrupt().await {
        let terminal_event_consumed = if let Some(generation) = interrupted_generation {
            !app_state
                .active_turns
                .clear_interruption(db_session_id, generation, &active_query)
                .await
        } else {
            false
        };
        if terminal_event_consumed {
            // Some providers close their control channel while completing
            // the requested stop. The stream reader already consumed the
            // interruption marker and ended the turn cleanly, so the
            // user's goal succeeded despite the late control error.
            tracing::info!(
                db_session_id,
                error = %e,
                "interrupt control ended after the runtime had already stopped"
            );
        } else {
            error!(db_session_id, error = %e, "interrupt failed");
            return Err(e.to_string());
        }
    }
    Ok(InterruptOutcome::Interrupted)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use tokio::sync::Mutex;

    use super::super::super::tests::support::{make_in_place_effort_handle, make_test_app_state};
    use super::super::super::types::{QueryState, SdkSessions};
    use super::{interrupt_session, InterruptOutcome};
    use crate::domain::agents::adapter::RuntimeSpawnConfig;

    fn empty_sessions() -> SdkSessions {
        Arc::new(Mutex::new(HashMap::new()))
    }

    async fn sessions_with_active_turn(db_session_id: i64) -> SdkSessions {
        let sessions = empty_sessions();
        sessions
            .lock()
            .await
            .insert(db_session_id, make_in_place_effort_handle(1));
        sessions
    }

    #[tokio::test]
    async fn interrupting_an_unknown_session_reports_not_found() {
        let app_state = make_test_app_state().await;

        let outcome = interrupt_session(&app_state, &empty_sessions(), 42)
            .await
            .unwrap();

        assert_eq!(outcome, InterruptOutcome::SessionNotFound);
    }

    #[tokio::test]
    async fn interrupting_a_pending_handle_flags_compact_cancel_and_reports_not_active() {
        let app_state = make_test_app_state().await;
        let sessions = sessions_with_active_turn(42).await;
        {
            let mut guard = sessions.lock().await;
            let handle = guard.get_mut(&42).unwrap();
            handle.state = QueryState::Pending(RuntimeSpawnConfig::default());
        }

        let outcome = interrupt_session(&app_state, &sessions, 42).await.unwrap();

        assert_eq!(outcome, InterruptOutcome::NotActive);
        let guard = sessions.lock().await;
        assert!(guard
            .get(&42)
            .unwrap()
            .manual_compact_cancel
            .load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn interrupting_an_active_turn_reports_interrupted() {
        let app_state = make_test_app_state().await;
        let sessions = sessions_with_active_turn(42).await;

        let outcome = interrupt_session(&app_state, &sessions, 42).await.unwrap();

        assert_eq!(outcome, InterruptOutcome::Interrupted);
    }

    /// The control plane owns no connection map, so it relies entirely on this
    /// fallback to reach a turn another connection is driving.
    #[tokio::test]
    async fn a_turn_owned_by_another_connection_is_still_interrupted() {
        let app_state = make_test_app_state().await;
        let owner_sessions = sessions_with_active_turn(42).await;
        app_state
            .active_turns
            .begin_turn(42, &owner_sessions, 1_000)
            .await;

        let outcome = interrupt_session(&app_state, &empty_sessions(), 42)
            .await
            .unwrap();

        assert_eq!(outcome, InterruptOutcome::Interrupted);
    }
}
