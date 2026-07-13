use super::super::helpers::send_error;
use super::super::session_prompt::{
    persist_and_publish_user_message, CanonicalUserMessageMode, CanonicalUserMessageRequest,
};
use super::super::types::WsSender;
use crate::app_state::AppState;
use crate::domain::feature_events::FeatureEventAction;
use crate::domain::sessions::user_messages::canonical_user_message_uuid;
use crate::domain::ws_session::question_answers::format_answers_plain_text;

pub(super) async fn persist_question_answer(
    app_state: &AppState,
    sender: &WsSender,
    envelope_id: &str,
    feature_id: i64,
    session_id: i64,
    updated_input: Option<&serde_json::Value>,
    message_uuid: Option<&str>,
) {
    let Some(answer_text) = updated_input.and_then(format_answers_plain_text) else {
        return;
    };
    let message_uuid = match canonical_user_message_uuid(message_uuid) {
        Ok(message_uuid) => message_uuid,
        Err(error) => {
            send_error(
                sender,
                envelope_id,
                "INVALID_MESSAGE_UUID",
                &error.to_string(),
            );
            return;
        }
    };
    let result = persist_and_publish_user_message(CanonicalUserMessageRequest {
        pool: &app_state.write_pool,
        feature_senders: &app_state.ws_feature_senders,
        owner: Some(sender),
        feature_id,
        session_id,
        content: &answer_text,
        message_uuid,
        origin: None,
        mode: CanonicalUserMessageMode::PersistOnly,
    })
    .await;
    match result {
        Ok(outcome) if outcome.message.inserted => {
            if let Err(error) = outcome.delivery {
                send_error(
                    sender,
                    envelope_id,
                    "USER_MESSAGE_DELIVERY_FAILED",
                    &error.to_string(),
                );
            }
            app_state
                .feature_events_tx
                .emit(feature_id, None, FeatureEventAction::Reordered);
        }
        Ok(outcome) => {
            if let Err(error) = outcome.delivery {
                send_error(
                    sender,
                    envelope_id,
                    "USER_MESSAGE_DELIVERY_FAILED",
                    &error.to_string(),
                );
            }
        }
        Err(error) => send_error(
            sender,
            envelope_id,
            "USER_MESSAGE_PERSIST_FAILED",
            &error.to_string(),
        ),
    }
}
