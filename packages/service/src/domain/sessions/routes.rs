use axum::extract::{Json, Path, Query, State};
use axum::routing::{get, put};
use axum::Router;
use serde::Deserialize;
use std::collections::HashMap;

use crate::app_state::AppState;
use crate::domain::sessions::models::*;
use crate::domain::sessions::repository;
use crate::domain::sessions::unified_agents::{
    list_unified_agents, normalize_message_limit, set_agent_pinned, UnifiedAgentsQuery,
};
use crate::error::AppError;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct AgentStateParams {
    /// JSON-encoded map of session_id -> last_message_id for incremental fetching
    pub after: Option<String>,
    /// Max number of messages per session for initial load (default: all)
    pub limit: Option<i64>,
    /// JSON-encoded map of session_id -> before_message_id for loading older messages
    pub before: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct UnifiedAgentsParams {
    pub mode: Option<UnifiedAgentsMode>,
    pub fresh_minutes: Option<i64>,
    pub project_id: Option<i64>,
    pub include_archived: Option<bool>,
    pub message_limit: Option<i64>,
}

#[utoipa::path(get, path = "/api/features/{feature_id}/sessions",
    params(("feature_id" = i64, Path,)),
    responses((status = 200, body = Vec<AgentSessionRow>)))]
pub async fn get_sessions_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<Json<Vec<AgentSessionRow>>, AppError> {
    Ok(Json(
        repository::get_sessions(&state.read_pool, feature_id).await?,
    ))
}

#[utoipa::path(get, path = "/api/features/{feature_id}/agent-state",
    params(("feature_id" = i64, Path,), AgentStateParams),
    responses((status = 200, body = FeatureAgentStateResponse)))]
pub async fn get_feature_agent_state_handler(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
    Query(params): Query<AgentStateParams>,
) -> Result<Json<FeatureAgentStateResponse>, AppError> {
    let after_map: Option<HashMap<i64, i64>> = params
        .after
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    let before_map: Option<HashMap<i64, i64>> = params
        .before
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    Ok(Json(
        repository::get_feature_agent_state(
            &state.read_pool,
            feature_id,
            after_map,
            params.limit,
            before_map,
        )
        .await?,
    ))
}

#[utoipa::path(get, path = "/api/agents/unified",
    params(UnifiedAgentsParams),
    responses((status = 200, body = UnifiedAgentsResponse)))]
pub async fn get_unified_agents_handler(
    State(state): State<AppState>,
    Query(params): Query<UnifiedAgentsParams>,
) -> Result<Json<UnifiedAgentsResponse>, AppError> {
    Ok(Json(
        list_unified_agents(
            &state.read_pool,
            UnifiedAgentsQuery {
                mode: params.mode.unwrap_or_default(),
                fresh_minutes: params.fresh_minutes.unwrap_or(5).max(1),
                project_id: params.project_id,
                include_archived: params.include_archived.unwrap_or(false),
                message_limit: normalize_message_limit(params.message_limit),
            },
        )
        .await?,
    ))
}

#[utoipa::path(put, path = "/api/agents/{session_id}/pin",
    params(("session_id" = i64, Path,)),
    responses((status = 200, body = AgentPinResponse)))]
pub async fn pin_agent_handler(
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
) -> Result<Json<AgentPinResponse>, AppError> {
    set_agent_pinned(&state.write_pool, session_id, true).await?;
    Ok(Json(AgentPinResponse {
        success: true,
        is_pinned: true,
    }))
}

#[utoipa::path(delete, path = "/api/agents/{session_id}/pin",
    params(("session_id" = i64, Path,)),
    responses((status = 200, body = AgentPinResponse)))]
pub async fn unpin_agent_handler(
    State(state): State<AppState>,
    Path(session_id): Path<i64>,
) -> Result<Json<AgentPinResponse>, AppError> {
    set_agent_pinned(&state.write_pool, session_id, false).await?;
    Ok(Json(AgentPinResponse {
        success: true,
        is_pinned: false,
    }))
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

#[utoipa::path(get, path = "/api/sessions/messages/{message_id}/full",
    params(("message_id" = i64, Path,)),
    responses(
        (status = 200, body = MessageFullContentResponse),
        (status = 404, description = "Message not found")
    ))]
pub async fn get_message_full_content_handler(
    State(state): State<AppState>,
    Path(message_id): Path<i64>,
) -> Result<Json<MessageFullContentResponse>, AppError> {
    let content = repository::get_message_content(&state.read_pool, message_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent_message {message_id}")))?;
    Ok(Json(MessageFullContentResponse { content }))
}

pub fn sessions_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/features/{feature_id}/sessions",
            get(get_sessions_handler),
        )
        .route(
            "/api/features/{feature_id}/agent-state",
            get(get_feature_agent_state_handler),
        )
        .route("/api/agents/unified", get(get_unified_agents_handler))
        .route(
            "/api/agents/{session_id}/pin",
            put(pin_agent_handler).delete(unpin_agent_handler),
        )
        .route(
            "/api/sessions/{session_id}/draft",
            get(get_draft_handler).put(save_draft_handler),
        )
        .route(
            "/api/sessions/messages/{message_id}/full",
            get(get_message_full_content_handler),
        )
}
