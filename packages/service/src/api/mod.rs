pub mod openapi;

use axum::Router;
use crate::app_state::AppState;
use crate::domain::git::routes::git_router;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .merge(openapi::routes())
        .merge(git_router())
        .with_state(state)
}
