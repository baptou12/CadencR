//! Permission-response helpers for `OpenCodeAcpSession`.

use crate::domain::agents::adapter::{
    RuntimeError, RuntimePermissionDecision, RuntimePermissionResponse,
};
use crate::domain::agents::opencode::acp::permissions::{
    acp_permission_cancel_payload, acp_permission_response_payload,
};
use crate::domain::agents::opencode::acp::session::OpenCodeAcpSession;
use crate::domain::agents::opencode::questions::extract_question_answers;

pub(super) async fn respond_permission(
    session: &OpenCodeAcpSession,
    response: RuntimePermissionResponse,
) -> Result<(), RuntimeError> {
    let mut pending = session.pending_permissions.write().await;
    let Some(server_id) = pending.remove(&response.request_id) else {
        drop(pending);
        return respond_question_via_sidecar(session, response).await;
    };
    drop(pending);
    let payload = acp_permission_response_payload(
        response.decision,
        response.option_id.as_deref(),
        response.feedback.as_deref(),
    );
    session
        .client
        .respond_server_request(server_id, payload)
        .await
        .map_err(|e| RuntimeError::new(format!("respond_permission write failed: {e}")))?;
    Ok(())
}

pub(super) async fn reject_all_pending_permissions(session: &OpenCodeAcpSession) {
    let pending = {
        let mut pending = session.pending_permissions.write().await;
        pending.drain().map(|(_, id)| id).collect::<Vec<_>>()
    };
    for server_id in pending {
        if let Err(error) = session
            .client
            .reject_server_request(server_id, -32800, "session closed")
            .await
        {
            tracing::error!(%error, "failed to reject pending ACP permission on close");
        }
    }
}

pub(super) async fn cancel_pending_permission(
    session: &OpenCodeAcpSession,
    request_id: &str,
) -> Result<(), RuntimeError> {
    let mut pending = session.pending_permissions.write().await;
    let Some(server_id) = pending.remove(request_id) else {
        return Ok(());
    };
    drop(pending);
    session
        .client
        .respond_server_request(server_id, acp_permission_cancel_payload())
        .await
        .map_err(|e| RuntimeError::new(format!("cancel permission write failed: {e}")))
}

async fn respond_question_via_sidecar(
    session: &OpenCodeAcpSession,
    response: RuntimePermissionResponse,
) -> Result<(), RuntimeError> {
    if response.updated_input.is_none() && response.feedback.is_none() {
        return Err(RuntimeError::new(format!(
            "no pending ACP permission for request_id {}",
            response.request_id
        )));
    }
    if matches!(response.decision, RuntimePermissionDecision::Deny) {
        return session
            .question_sidecar
            .reject_tool_call(&response.request_id)
            .await;
    }
    let answers = extract_question_answers(
        response.updated_input.as_ref(),
        response.feedback.as_deref(),
    );
    if answers.iter().all(Vec::is_empty) {
        return Err(RuntimeError::new(format!(
            "no pending ACP permission for request_id {}",
            response.request_id
        )));
    }
    session
        .question_sidecar
        .reply_tool_call(&response.request_id, answers)
        .await
}
