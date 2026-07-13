use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

#[path = "send_message_persistence.rs"]
mod persistence;
#[path = "send_message_audit.rs"]
mod send_audit;

use self::persistence::{
    claim_immediate_dispatch, insert_message_link, mark_immediate_dispatch_failed,
    mark_immediate_dispatch_succeeded, persist_immediate_message, ImmediateDispatchClaim,
    ImmediateMessageRequest,
};
use self::send_audit::{audit_send_message, audit_send_message_error};
use super::message_queue::enqueue_message;
use super::scope::resolve_session_scope;
use crate::app_state::AppState;
use crate::domain::feature_events::FeatureEventAction;
use crate::domain::sessions::models::AgentMessageOrigin;
use crate::domain::sessions::user_messages::PersistedUserMessage;
use crate::domain::ws_session::handler::session_prompt::dispatch_control_prompt_with_message_uuid;
use crate::domain::ws_session::handler::session_prompt::publish_user_message;
use crate::error::AppError;

const MAX_SEND_MESSAGES_PER_SOURCE_PER_HOUR: i64 = 20;

#[derive(Debug, Deserialize)]
pub(super) struct SendMessageRequest {
    source_feature_id: i64,
    source_session_id: i64,
    target_session_id: i64,
    message: String,
    message_uuid: Option<String>,
    delivery: Option<String>,
    reply: Option<String>,
    source_note: Option<String>,
    link_to_current_session: Option<bool>,
}

#[derive(Debug, Serialize)]
pub(super) struct SendMessageResponse {
    #[serde(rename = "messageId", skip_serializing_if = "Option::is_none")]
    message_id: Option<i64>,
    #[serde(rename = "queueId", skip_serializing_if = "Option::is_none")]
    queue_id: Option<i64>,
    #[serde(rename = "targetSessionId")]
    target_session_id: i64,
}

pub(super) async fn send_message_handler(
    State(state): State<AppState>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<SendMessageResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let message = validated_message(&body.message)?;
    let message_uuid = canonical_request_uuid(body.message_uuid.as_deref())?;

    let source = resolve_session_scope(&state.write_pool, body.source_session_id).await?;
    let target = resolve_session_scope(&state.write_pool, body.target_session_id).await?;
    if source.feature_id != body.source_feature_id {
        return Err(AppError::BadRequest(
            "source_session_id does not belong to source_feature_id".to_string(),
        ));
    }
    if source.project_id != target.project_id {
        return Err(AppError::BadRequest(
            "target session does not belong to current project".to_string(),
        ));
    }
    if let Err(error) = ensure_send_budget(&state, &source).await {
        let message = error.to_string();
        audit_send_message_error(&state, &source, &target, &message, started_at).await?;
        return Err(error);
    }

    let delivery = match delivery_mode(body.delivery.as_deref()) {
        Ok(mode) => mode,
        Err(message) => {
            audit_send_message_error(&state, &source, &target, &message, started_at).await?;
            return Err(AppError::BadRequest(message));
        }
    };
    let reply = reply_mode(body.reply.as_deref())?;
    if requires_user_resolution(&target.status) {
        let message = format!(
            "target session is awaiting user resolution: {}",
            target.status
        );
        audit_send_message_error(&state, &source, &target, &message, started_at).await?;
        return Err(AppError::BadRequest(message));
    }
    if target.status == "running" && delivery == DeliveryMode::RejectIfBusy {
        let message = "target session is busy".to_string();
        audit_send_message_error(&state, &source, &target, &message, started_at).await?;
        return Err(AppError::BadRequest(message));
    }
    if target.status == "running" && delivery == DeliveryMode::QueueIfBusy {
        return queue_busy_message(QueueBusyRequest {
            state: &state,
            source: &source,
            target: &target,
            body: &body,
            message,
            message_uuid,
            reply,
            started_at,
        })
        .await;
    }

    let (persisted_message, origin) = persist_immediate_message(ImmediateMessageRequest {
        state: &state,
        source: &source,
        target: &target,
        message,
        message_uuid,
        source_note: body.source_note.as_deref(),
        link_to_current_session: body.link_to_current_session.unwrap_or(true),
        await_reply: reply == ReplyMode::OnTurnEnd,
    })
    .await?;

    publish_generated_user_message(&state, target.feature_id, &persisted_message, origin).await?;
    if persisted_message.inserted {
        state
            .feature_events_tx
            .emit(target.feature_id, None, FeatureEventAction::Reordered);
    }
    dispatch_immediate_message_once(
        &state,
        &target,
        message,
        message_uuid,
        persisted_message.id,
        reply,
    )
    .await?;
    let response = SendMessageResponse {
        message_id: Some(persisted_message.id),
        queue_id: None,
        target_session_id: target.session_id,
    };
    audit_send_message(&state, &source, &target, &response, started_at).await?;
    Ok(Json(response))
}

struct QueueBusyRequest<'a> {
    state: &'a AppState,
    source: &'a super::scope::SessionScope,
    target: &'a super::scope::SessionScope,
    body: &'a SendMessageRequest,
    message: &'a str,
    message_uuid: uuid::Uuid,
    reply: ReplyMode,
    started_at: std::time::Instant,
}

