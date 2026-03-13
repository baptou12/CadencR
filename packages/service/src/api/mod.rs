pub mod openapi;

use axum::Router;
use crate::app_state::AppState;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .merge(openapi::routes())
        .with_state(state)
}
