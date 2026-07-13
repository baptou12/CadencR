use tracing::{error, info};

use crate::domain::agents::adapter::RuntimeSessionHandle;
use crate::domain::feature_events::{FeatureEventAction, FeatureEventBroadcaster};
use crate::domain::ws_session::protocol::PromptSendPayload;
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;

use std::sync::Arc;

use super::super::{ActiveTurnRegistry, SdkSessions, WsSender};
use super::content::{
    build_content_value_for_provider, build_persist_content, payload_attachments,
};
use super::errors::persist_pause_and_send_session_error;
use super::prompt_receipt::clear_pending_prompt_receipt;
use super::prompt_status::{
    mark_agent_running, persist_and_publish_prompt, PromptPersistenceOutcome,
};

pub(super) struct FollowupPromptContext {
    pub query: RuntimeSessionHandle,
    pub feature_id: i64,
    pub db_session_id: i64,
    pub write_pool: sqlx::SqlitePool,
    pub session_status_tx: crate::domain::session_status::SessionStatusBroadcaster,
    pub sender: WsSender,
    pub ws_feature_senders: WsFeatureSenderRegistry,
    pub feature_events_tx: FeatureEventBroadcaster,
    pub envelope_id: String,
    /// The owning connection's session map + the global registry, so a
    /// follow-up turn re-stamps the start time and owner (single source of
    /// truth for the synced timer + cross-device answers).
    pub sdk_sessions: SdkSessions,
    pub active_turns: Arc<ActiveTurnRegistry>,
    pub provider_id: String,
}

pub(super) async fn handle_followup_prompt(
    context: FollowupPromptContext,
    payload: PromptSendPayload,
) -> Result<(), String> {
    let persistence = persist_followup_user_message(&context, &payload).await?;
    if !persistence.should_dispatch() {
        return Ok(());
    }
    mark_agent_running(
        &context.write_pool,
        &context.session_status_tx,
        &context.active_turns,
        &context.sdk_sessions,
        context.db_session_id,
        context.feature_id,
    )
    .await;

    // Snapshot the worktree *before* this turn's prompt is delivered to the live
    // agent (the `stream_input` below), so a later rewind to this message can
    // restore the pre-turn code state. A deliberate pre-turn barrier.
    super::prompt_checkpoint::capture_pre_turn_followup(&context, persistence.message_id()).await;

    info!(context.db_session_id, "follow-up prompt");
    tokio::spawn(stream_followup_prompt(context, payload));
    Ok(())
}

async fn persist_followup_user_message(
    context: &FollowupPromptContext,
    payload: &PromptSendPayload,
) -> Result<PromptPersistenceOutcome, String> {
    let attachments = payload_attachments(payload);
    let persist_content = build_persist_content(&payload.text, &attachments);
    let outcome = persist_and_publish_prompt(
        &context.write_pool,
        &context.ws_feature_senders,
        &context.sender,
        context.feature_id,
        context.db_session_id,
        payload,
        &persist_content,
    )
    .await?;
    // The user message changed this feature's most-recent-user-message sort
    // key. Broadcast so every client's sidebar re-sorts conversations and
    // floats this one to the top of its project.
    if outcome.inserted() {
        context
            .feature_events_tx
            .emit(context.feature_id, None, FeatureEventAction::Reordered);
    }
    Ok(outcome)
}

async fn stream_followup_prompt(context: FollowupPromptContext, payload: PromptSendPayload) {
    let attachments = payload_attachments(&payload);
    // Expand a virtual `/cadencr:*` skill invoked mid-conversation, same as the
    // initial-prompt path. The persisted user message keeps the short token.
    let prompt_text = crate::domain::agents::orchestration_skills::expand_prompt(&payload.text);
    let content =
        build_content_value_for_provider(&context.provider_id, &prompt_text, &attachments);
    let receipt_message_uuid = payload
        .track_prompt_receipt
        .then(|| payload.message_uuid.clone())
        .flatten();
    let query_guard = context.query.read().await;
    let stream_result = query_guard
        .stream_input_with_client_message_id(content, receipt_message_uuid.clone())
        .await;
    drop(query_guard);

    if let Err(error) = stream_result {
        let message = error.to_string();
        error!(context.db_session_id, error = %message, "stream_input failed");
        if let Some(message_uuid) = receipt_message_uuid {
            let owner_closed = clear_pending_prompt_receipt(
                &context.ws_feature_senders,
                &context.sender,
                context.feature_id,
                message_uuid,
            )
            .await;
            if owner_closed {
                error!(
                    context.db_session_id,
                    "prompt delivery-failed receipt owner disconnected"
                );
            }
        }
        persist_pause_and_send_session_error(
            &context.write_pool,
            &context.session_status_tx,
            &context.sender,
            &context.envelope_id,
            context.feature_id,
            context.db_session_id,
            "SDK_ERROR",
            &message,
        )
        .await;
    }
}
