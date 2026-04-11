use axum::routing::get;
use axum::{Json, Router};

use super::models::UsageResponse;
use super::service;
use crate::app_state::AppState;

#[utoipa::path(get, path = "/api/usage", responses((status = 200, body = UsageResponse)))]
pub async fn get_usage_handler() -> Json<UsageResponse> {
    Json(service::get_usage().await)
}

pub fn usage_router() -> Router<AppState> {
    Router::new().route("/api/usage", get(get_usage_handler))
}
