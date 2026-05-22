use axum::extract::ws::Message;
use tracing::info;

use super::session_prompt::PermissionResponse;
use super::{parse_session_id, send_error, QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionResponse, RuntimeSessionHandle,
};
use crate::domain::session_status::AgentStatus;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{
    GateClosePayload, GateCloseReason, PermissionDecision, WsEnvelope,
};

struct ActiveGateRuntime {
    query: RuntimeSessionHandle,
    permission_tx: tokio::sync::mpsc::Sender<PermissionResponse>,
}

pub(super) async fn handle_gate_close(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: GateClosePayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(error) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &error.to_string());
            return;
        }
    };
    let Some(db_session_id) = parse_session_id(&payload.session_id) else {
        send_error(
            sender,
            &envelope.id,
            "INVALID_SESSION_ID",
            "Invalid session_id",
        );
        return;
    };

    let clear_result = clear_persisted_gate_and_notify(
        sender,
        app_state,
        db_session_id,
        payload.request_id.as_deref(),
        payload.reason,
        Some(&envelope.id),
    )
    .await;
    match clear_result {
        Ok(true) => {
            deny_runtime_gate(sdk_sessions, db_session_id, payload.request_id.as_deref()).await;
        }
        Ok(false) => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
        }
        Err(error) => {
            send_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                &format!("Failed to close gate: {error}"),
            );
        }
    }
}

pub(super) async fn clear_persisted_gate_and_notify(
    sender: &WsSender,
    app_state: &AppState,
    db_session_id: i64,
    request_id: Option<&str>,
    reason: GateCloseReason,
    ref_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let Some(row) =
        WsSessionPersistence::try_get_session_row(&app_state.write_pool, db_session_id).await?
    else {
        return Ok(false);
    };
    if !row.has_pending_user_input() {
        // Idempotent ack: the DB row has no pending gate, but the renderer
        // may still be holding stale gate state (e.g. it raced an earlier
        // answer or the row was cleared on another path). Send the
        // `gate.closed` envelope anyway so the FE drops its prompt UI
        // instead of staying stuck on a gate the backend will not honor.
        send_gate_closed(sender, db_session_id, request_id, reason, ref_id);
        return Ok(true);
    }

    WsSessionPersistence::clear_all_pending_user_input_static(&app_state.write_pool, db_session_id)
        .await;
    WsSessionPersistence::broadcast_session_status(
        &app_state.session_status_tx,
        db_session_id,
        row.feature_id,
        AgentStatus::Idle,
        None,
    );
    send_gate_closed(sender, db_session_id, request_id, reason, ref_id);
    Ok(true)
}

fn send_gate_closed(
    sender: &WsSender,
    db_session_id: i64,
    request_id: Option<&str>,
    reason: GateCloseReason,
    ref_id: Option<&str>,
) {
    let payload = serde_json::json!({
        "session_id": db_session_id.to_string(),
        "request_id": request_id,
        "reason": gate_close_reason_wire(reason),
    });
    let envelope = match ref_id {
        Some(id) => WsEnvelope::reply(id, "session", "gate.closed", payload),
        None => WsEnvelope::new("session", "gate.closed", payload),
    };
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

fn gate_close_reason_wire(reason: GateCloseReason) -> &'static str {
    match reason {
        GateCloseReason::Sleep => "sleep",
        GateCloseReason::Escape => "escape",
    }
}

async fn deny_runtime_gate(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
    request_id: Option<&str>,
) {
    let Some(target) = active_runtime(sdk_sessions, db_session_id).await else {
        return;
    };
    let q = target.query.read().await;
    if let Some(request_id) = request_id {
        let runtime_response = RuntimePermissionResponse {
            request_id: request_id.to_string(),
            decision: RuntimePermissionDecision::Deny,
            option_id: None,
            feedback: None,
            updated_input: None,
        };
        let respond_result = q.respond_permission(runtime_response).await;
        if respond_result.is_err() {
            let response = PermissionResponse {
                request_id: request_id.to_string(),
                decision: PermissionDecision::Deny,
                option_id: None,
                feedback: None,
                updated_input: None,
                is_approval_gate: false,
            };
            if let Err(error) = target.permission_tx.try_send(response) {
                info!(db_session_id, %error, "gate close: permission channel unavailable");
            }
        }
    }

    let interrupt_result = q.interrupt().await;
    if let Err(error) = interrupt_result {
        info!(db_session_id, %error, "gate close: interrupt failed (treating as best-effort)");
    }
}

async fn active_runtime(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
) -> Option<ActiveGateRuntime> {
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_session_id)?;
    match &handle.state {
        QueryState::Active {
            query,
            permission_tx,
        } => Some(ActiveGateRuntime {
            query: std::sync::Arc::clone(query),
            permission_tx: permission_tx.clone(),
        }),
        QueryState::Pending(_) => None,
    }
}
