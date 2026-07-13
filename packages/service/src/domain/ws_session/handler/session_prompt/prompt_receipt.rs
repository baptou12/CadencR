use axum::extract::ws::Message;

use crate::domain::ws_session::protocol::{
    PromptReceiptState, PromptReceivedPayload, WsEnvelope, WsSessionAction,
};
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;

use super::super::WsSender;

pub(super) fn prompt_received_envelope(
    message_uuid: String,
    delivery_state: PromptReceiptState,
) -> WsEnvelope {
    WsEnvelope::session_event(
        WsSessionAction::PromptReceived,
        PromptReceivedPayload {
            message_uuid,
            delivery_state,
        },
    )
    .expect("prompt received payload should serialize")
}

/// Tell the client a tracked prompt could not reach the agent. Returns true
/// when the owner socket closed before the receipt could be delivered.
pub(super) async fn clear_pending_prompt_receipt(
    pool: &sqlx::SqlitePool,
    feature_senders: &WsFeatureSenderRegistry,
    sender: &WsSender,
    feature_id: i64,
    session_id: i64,
    message_uuid: String,
) -> bool {
    if let Err(error) = crate::domain::sessions::user_messages::update_delivery_state(
        pool,
        session_id,
        &message_uuid,
        "delivery_failed",
    )
    .await
    {
        tracing::error!(session_id, error = %error, "failed to persist prompt delivery failure");
    }
    let msg = Message::Text(
        String::from(prompt_received_envelope(
            message_uuid,
            PromptReceiptState::DeliveryFailed,
        ))
        .into(),
    );
    feature_senders
        .send_and_mirror(feature_id, sender, msg)
        .await
}

pub(super) async fn confirm_prompt_delivery(
    pool: &sqlx::SqlitePool,
    feature_senders: &WsFeatureSenderRegistry,
    sender: &WsSender,
    feature_id: i64,
    session_id: i64,
    message_uuid: &str,
) -> bool {
    if let Err(error) = crate::domain::sessions::user_messages::update_delivery_state(
        pool,
        session_id,
        message_uuid,
        "received_agent",
    )
    .await
    {
        tracing::error!(session_id, error = %error, "failed to persist prompt delivery success");
    }
    let msg = Message::Text(
        String::from(prompt_received_envelope(
            message_uuid.to_string(),
            PromptReceiptState::ReceivedAgent,
        ))
        .into(),
    );
    feature_senders
        .send_and_mirror(feature_id, sender, msg)
        .await
}
