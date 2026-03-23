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
use crate::domain::usage::routes::usage_router;
use crate::domain::terminal::routes::terminal_router;
use crate::domain::ws_session::handler::ws_handler;

#[derive(Clone, serde::Serialize, utoipa::ToSchema)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub context_window: u64,
}

/// User-facing model aliases served by GET /api/models.
pub const MODELS: &[(&str, &str, u64)] = &[
    ("sonnet",     "Sonnet",      200_000),
    ("opus",       "Opus",        200_000),
    ("haiku",      "Haiku",       200_000),
    ("sonnet[1m]", "Sonnet (1M)", 1_000_000),
    ("opus[1m]",   "Opus (1M)",   1_000_000),
];

/// CLI model ID prefixes → context window.
/// The CLI reports full IDs like "claude-opus-4-6-20260301"; we match by prefix.
const CLI_MODEL_PREFIXES: &[(&str, u64)] = &[
    ("claude-opus-4-6",   1_000_000),
    ("claude-sonnet-4-6", 1_000_000),
];

pub const DEFAULT_CONTEXT_WINDOW: u64 = 200_000;

pub const DEFAULT_MODEL: &str = "opus[1m]";

/// Look up the context window for a model ID.
/// Checks aliases first, then CLI model ID prefixes, then falls back to 200k.
pub fn context_window_for_model(model: &str) -> u64 {
    if let Some((_, _, cw)) = MODELS.iter().find(|(id, _, _)| *id == model) {
        return *cw;
    }

    let m = model.to_lowercase();
    for (prefix, cw) in CLI_MODEL_PREFIXES {
        if m.starts_with(prefix) {
            return *cw;
        }
    }

    DEFAULT_CONTEXT_WINDOW
}

#[utoipa::path(get, path = "/api/models", responses((status = 200, body = Vec<ModelInfo>)))]
pub async fn list_models() -> Json<Vec<ModelInfo>> {
    Json(MODELS.iter().map(|(id, label, cw)| ModelInfo {
        id: id.to_string(),
        label: label.to_string(),
        context_window: *cw,
    }).collect())
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
        .route("/ws", get(ws_handler))
        .route("/api/models", get(list_models))
        .with_state(state)
}
