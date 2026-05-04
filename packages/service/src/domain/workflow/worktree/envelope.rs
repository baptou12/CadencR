//! Tiny WS-envelope helper used by every worktree-flow step.

use axum::extract::ws::Message;

use crate::domain::workflow::engine::WsSender;
use crate::domain::ws_session::protocol::WsEnvelope;

pub(super) fn send_envelope(
    ws_sender: &WsSender,
    domain: &str,
    action: &str,
    payload: serde_json::Value,
) {
    let envelope = WsEnvelope::new(domain, action, payload);
    let _ = ws_sender.send(Message::Text(String::from(envelope).into()));
}
