use axum::extract::{Json, Path, State};
use axum::routing::{get, patch, post};
use axum::Router;
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::error::AppError;

use super::delivery;
use super::store::{self, QueuedPrompt};

/// Longest prompt the queue accepts (same order as a pasted file).
const MAX_QUEUED_PROMPT_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct QueuePromptRequest {
    pub content: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PromptQueueOkResponse {
    pub ok: bool,
}

fn validated(content: &str) -> Result<&str, AppError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "A queued message can't be empty.".to_string(),
        ));
    }
    if trimmed.len() > MAX_QUEUED_PROMPT_BYTES {
        return Err(AppError::BadRequest(
            "This message is too long to queue.".to_string(),
        ));
    }
    Ok(trimmed)
}

#[utoipa::path(get, path = "/api/sessions/{session_id}/prompt-queue",
    params(("session_id" = i64, Path,)),
    responses((status = 200, body = Vec<QueuedPrompt>)))]
pub async fn list_session_prompt_queue(
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
) -> Result<Json<Vec<QueuedPrompt>>, AppError> {
    Ok(Json(store::list_open(&state.read_pool, session_id).await?))
}

#[utoipa::path(post, path = "/api/sessions/{session_id}/prompt-queue",
    params(("session_id" = i64, Path,)),
    request_body = QueuePromptRequest,
    responses((status = 200, body = QueuedPrompt)))]
pub async fn enqueue_session_prompt(
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
    Json(body): Json<QueuePromptRequest>,
) -> Result<Json<QueuedPrompt>, AppError> {
    let prompt = store::enqueue(&state.write_pool, session_id, validated(&body.content)?).await?;
    super::notify_changed(&state, session_id);
    // The turn may have ended between the user's keypress and this request.
    // The prompt is queued either way: a failed delivery is recorded on its
    // row (shown in the queue, retried by editing), so failing this request
    // would put the text back in the composer too and duplicate it.
    if let Err(error) = delivery::drain_next_if_idle(&state, session_id).await {
        tracing::warn!(session_id, %error, "queued prompt could not be delivered right away");
    }
    Ok(Json(prompt))
}

#[utoipa::path(patch, path = "/api/sessions/{session_id}/prompt-queue/{id}",
    params(("session_id" = i64, Path,), ("id" = i64, Path,)),
    request_body = QueuePromptRequest,
    responses((status = 200, body = QueuedPrompt)))]
pub async fn update_session_queued_prompt(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(i64, i64)>,
    Json(body): Json<QueuePromptRequest>,
) -> Result<Json<QueuedPrompt>, AppError> {
    let prompt =
        store::update_content(&state.write_pool, session_id, id, validated(&body.content)?).await?;
    super::notify_changed(&state, session_id);
    Ok(Json(prompt))
}

#[utoipa::path(delete, path = "/api/sessions/{session_id}/prompt-queue/{id}",
    params(("session_id" = i64, Path,), ("id" = i64, Path,)),
    responses((status = 200, body = PromptQueueOkResponse)))]
pub async fn delete_session_queued_prompt(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(i64, i64)>,
) -> Result<Json<PromptQueueOkResponse>, AppError> {
    store::cancel(&state.write_pool, session_id, id).await?;
    super::notify_changed(&state, session_id);
    Ok(Json(PromptQueueOkResponse { ok: true }))
}

#[utoipa::path(post, path = "/api/sessions/{session_id}/prompt-queue/{id}/send",
    params(("session_id" = i64, Path,), ("id" = i64, Path,)),
    responses((status = 200, body = PromptQueueOkResponse)))]
pub async fn send_session_queued_prompt_now(
    State(state): State<AppState>,
    Path((session_id, id)): Path<(i64, i64)>,
) -> Result<Json<PromptQueueOkResponse>, AppError> {
    delivery::send_now(&state, session_id, id).await?;
    Ok(Json(PromptQueueOkResponse { ok: true }))
}

pub fn prompt_queue_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/sessions/{session_id}/prompt-queue",
            get(list_session_prompt_queue).post(enqueue_session_prompt),
        )
        .route(
            "/api/sessions/{session_id}/prompt-queue/{id}",
            patch(update_session_queued_prompt).delete(delete_session_queued_prompt),
        )
        .route(
            "/api/sessions/{session_id}/prompt-queue/{id}/send",
            post(send_session_queued_prompt_now),
        )
}
