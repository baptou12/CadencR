use axum::extract::ws::Message;
use sqlx::SqlitePool;

use crate::domain::workflow::engine::{to_value, AgentSlot, WsSender};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{WorkflowAgentStreamErrorPayload, WsEnvelope};

pub async fn persist_and_send_agent_error(
    write_pool: &SqlitePool,
    sender: &WsSender,
    slot: &AgentSlot,
    session_id: i64,
    error: &str,
) {
    WsSessionPersistence::persist_error_message_static(write_pool, session_id, error, None).await;
    send_agent_error(sender, slot, session_id, error);
}

pub fn send_agent_error(sender: &WsSender, slot: &AgentSlot, session_id: i64, error: &str) {
    let envelope = WsEnvelope::new(
        "workflow",
        "agent_stream",
        to_value(WorkflowAgentStreamErrorPayload {
            agent_slot: slot.clone(),
            session_id,
            msg_type: "error".into(),
            error: error.to_string(),
        }),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}
