//! Pending user-input restoration for `session.init`.

use axum::extract::ws::Message;
use serde_json::Value;
use tracing::info;

use super::super::super::persistence::WsSessionPersistence;
use super::super::super::protocol::{PermissionRequestPayload, WsEnvelope};
use super::super::WsSender;
use crate::app_state::AppState;
use crate::domain::session_status::{AgentStatus, PendingKind};

pub(super) async fn restore_pending_or_idle(
    app_state: &AppState,
    sender: &WsSender,
    db_session_id: i64,
    feature_id: i64,
) {
    if let Some(row) =
        WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await
    {
        if row.pending_plan_approval.is_some() {
            restore_plan_approval(app_state, sender, db_session_id, feature_id, &row).await;
            return;
        }
        if let Some(payload) = row
            .pending_permission
            .as_deref()
            .and_then(|value| serde_json::from_str::<PermissionRequestPayload>(value).ok())
        {
            send_pending(
                app_state,
                sender,
                db_session_id,
                feature_id,
                payload,
                PendingKind::Permission,
            );
            return;
        }
        if let Some(payload) = row
            .pending_questions
            .as_deref()
            .and_then(pending_question_payload)
        {
            send_pending(
                app_state,
                sender,
                db_session_id,
                feature_id,
                payload,
                PendingKind::Question,
            );
            return;
        }
    }
    clear_stale_pending(app_state, db_session_id, feature_id).await;
}

async fn restore_plan_approval(
    app_state: &AppState,
    sender: &WsSender,
    db_session_id: i64,
    feature_id: i64,
    row: &crate::domain::ws_session::persistence::SessionRow,
) {
    info!(
        db_session_id,
        feature_id, "restoring pending plan approval from DB"
    );
    let plan_input: Value = row
        .pending_plan_approval
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));
    let payload = PermissionRequestPayload {
        request_id: format!("plan_restore_{db_session_id}"),
        tool_name: "ExitPlanMode".to_string(),
        tool_input: plan_input,
        description: Some("Plan is ready for approval".to_string()),
        pattern: None,
        preview: None,
        options: Vec::new(),
    };
    send_pending(
        app_state,
        sender,
        db_session_id,
        feature_id,
        payload,
        PendingKind::PlanApproval,
    );
}

fn send_pending(
    app_state: &AppState,
    sender: &WsSender,
    db_session_id: i64,
    feature_id: i64,
    payload: PermissionRequestPayload,
    kind: PendingKind,
) {
    let envelope = WsEnvelope::new(
        "session",
        "permission.request",
        serde_json::to_value(payload).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
    WsSessionPersistence::broadcast_session_status(
        &app_state.session_status_tx,
        db_session_id,
        feature_id,
        AgentStatus::Question,
        Some(kind),
    );
}

async fn clear_stale_pending(app_state: &AppState, db_session_id: i64, feature_id: i64) {
    WsSessionPersistence::clear_all_pending_user_input_static(&app_state.write_pool, db_session_id)
        .await;
    WsSessionPersistence::broadcast_session_status(
        &app_state.session_status_tx,
        db_session_id,
        feature_id,
        AgentStatus::Idle,
        None,
    );
}

pub(super) fn pending_question_payload(value: &str) -> Option<PermissionRequestPayload> {
    if let Ok(payload) = serde_json::from_str::<PermissionRequestPayload>(value) {
        return Some(payload);
    }
    let raw = serde_json::from_str::<Value>(value).ok()?;
    Some(PermissionRequestPayload {
        request_id: raw.get("request_id").and_then(Value::as_str)?.to_string(),
        tool_name: raw
            .get("tool_name")
            .and_then(Value::as_str)
            .unwrap_or("AskUserQuestion")
            .to_string(),
        tool_input: raw.get("tool_input").cloned().unwrap_or(Value::Null),
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        pattern: raw
            .get("pattern")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        preview: raw
            .get("preview")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        options: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::pending_question_payload;
    use serde_json::json;

    #[test]
    fn pending_question_payload_accepts_reduced_shape() {
        let stored = json!({
            "tool_name": "AskUserQuestion",
            "tool_input": { "question": "Proceed?" },
            "request_id": "req_1",
            "pattern": null
        })
        .to_string();

        let payload = pending_question_payload(&stored).expect("payload");
        assert_eq!(payload.request_id, "req_1");
        assert_eq!(payload.tool_name, "AskUserQuestion");
        assert_eq!(payload.tool_input["question"], "Proceed?");
    }

    #[test]
    fn pending_question_payload_accepts_legacy_full_shape() {
        let stored = json!({
            "request_id": "req_2",
            "tool_name": "AskUserQuestion",
            "tool_input": { "question": "Continue?" },
            "description": "Codex question",
            "pattern": null,
            "preview": null,
            "options": []
        })
        .to_string();

        let payload = pending_question_payload(&stored).expect("payload");
        assert_eq!(payload.request_id, "req_2");
        assert_eq!(payload.description.as_deref(), Some("Codex question"));
    }
}
