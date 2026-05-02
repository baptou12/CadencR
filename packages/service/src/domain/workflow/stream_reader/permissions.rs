use axum::extract::ws::Message;
use sqlx::SqlitePool;

use crate::domain::agents::adapter::RuntimePermissionRequest;
use crate::domain::runtime_stream::workflow_permission_request_payload;
use crate::domain::session_status::SessionStatusBroadcaster;
use crate::domain::workflow::engine::{to_value, AgentSlot, WsSender};
use crate::domain::workflow::permission_router::{emit_plan_approval_gate_events, ApprovalKind};
use crate::domain::ws_session::persistence::{PendingUserInput, WsSessionPersistence};
use crate::domain::ws_session::protocol::{PermissionRequestPayload, WsEnvelope};

pub(super) async fn handle_adapter_permission_request(
    request: RuntimePermissionRequest,
    feature_id: i64,
    slot: &AgentSlot,
    db_session_id: i64,
    sender: &WsSender,
    write_pool: &SqlitePool,
    session_status_tx: &SessionStatusBroadcaster,
) {
    if let Some(kind) = ApprovalKind::from_tool_name(&request.tool_name) {
        let tool_use_id = request
            .tool_use_id
            .clone()
            .unwrap_or_else(|| request.request_id.clone());
        emit_plan_approval_gate_events(
            feature_id,
            slot,
            db_session_id,
            &tool_use_id,
            Some(&request.request_id),
            &request.tool_input,
            kind,
            sender,
            write_pool,
        )
        .await;
        // Plan/PRD approval gates are persisted in `pending_plan_approval`
        // / `pending_prd_approval` by `emit_plan_approval_gate_events`
        // above, so we just broadcast the matching Question status. The
        // kind here mirrors the approval kind so the sidebar shows the
        // right reason without round-tripping through a snapshot.
        let pending_kind = match kind {
            ApprovalKind::Plan => crate::domain::session_status::PendingKind::PlanApproval,
            ApprovalKind::Prd => crate::domain::session_status::PendingKind::PrdApproval,
        };
        WsSessionPersistence::broadcast_session_status(
            session_status_tx,
            db_session_id,
            feature_id,
            crate::domain::session_status::AgentStatus::Question,
            Some(pending_kind),
        );
        return;
    }

    let permission_payload = workflow_permission_request_payload(feature_id, slot.clone(), request);
    persist_pending_request(
        &permission_payload,
        write_pool,
        session_status_tx,
        db_session_id,
        feature_id,
    )
    .await;
    let envelope = WsEnvelope::new(
        "workflow",
        "permission.request",
        to_value(permission_payload),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

async fn persist_pending_request(
    permission_payload: &crate::domain::ws_session::protocol::WorkflowPermissionRequestPayload,
    write_pool: &SqlitePool,
    session_status_tx: &SessionStatusBroadcaster,
    db_session_id: i64,
    feature_id: i64,
) {
    if permission_payload.tool_name == "AskUserQuestion" {
        let value = serde_json::json!({
            "tool_name": permission_payload.tool_name,
            "tool_input": permission_payload.tool_input,
            "request_id": permission_payload.request_id,
            "pattern": permission_payload.pattern,
        });
        WsSessionPersistence::mark_awaiting_user_static(
            write_pool,
            session_status_tx,
            db_session_id,
            feature_id,
            &PendingUserInput::Question(&value),
        )
        .await;
        return;
    }

    let session_payload = PermissionRequestPayload {
        request_id: permission_payload.request_id.clone(),
        tool_name: permission_payload.tool_name.clone(),
        tool_input: permission_payload.tool_input.clone(),
        description: permission_payload.description.clone(),
        pattern: permission_payload.pattern.clone(),
        preview: permission_payload.preview.clone(),
        options: permission_payload.options.clone(),
    };
    WsSessionPersistence::mark_awaiting_user_static(
        write_pool,
        session_status_tx,
        db_session_id,
        feature_id,
        &PendingUserInput::Permission(&session_payload),
    )
    .await;
}
