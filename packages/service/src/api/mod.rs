pub mod openapi;

use crate::app_state::AppState;
use crate::domain::agents::runtime::AgentCatalogResponse;
use crate::domain::diff_comments::routes::diff_comments_router;
use crate::domain::editor::routes::editor_router;
use crate::domain::features::routes::features_router;
use crate::domain::git::routes::git_router;
use crate::domain::projects::routes::projects_router;
use crate::domain::sessions::routes::sessions_router;
use crate::domain::terminal::routes::terminal_router;
use crate::domain::usage::routes::usage_router;
use crate::domain::workspace::routes::workspace_router;
use crate::domain::ws_session::handler::ws_handler;
use axum::routing::get;
use axum::Json;
use axum::Router;

#[utoipa::path(get, path = "/api/agent-catalog", responses((status = 200, body = AgentCatalogResponse)))]
pub async fn get_agent_catalog() -> Json<AgentCatalogResponse> {
    Json(crate::domain::agents::providers::provider_catalog_live().await)
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .merge(openapi::routes())
        .merge(git_router())
        .merge(workspace_router())
        .merge(projects_router())
        .merge(features_router())
        .merge(diff_comments_router())
        .merge(sessions_router())
        .merge(usage_router())
        .merge(terminal_router())
        .merge(editor_router())
        .route("/ws", get(ws_handler))
        .route("/api/agent-catalog", get(get_agent_catalog))
        .with_state(state)
}
