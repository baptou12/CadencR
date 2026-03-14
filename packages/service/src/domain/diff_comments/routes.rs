use axum::extract::{Json, Path, Query, State};
use axum::routing::{delete, get, put};
use axum::Router;
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::domain::diff_comments::models::*;
use crate::domain::diff_comments::repository;
use crate::error::AppError;

#[derive(Serialize, utoipa::ToSchema)]
pub struct SuccessResponse {
    pub success: bool,
}

// ---- Diff Comments ----

#[utoipa::path(get, path = "/api/features/{feature_id}/diff-comments",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = Vec<DiffComment>)))]
pub async fn list_diff_comments_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<Vec<DiffComment>>, AppError> {
    Ok(Json(repository::list_by_feature(&state.read_pool, feature_id).await?))
}

#[utoipa::path(post, path = "/api/features/{feature_id}/diff-comments",
    params(("feature_id" = i64, Path,)),
    request_body = CreateDiffCommentRequest,
    responses((status = 200, body = DiffComment)))]
pub async fn create_diff_comment_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
    Json(body): Json<CreateDiffCommentRequest>,
) -> Result<Json<DiffComment>, AppError> {
    if feature_id != body.feature_id {
        return Err(AppError::BadRequest("URL feature_id does not match body feature_id".to_string()));
    }
    Ok(Json(repository::create(&state.write_pool, &body).await?))
}

#[utoipa::path(put, path = "/api/diff-comments/{id}",
    params(("id" = i64, Path,)),
    request_body = UpdateDiffCommentRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn update_diff_comment_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateDiffCommentRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    repository::update(&state.write_pool, id, &body.content).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(delete, path = "/api/diff-comments/{id}",
    params(("id" = i64, Path,)),
    responses((status = 200, body = SuccessResponse)))]
pub async fn delete_diff_comment_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SuccessResponse>, AppError> {
    repository::delete(&state.write_pool, id).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(put, path = "/api/features/{feature_id}/diff-comments/sent",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = UpdatedResponse)))]
pub async fn mark_diff_comments_sent_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<UpdatedResponse>, AppError> {
    let updated = repository::mark_as_sent(&state.write_pool, feature_id).await?;
    Ok(Json(UpdatedResponse { updated }))
}

#[utoipa::path(delete, path = "/api/features/{feature_id}/diff-comments/pending",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = DeletedResponse)))]
pub async fn delete_pending_diff_comments_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<DeletedResponse>, AppError> {
    let deleted = repository::delete_pending(&state.write_pool, feature_id).await?;
    Ok(Json(DeletedResponse { deleted }))
}

// ---- Diff Viewed ----

#[utoipa::path(get, path = "/api/features/{feature_id}/diff-viewed",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = Vec<DiffViewedFile>)))]
pub async fn list_diff_viewed_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<Vec<DiffViewedFile>>, AppError> {
    Ok(Json(repository::list_viewed_by_feature(&state.read_pool, feature_id).await?))
}

#[utoipa::path(post, path = "/api/features/{feature_id}/diff-viewed",
    params(("feature_id" = i64, Path,)),
    request_body = MarkViewedRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn mark_diff_viewed_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
    Json(body): Json<MarkViewedRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    if feature_id != body.feature_id {
        return Err(AppError::BadRequest("URL feature_id does not match body feature_id".to_string()));
    }
    repository::mark_viewed(&state.write_pool, body.feature_id, &body.file_path, &body.blob_sha).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct UnmarkViewedParams {
    pub file_path: String,
}

#[utoipa::path(delete, path = "/api/features/{feature_id}/diff-viewed/file",
    params(("feature_id" = i64, Path,), UnmarkViewedParams),
    responses((status = 200, body = SuccessResponse)))]
pub async fn unmark_diff_viewed_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
    Query(params): Query<UnmarkViewedParams>,
) -> Result<Json<SuccessResponse>, AppError> {
    repository::unmark_viewed(&state.write_pool, feature_id, &params.file_path).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(delete, path = "/api/features/{feature_id}/diff-viewed/files",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = DeletedResponse)))]
pub async fn clear_all_diff_viewed_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<DeletedResponse>, AppError> {
    let deleted = repository::clear_all_viewed(&state.write_pool, feature_id).await?;
    Ok(Json(DeletedResponse { deleted }))
}

pub fn diff_comments_router() -> Router<AppState> {
    Router::new()
        .route("/api/features/{feature_id}/diff-comments", get(list_diff_comments_handler).post(create_diff_comment_handler))
        .route("/api/diff-comments/{id}", put(update_diff_comment_handler).delete(delete_diff_comment_handler))
        .route("/api/features/{feature_id}/diff-comments/sent", put(mark_diff_comments_sent_handler))
        .route("/api/features/{feature_id}/diff-comments/pending", delete(delete_pending_diff_comments_handler))
        .route("/api/features/{feature_id}/diff-viewed", get(list_diff_viewed_handler).post(mark_diff_viewed_handler))
        .route("/api/features/{feature_id}/diff-viewed/file", delete(unmark_diff_viewed_handler))
        .route("/api/features/{feature_id}/diff-viewed/files", delete(clear_all_diff_viewed_handler))
}