async fn queue_busy_message(
    request: QueueBusyRequest<'_>,
) -> Result<Json<SendMessageResponse>, AppError> {
    if request.reply == ReplyMode::OnTurnEnd {
        return Err(AppError::BadRequest(
            "reply=on_turn_end is not yet supported with delivery=queue_if_busy".to_string(),
        ));
    }
    let queued = enqueue_message(
        &request.state.write_pool,
        request.target.session_id,
        Some(request.source.session_id),
        request.message,
        request.message_uuid,
    )
    .await?;
    if queued.inserted && request.body.link_to_current_session.unwrap_or(true) {
        insert_message_link(
            request.state,
            request.source.session_id,
            request.target.session_id,
            request.body.source_note.as_deref(),
        )
        .await?;
    }
    let response = SendMessageResponse {
        message_id: None,
        queue_id: Some(queued.id),
        target_session_id: request.target.session_id,
    };
    audit_send_message(
        request.state,
        request.source,
        request.target,
        &response,
        request.started_at,
    )
    .await?;
    Ok(Json(response))
}

fn validated_message(message: &str) -> Result<&str, AppError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::BadRequest(
            "message must not be blank".to_string(),
        ));
    }
    Ok(message)
}

fn canonical_request_uuid(value: Option<&str>) -> Result<uuid::Uuid, AppError> {
    match value {
        Some(value) => uuid::Uuid::parse_str(value)
            .map_err(|_| AppError::BadRequest("message_uuid must be a valid UUID".to_string())),
        None => Ok(uuid::Uuid::new_v4()),
    }
}

async fn dispatch_immediate_message(
    state: &AppState,
    target: &super::scope::SessionScope,
    message: &str,
    message_uuid: uuid::Uuid,
    message_id: i64,
    reply: ReplyMode,
) -> Result<(), AppError> {
    if reply == ReplyMode::OnTurnEnd {
        super::reply_wait::arm(&state.write_pool, target.session_id, message_id).await?;
    }
    if let Err(error) = dispatch_control_prompt_with_message_uuid(
        state,
        target.feature_id,
        target.session_id,
        message,
        true,
        Some(message_uuid),
    )
    .await
    {
        if reply == ReplyMode::OnTurnEnd {
            super::reply_wait::deliver_failed(state, target.session_id, &error.to_string()).await?;
        }
        return Err(error);
    }
    Ok(())
}

async fn dispatch_immediate_message_once(
    state: &AppState,
    target: &super::scope::SessionScope,
    message: &str,
    message_uuid: uuid::Uuid,
    message_id: i64,
    reply: ReplyMode,
) -> Result<(), AppError> {
    let claim = claim_immediate_dispatch(&state.write_pool, message_id).await?;
    let ImmediateDispatchClaim::Claimed { token } = claim else {
        return Ok(());
    };
    if let Err(dispatch_error) =
        dispatch_immediate_message(state, target, message, message_uuid, message_id, reply).await
    {
        let dispatch_message = dispatch_error.to_string();
        if let Err(status_error) =
            mark_immediate_dispatch_failed(&state.write_pool, message_id, &token, &dispatch_message)
                .await
        {
            return Err(AppError::Internal(format!(
                "message dispatch failed ({dispatch_message}) and its retry state could not be persisted ({status_error})"
            )));
        }
        return Err(dispatch_error);
    }
    mark_immediate_dispatch_succeeded(&state.write_pool, message_id, &token).await
}

pub(super) async fn publish_generated_user_message(
    state: &AppState,
    target_feature_id: i64,
    message: &PersistedUserMessage,
    origin: AgentMessageOrigin,
) -> Result<(), AppError> {
    publish_user_message(
        &state.ws_feature_senders,
        None,
        target_feature_id,
        message,
        Some(origin),
        false,
    )
    .await
    .map_err(|error| AppError::Internal(error.to_string()))
}

async fn ensure_send_budget(
    state: &AppState,
    source: &super::scope::SessionScope,
) -> Result<(), AppError> {
    let recent_send_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mcp_tool_audit_log
         WHERE tool_name = 'project_send_session_message'
           AND source_session_id = ?
           AND status = 'ok'
           AND created_at >= datetime('now', '-1 hour')",
    )
    .bind(source.session_id)
    .fetch_one(&state.write_pool)
    .await?;
    if recent_send_count >= MAX_SEND_MESSAGES_PER_SOURCE_PER_HOUR {
        return Err(AppError::BadRequest(format!(
            "project_send_session_message hourly limit exceeded for source session {}",
            source.session_id
        )));
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DeliveryMode {
    SendNow,
    QueueIfBusy,
    RejectIfBusy,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplyMode {
    None,
    OnTurnEnd,
}

fn reply_mode(value: Option<&str>) -> Result<ReplyMode, AppError> {
    match value.unwrap_or("none") {
        "none" => Ok(ReplyMode::None),
        "on_turn_end" => Ok(ReplyMode::OnTurnEnd),
        other => Err(AppError::BadRequest(format!(
            "unsupported reply mode '{other}'"
        ))),
    }
}

fn delivery_mode(value: Option<&str>) -> Result<DeliveryMode, String> {
    match value.unwrap_or("send_now") {
        "send_now" => Ok(DeliveryMode::SendNow),
        "queue_if_busy" => Ok(DeliveryMode::QueueIfBusy),
        "reject_if_busy" => Ok(DeliveryMode::RejectIfBusy),
        other => Err(format!("unsupported delivery mode '{other}'")),
    }
}

pub(super) fn requires_user_resolution(status: &str) -> bool {
    matches!(
        status,
        "awaiting_permission"
            | "awaiting_question"
            | "waiting_for_permission"
            | "waiting_for_question"
    )
}
