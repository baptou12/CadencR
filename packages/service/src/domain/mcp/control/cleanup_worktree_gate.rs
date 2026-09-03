//! The human-approval half of `project_cleanup_worktree`.
//!
//! The gate is a normal `session.permission.request` envelope, so the frontend
//! renders it with no changes. What makes it service-owned is the waiter parked
//! in [`crate::domain::mcp::control::approval_registry`]: the resolution paths
//! answer that waiter instead of a provider runtime.

use std::time::Duration;

use axum::extract::ws::Message;

use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeAccessMode;
use crate::domain::agents::providers::default_provider_id;
use crate::domain::mcp::control::approval_registry::{ApprovalOutcome, SERVICE_GATE_MARKER};
use crate::domain::session_status::AgentStatus;
use crate::domain::ws_session::handler::access::{configured_access_mode, runtime_access_mode};
use crate::domain::ws_session::persistence::{
    PendingUserInput, PendingUserInputKind, WsSessionPersistence,
};
use crate::domain::ws_session::protocol::{
    permission_request_envelope, GateCloseReason, GateClosedPayload, PermissionDecision,
    PermissionOptionPayload, PermissionRequestPayload, WsEnvelope, WsSessionAction,
};

/// How long the calling agent blocks before the prompt is withdrawn. Long
/// enough for a user to come back to the app, short enough that a forgotten
/// prompt does not pin an agent turn forever.
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(180);

pub(super) enum Approval {
    Approved,
    Denied(Option<String>),
    TimedOut,
}

/// The caller session's effective access mode. Anything we cannot resolve —
/// unknown session, provider that has no access modes, stale stored value after
/// a provider switch — collapses to `Default`, i.e. "ask the human".
pub(super) async fn caller_access_mode(state: &AppState, session_id: i64) -> RuntimeAccessMode {
    let Ok(Some(row)) =
        WsSessionPersistence::try_get_session_row(&state.read_pool, session_id).await
    else {
        return RuntimeAccessMode::Default;
    };
    let provider = match row.runtime_provider.as_deref() {
        Some(provider) => provider,
        None => default_provider_id(),
    };
    let configured = configured_access_mode(provider, &state.read_pool).await;
    runtime_access_mode(provider, row.codex_permission_mode.as_deref(), configured)
        .unwrap_or(RuntimeAccessMode::Default)
}

/// Raise the gate and block until the user answers or the prompt expires.
pub(super) async fn request_approval(
    state: &AppState,
    session_id: i64,
    feature_id: i64,
    worktree_path: &str,
    branch: &str,
) -> Approval {
    let request_id = uuid::Uuid::new_v4().to_string();
    // Park the waiter before the gate is advertised: an answer can land while
    // this task is still persisting and broadcasting it.
    let waiter = state.tool_approvals.insert(session_id, &request_id).await;
    let payload = approval_payload(&request_id, worktree_path, branch);
    WsSessionPersistence::mark_awaiting_user_static(
        state,
        session_id,
        feature_id,
        &PendingUserInput::Permission(&payload),
    )
    .await;
    broadcast(state, feature_id, gate_envelope(&payload)).await;

    match tokio::time::timeout(APPROVAL_TIMEOUT, waiter).await {
        Ok(Ok(ApprovalOutcome::Approved)) => Approval::Approved,
        Ok(Ok(ApprovalOutcome::Denied { feedback })) => Approval::Denied(feedback),
        // The waiter was dropped without an answer. Fail closed.
        Ok(Err(_)) => Approval::Denied(None),
        Err(_) => {
            withdraw(state, session_id, feature_id, &request_id).await;
            Approval::TimedOut
        }
    }
}

fn approval_payload(
    request_id: &str,
    worktree_path: &str,
    branch: &str,
) -> PermissionRequestPayload {
    PermissionRequestPayload {
        request_id: request_id.to_string(),
        tool_name: super::TOOL_NAME.to_string(),
        tool_input: serde_json::json!({
            SERVICE_GATE_MARKER: true,
            "worktree_path": worktree_path,
            "branch": branch
        }),
        description: Some(format!("Remove the worktree for branch {branch}?")),
        pattern: None,
        preview: Some(worktree_path.to_string()),
        // `gate_policy` refuses any decision the gate did not advertise, so
        // these two options are the whole contract: approve or refuse.
        options: vec![
            PermissionOptionPayload {
                decision: PermissionDecision::AllowOnce,
                option_id: None,
                label: "Remove worktree".to_string(),
                description: "Delete this worktree now.".to_string(),
                collect_feedback: false,
            },
            PermissionOptionPayload {
                decision: PermissionDecision::Deny,
                option_id: None,
                label: "Keep worktree".to_string(),
                description: "Leave the worktree in place.".to_string(),
                collect_feedback: true,
            },
        ],
    }
}

/// Drop an unanswered gate: clear the waiter, the persisted row, and the
/// prompt still on screen. Without the `gate.closed` the renderer would keep
/// offering buttons that answer nothing.
async fn withdraw(state: &AppState, session_id: i64, feature_id: i64, request_id: &str) {
    let _ = state.tool_approvals.take(session_id, request_id).await;
    WsSessionPersistence::mark_agent_resumed_static(
        &state.write_pool,
        &state.session_status_tx,
        session_id,
        feature_id,
        PendingUserInputKind::Permission,
        AgentStatus::Agent,
    )
    .await;
    state.pending_gates.complete(session_id, request_id).await;
    broadcast(
        state,
        feature_id,
        gate_closed_envelope(session_id, request_id),
    )
    .await;
}

fn gate_envelope(payload: &PermissionRequestPayload) -> WsEnvelope {
    permission_request_envelope(payload).expect("permission request payload should serialize")
}

fn gate_closed_envelope(session_id: i64, request_id: &str) -> WsEnvelope {
    WsEnvelope::session_event(
        WsSessionAction::GateClosed,
        GateClosedPayload {
            session_id: session_id.to_string(),
            request_id: Some(request_id.to_string()),
            reason: GateCloseReason::Escape,
        },
    )
    .expect("gate.closed payload should serialize")
}

async fn broadcast(state: &AppState, feature_id: i64, envelope: WsEnvelope) {
    let message = Message::Text(String::from(envelope).into());
    for sender in state.ws_feature_senders.get_senders(feature_id).await {
        let _ = sender.send(message.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::mcp::control::approval_registry::is_service_gate_payload;

    #[test]
    fn the_gate_is_marked_service_owned_and_advertises_only_allow_once_and_deny() {
        let payload = approval_payload("r1", "/tmp/wt", "feature/x");
        let value = serde_json::to_value(&payload).unwrap();

        assert!(is_service_gate_payload(&value));
        assert_eq!(payload.tool_name, super::super::TOOL_NAME);
        assert_eq!(payload.preview.as_deref(), Some("/tmp/wt"));
        assert_eq!(payload.options.len(), 2);
        assert!(matches!(
            payload.options[0].decision,
            PermissionDecision::AllowOnce
        ));
        assert!(matches!(
            payload.options[1].decision,
            PermissionDecision::Deny
        ));
        assert!(payload.options[1].collect_feedback);
    }

    #[tokio::test]
    async fn an_unresolvable_session_asks_the_human() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let state = AppState::with_pool(pool);

        // No `agent_sessions` table at all: the read fails, and failing closed
        // is the only safe answer for a deletion.
        assert_eq!(
            caller_access_mode(&state, 777).await,
            RuntimeAccessMode::Default
        );
    }
}
