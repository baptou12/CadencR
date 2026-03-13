pub mod openapi;

use axum::Router;
use crate::app_state::AppState;
use crate::domain::git::routes::git_router;
use crate::domain::workspace::routes::workspace_router;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .merge(openapi::routes())
        .merge(git_router())
        .merge(workspace_router())
        .with_state(state)
}
