//! Resolution of service-owned approval gates (see
//! `domain::mcp::control::approval_registry`).
//!
//! These gates are raised by the control plane, not by a provider runtime, so
//! their answer has to stop here. Letting it fall through would hand the
//! decision to the provider's permission channel, where it would silently
//! answer the *next* real permission request instead.

use axum::extract::ws::Message;

use super::super::types::WsSender;
use crate::app_state::AppState;
use crate::domain::mcp::control::approval_registry::ApprovalOutcome;
use crate::domain::session_status::AgentStatus;
use crate::domain::ws_session::persistence::{PendingUserInputKind, WsSessionPersistence};
use crate::domain::ws_session::protocol::{
    PermissionDecision, PermissionRespondPayload, WsEnvelope,
};

/// Answer an already-claimed gate when the service owns it. Returns `true` when
/// the gate was service-owned and fully handled — the caller must then leave
/// the runtime alone.
pub(crate) async fn resolve_service_approval(
    state: &AppState,
    session_id: i64,
    payload: &PermissionRespondPayload,
    sender: &WsSender,
    envelope_id: &str,
) -> bool {
    let outcome = match payload.decision {
        PermissionDecision::Deny => ApprovalOutcome::Denied {
            feedback: payload.feedback.clone(),
        },
        _ => ApprovalOutcome::Approved,
    };
    if !settle(state, session_id, &payload.request_id, outcome).await {
        return false;
    }
    let ack = WsEnvelope::reply(
        envelope_id,
        "session",
        "acknowledged",
        serde_json::json!({ "action": "permission.respond" }),
    );
    let _ = sender.send(Message::Text(String::from(ack).into()));
    true
}

/// Deny a service-owned gate that the user dismissed. Returns `true` when the
/// gate was service-owned, so the caller skips the runtime deny and interrupt:
/// there is no runtime turn waiting on this answer.
pub(crate) async fn deny_service_approval(
    state: &AppState,
    session_id: i64,
    request_id: &str,
) -> bool {
    settle(
        state,
        session_id,
        request_id,
        ApprovalOutcome::Denied { feedback: None },
    )
    .await
}

async fn settle(
    state: &AppState,
    session_id: i64,
    request_id: &str,
    outcome: ApprovalOutcome,
) -> bool {
    let Some(waiter) = state.tool_approvals.take(session_id, request_id).await else {
        return false;
    };
    // The receiver is gone only if the waiting tool call already timed out; the
    // gate still has to be cleared either way.
    let _ = waiter.send(outcome);
    if let Ok(Some(row)) =
        WsSessionPersistence::try_get_session_row(&state.write_pool, session_id).await
    {
        WsSessionPersistence::mark_agent_resumed_static(
            &state.write_pool,
            &state.session_status_tx,
            session_id,
            row.feature_id,
            PendingUserInputKind::Permission,
            // The tool call resumes as soon as it reads the outcome, so the
            // session goes back to working rather than idle.
            AgentStatus::Agent,
        )
        .await;
    }
    state.pending_gates.complete(session_id, request_id).await;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::mcp::control::approval_registry::ApprovalOutcome;

    fn respond(decision: PermissionDecision, feedback: Option<&str>) -> PermissionRespondPayload {
        PermissionRespondPayload {
            session_id: "7".to_string(),
            request_id: "r1".to_string(),
            message_uuid: None,
            decision,
            option_id: None,
            feedback: feedback.map(str::to_string),
            updated_input: None,
        }
    }

    async fn state() -> AppState {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        AppState::with_pool(pool)
    }

    #[tokio::test]
    async fn an_allow_resolves_the_waiter_and_acknowledges() {
        let state = state().await;
        let waiter = state.tool_approvals.insert(7, "r1").await;
        let (sender, mut received) = tokio::sync::mpsc::unbounded_channel::<Message>();

        let handled = resolve_service_approval(
            &state,
            7,
            &respond(PermissionDecision::AllowOnce, None),
            &sender,
            "env-1",
        )
        .await;

        assert!(handled);
        assert_eq!(waiter.await.unwrap(), ApprovalOutcome::Approved);
        assert!(received.try_recv().is_ok());
    }

    #[tokio::test]
    async fn a_deny_forwards_the_users_feedback() {
        let state = state().await;
        let waiter = state.tool_approvals.insert(7, "r1").await;
        let (sender, _received) = tokio::sync::mpsc::unbounded_channel::<Message>();

        resolve_service_approval(
            &state,
            7,
            &respond(PermissionDecision::Deny, Some("still needed")),
            &sender,
            "env-1",
        )
        .await;

        assert_eq!(
            waiter.await.unwrap(),
            ApprovalOutcome::Denied {
                feedback: Some("still needed".to_string())
            }
        );
    }

    #[tokio::test]
    async fn a_runtime_owned_gate_is_left_alone() {
        let state = state().await;
        let (sender, mut received) = tokio::sync::mpsc::unbounded_channel::<Message>();

        let handled = resolve_service_approval(
            &state,
            7,
            &respond(PermissionDecision::AllowOnce, None),
            &sender,
            "env-1",
        )
        .await;

        assert!(!handled);
        assert!(received.try_recv().is_err());
    }

    #[tokio::test]
    async fn closing_a_service_gate_denies_it_without_touching_the_runtime() {
        let state = state().await;
        let waiter = state.tool_approvals.insert(7, "r1").await;

        assert!(deny_service_approval(&state, 7, "r1").await);
        assert_eq!(
            waiter.await.unwrap(),
            ApprovalOutcome::Denied { feedback: None }
        );
        // Second close finds nothing left to deny.
        assert!(!deny_service_approval(&state, 7, "r1").await);
    }
}
