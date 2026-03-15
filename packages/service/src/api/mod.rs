pub mod openapi;

use axum::Router;
use axum::routing::get;
use axum::Json;
use crate::app_state::AppState;
use crate::domain::git::routes::git_router;
use crate::domain::workspace::routes::workspace_router;
use crate::domain::projects::routes::projects_router;
use crate::domain::features::routes::features_router;
use crate::domain::diff_comments::routes::diff_comments_router;
use crate::domain::sessions::routes::sessions_router;
use crate::domain::ws_session::handler::ws_handler;

#[derive(serde::Serialize)]
struct ModelInfo {
    id: String,
    label: String,
}

async fn list_models() -> Json<Vec<ModelInfo>> {
    Json(vec![
        ModelInfo { id: "claude-opus-4-6".into(), label: "Opus 4.6".into() },
        ModelInfo { id: "claude-sonnet-4-6".into(), label: "Sonnet 4.6".into() },
        ModelInfo { id: "claude-haiku-4-5-20251001".into(), label: "Haiku 4.5".into() },
    ])
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
        .route("/ws", get(ws_handler))
        .route("/api/models", get(list_models))
        .with_state(state)
}
