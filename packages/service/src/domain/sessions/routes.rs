use axum::extract::{Json, Path, Query, State};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use std::collections::HashMap;

use crate::app_state::AppState;
use crate::domain::sessions::models::*;
use crate::domain::sessions::repository;
use crate::error::AppError;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct AgentStateParams {
    /// JSON-encoded map of session_id -> last_message_id for incremental fetching
    pub after: Option<String>,
}

#[utoipa::path(get, path = "/api/features/{feature_id}/sessions",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = Vec<AgentSessionRow>)))]
pub async fn get_sessions_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<Vec<AgentSessionRow>>, AppError> {
    Ok(Json(repository::get_sessions(&state.read_pool, feature_id).await?))
}

#[utoipa::path(get, path = "/api/features/{feature_id}/agent-state",
    params(("feature_id" = i64, Path,), AgentStateParams),
    responses((status = 200, body = FeatureAgentStateResponse)))]
pub async fn get_feature_agent_state_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
    Query(params): Query<AgentStateParams>,
) -> Result<Json<FeatureAgentStateResponse>, AppError> {
    let after_map: Option<HashMap<i64, i64>> = params.after
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    Ok(Json(repository::get_feature_agent_state(&state.read_pool, feature_id, after_map).await?))
}

#[utoipa::path(get, path = "/api/sessions/{session_id}/draft",
    params(("session_id" = i64, Path,)),
    responses((status = 200, body = DraftResponse)))]
pub async fn get_draft_handler(
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
) -> Result<Json<DraftResponse>, AppError> {
    let draft_prompt = repository::get_draft(&state.read_pool, session_id).await?;
    Ok(Json(DraftResponse { draft_prompt }))
}

#[utoipa::path(put, path = "/api/sessions/{session_id}/draft",
    params(("session_id" = i64, Path,)),
    request_body = SaveDraftRequest,
    responses((status = 200, body = SaveDraftResponse)))]
pub async fn save_draft_handler(
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
    Json(body): Json<SaveDraftRequest>,
) -> Result<Json<SaveDraftResponse>, AppError> {
    repository::save_draft(&state.write_pool, session_id, body.draft.as_deref()).await?;
    Ok(Json(SaveDraftResponse { success: true }))
}

pub fn sessions_router() -> Router<AppState> {
    Router::new()
        .route("/api/features/{feature_id}/sessions", get(get_sessions_handler))
        .route("/api/features/{feature_id}/agent-state", get(get_feature_agent_state_handler))
        .route("/api/sessions/{session_id}/draft", get(get_draft_handler).put(save_draft_handler))
}
