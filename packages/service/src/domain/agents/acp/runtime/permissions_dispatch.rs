//! Runtime-side helpers around the pending-permissions map: dispatching
//! incoming `session/request_permission` events upstream and draining the
//! map at session close.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, RwLock};

use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimePermissionDecision,
    RuntimePermissionOption, RuntimePermissionRequest,
};

use super::session_permissions::PermissionKey;

/// One pending `session/request_permission` server request awaiting the
/// user's decision. Tracks the raw ACP server-request id (so we can echo
/// the response back) and the canonical `(tool_name, input)` key the
/// session-permissions cache uses to remember the decision.
#[derive(Debug, Clone)]
pub struct PendingPermission {
    pub server_id: Value,
    pub key: PermissionKey,
}

/// Map keyed by Cadencr `request_id` (the ACP server-request id, stringified).
pub type PendingPermissions = Arc<RwLock<HashMap<String, PendingPermission>>>;

/// Surface a `session/request_permission` payload to the runtime channel as
/// a permission event the WS bridge can pick up via
/// `parse_permission_request` on the raw envelope.
pub fn permission_raw_event(request: &RuntimePermissionRequest, params: &Value) -> Value {
    json!({
        "type": "acp_permission_request",
        "transport": "acp",
        "request_id": request.request_id,
        "call_id": request.tool_use_id,
        "tool_name": request.tool_name,
        "tool_input": request.tool_input,
        "description": request.description,
        "preview": request.preview,
        "options": request.options.iter().map(permission_option_json).collect::<Vec<_>>(),
        "acp": params.clone(),
    })
}

pub fn permission_option_json(option: &RuntimePermissionOption) -> Value {
    // The wire string the FE consumes today is one of three values:
    // `allow_once`, `allow_future`, `deny`. `AllowForSession` is a
    // backend-only refinement of `AllowFuture` (different `optionId`
    // routing on the way back to ACP) so it shares the same wire
    // discriminant. Distinct labels & descriptions still let the FE
    // render two separate buttons when an agent advertises both kinds.
    let decision = match option.decision {
        RuntimePermissionDecision::AllowOnce => "allow_once",
        RuntimePermissionDecision::AllowFuture | RuntimePermissionDecision::AllowForSession => {
            "allow_future"
        }
        RuntimePermissionDecision::Deny => "deny",
    };
    json!({
        "decision": decision,
        "option_id": option.option_id,
        "label": option.label,
        "description": option.description,
        "collect_feedback": option.collect_feedback,
    })
}

/// Send a permission event upstream and stash the ACP server-request id in
/// the pending map so `respond_permission()` can answer later.
pub async fn dispatch_permission_request(
    pending: &PendingPermissions,
    session_id: Option<String>,
    request_id: &str,
    raw_id: Value,
    request: RuntimePermissionRequest,
    params: &Value,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) {
    let key = PermissionKey::new(&request.tool_name, &request.tool_input);
    pending.write().await.insert(
        request_id.to_string(),
        PendingPermission {
            server_id: raw_id,
            key,
        },
    );
    let raw = permission_raw_event(&request, params);
    let metadata = RuntimeEventMetadata {
        session_id,
        usage: None,
        context_window: None,
        raw,
    };
    let event = RuntimeEvent::new(metadata, RuntimeEventKind::Other);
    let _ = tx.send(Ok(event)).await;
}

/// Reject all pending permissions on session close — used to drain unanswered
/// requests so the agent receives explicit cancellation rather than a hang.
pub async fn reject_all_pending(client: &AcpClient, pending: &PendingPermissions) {
    let drained = {
        let mut pending = pending.write().await;
        pending
            .drain()
            .map(|(_, pending)| pending.server_id)
            .collect::<Vec<_>>()
    };
    for server_id in drained {
        if let Err(error) = client
            .reject_server_request(server_id, -32800, "session closed")
            .await
        {
            tracing::error!(%error, "failed to reject pending ACP permission on close");
        }
    }
}

/// Look up and remove a pending permission entry. Returns the raw ACP
/// server-request id and the canonical permission key so callers can both
/// route the response through the `AcpClient` and record the decision in
/// the session-permissions cache.
pub async fn take_pending(
    pending: &PendingPermissions,
    request_id: &str,
) -> Option<PendingPermission> {
    pending.write().await.remove(request_id)
}
