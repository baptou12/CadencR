//! Dispatch-layer coverage for service-owned approval gates: `permission.respond`
//! and `gate.close` must resolve the parked waiter instead of falling through to
//! a provider runtime.

use super::support::*;
use crate::domain::mcp::control::approval_registry::{ApprovalOutcome, SERVICE_GATE_MARKER};

async fn seed_service_gate(app_state: &AppState, session_id: i64) {
    let payload = serde_json::json!({
        "request_id": "approval_1",
        "tool_name": "project_cleanup_worktree",
        "tool_input": { SERVICE_GATE_MARKER: true, "worktree_path": "/tmp/wt" },
        "options": [
            {"decision": "allow_once", "option_id": null, "label": "Remove", "description": "", "collect_feedback": false},
            {"decision": "deny", "option_id": null, "label": "Keep", "description": "", "collect_feedback": true}
        ]
    });
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, pending_permission)
         VALUES (?, 1, 'session', 'awaiting_user', ?)",
    )
    .bind(session_id)
    .bind(payload.to_string())
    .execute(&app_state.write_pool)
    .await
    .unwrap();
}

fn respond_envelope(session_id: i64, decision: &str) -> WsEnvelope {
    make_envelope(
        "session",
        "permission.respond",
        serde_json::json!({
            "session_id": session_id.to_string(),
            "request_id": "approval_1",
            "decision": decision
        }),
    )
}

/// The whole point of the interception: there is no active runtime handle here,
/// so without it the response would be pushed into the permission channel (or
/// error out) instead of reaching the waiting tool call.
#[tokio::test]
async fn permission_respond_resolves_a_service_gate_without_a_runtime() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    seed_service_gate(&app_state, 91).await;
    let waiter = app_state.tool_approvals.insert(91, "approval_1").await;

    dispatch_envelope(
        respond_envelope(91, "allow_once"),
        &tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    assert_eq!(waiter.await.unwrap(), ApprovalOutcome::Approved);
    let Message::Text(text) = rx.recv().await.unwrap() else {
        panic!("expected text message");
    };
    let envelope: WsEnvelope = serde_json::from_str(&text).unwrap();
    assert_eq!(envelope.action, "acknowledged");
    assert_eq!(envelope.payload["action"], "permission.respond");

    let pending: Option<String> =
        sqlx::query_scalar("SELECT pending_permission FROM agent_sessions WHERE id = 91")
            .fetch_one(&app_state.read_pool)
            .await
            .unwrap();
    assert!(pending.is_none());
}

#[tokio::test]
async fn a_denied_service_gate_forwards_the_users_feedback() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    seed_service_gate(&app_state, 92).await;
    let waiter = app_state.tool_approvals.insert(92, "approval_1").await;

    let mut envelope = respond_envelope(92, "deny");
    envelope.payload["feedback"] = serde_json::json!("keep it for now");
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    assert_eq!(
        waiter.await.unwrap(),
        ApprovalOutcome::Denied {
            feedback: Some("keep it for now".to_string())
        }
    );
}

#[tokio::test]
async fn closing_a_service_gate_denies_the_waiting_call() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    seed_service_gate(&app_state, 93).await;
    let waiter = app_state.tool_approvals.insert(93, "approval_1").await;

    dispatch_envelope(
        make_envelope(
            "session",
            "gate.close",
            serde_json::json!({
                "session_id": "93",
                "request_id": "approval_1",
                "reason": "escape"
            }),
        ),
        &tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    assert_eq!(
        waiter.await.unwrap(),
        ApprovalOutcome::Denied { feedback: None }
    );
    let Message::Text(text) = rx.recv().await.unwrap() else {
        panic!("expected text message");
    };
    let envelope: WsEnvelope = serde_json::from_str(&text).unwrap();
    assert_eq!(envelope.action, "gate.closed");
}

/// A runtime-owned gate must keep its existing behaviour: nothing is claimed
/// from the approval registry and the normal path still runs.
#[tokio::test]
async fn a_runtime_gate_is_not_treated_as_service_owned() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let payload = serde_json::json!({
        "request_id": "approval_1",
        "tool_name": "Bash",
        "tool_input": { "command": "pnpm test" },
        "options": []
    });
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, pending_permission)
         VALUES (94, 1, 'session', 'awaiting_user', ?)",
    )
    .bind(payload.to_string())
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    dispatch_envelope(
        respond_envelope(94, "allow_once"),
        &tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    let Message::Text(text) = rx.recv().await.unwrap() else {
        panic!("expected text message");
    };
    let envelope: WsEnvelope = serde_json::from_str(&text).unwrap();
    // No live runtime, so the normal path reports it rather than acknowledging.
    assert_ne!(envelope.action, "acknowledged");
}
