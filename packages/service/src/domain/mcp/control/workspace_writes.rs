//! Workspace-scoped write endpoints: the cross-project twins of
//! `/internal/mcp/project/{update-feature,stop-session}`.
//!
//! Same handlers, run with `WriteScope::Workspace`, so the target may be any
//! feature or session in any project. What replaces the same-project check is
//! the Steward grant on the SOURCE feature (`control::steward`) — the calling
//! session's own feature, resolved server-side from its session id, never from
//! the request body.

use axum::{extract::State, routing::post, Json, Router};

use super::stop_session::{handle_stop_session, StopSessionRequest, StopSessionResponse};
use super::update_feature::{handle_update_feature, UpdateFeatureRequest, UpdateFeatureResponse};
use crate::app_state::AppState;
use crate::domain::mcp::write_scope::WriteScope;
use crate::error::AppError;

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/internal/mcp/workspace/update-feature",
            post(workspace_update_feature_handler),
        )
        .route(
            "/internal/mcp/workspace/stop-session",
            post(workspace_stop_session_handler),
        )
}

async fn workspace_update_feature_handler(
    State(state): State<AppState>,
    Json(body): Json<UpdateFeatureRequest>,
) -> Result<Json<UpdateFeatureResponse>, AppError> {
    handle_update_feature(state, body, WriteScope::Workspace).await
}

async fn workspace_stop_session_handler(
    State(state): State<AppState>,
    Json(body): Json<StopSessionRequest>,
) -> Result<Json<StopSessionResponse>, AppError> {
    handle_stop_session(state, body, WriteScope::Workspace).await
}
