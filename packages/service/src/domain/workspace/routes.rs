use axum::extract::{Json, Path, Query, State};
use axum::routing::get;
use axum::Router;
use serde::Serialize;

use crate::app_state::AppState;
use crate::domain::workspace::models::*;
use crate::domain::workspace::service;
use crate::error::AppError;

#[derive(Serialize, utoipa::ToSchema)]
pub struct SettingValueResponse {
    pub value: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AddPromptEntryResponse {
    pub success: bool,
    pub skipped: bool,
}

#[utoipa::path(get, path = "/api/workspace/settings", responses((status = 200, body = Vec<Setting>)))]
pub async fn list_settings_handler(State(state): State<AppState>) -> Result<Json<Vec<Setting>>, AppError> {
    Ok(Json(service::list_settings(&state.read_pool).await?))
}

#[utoipa::path(get, path = "/api/workspace/settings/{key}", params(("key" = String, Path,)), responses((status = 200, body = SettingValueResponse)))]
pub async fn get_setting_handler(State(state): State<AppState>, Path(key): Path<String>) -> Result<Json<SettingValueResponse>, AppError> {
    let value = service::get_setting(&state.read_pool, &key).await?;
    Ok(Json(SettingValueResponse { value }))
}

#[utoipa::path(put, path = "/api/workspace/settings/{key}", params(("key" = String, Path,)), request_body = SetSettingRequest, responses((status = 200, body = SettingValueResponse)))]
pub async fn set_setting_handler(State(state): State<AppState>, Path(key): Path<String>, Json(body): Json<SetSettingRequest>) -> Result<Json<SettingValueResponse>, AppError> {
    service::set_setting(&state.write_pool, &key, &body.value).await?;
    Ok(Json(SettingValueResponse { value: Some(body.value) }))
}

#[utoipa::path(get, path = "/api/workspace/model-settings", responses((status = 200, body = ModelSettings)))]
pub async fn get_model_settings_handler(State(state): State<AppState>) -> Result<Json<ModelSettings>, AppError> {
    Ok(Json(service::get_model_settings(&state.read_pool).await?))
}

#[utoipa::path(put, path = "/api/workspace/model-settings", request_body = SetModelSettingRequest, responses((status = 200, body = SettingValueResponse)))]
pub async fn set_model_setting_handler(State(state): State<AppState>, Json(body): Json<SetModelSettingRequest>) -> Result<Json<SettingValueResponse>, AppError> {
    service::set_model_setting(&state.write_pool, &body.agent_type, &body.model_id).await?;
    Ok(Json(SettingValueResponse { value: Some(body.model_id) }))
}

#[utoipa::path(get, path = "/api/workspace/prompt-history", params(("project_id" = i64, Query,)), responses((status = 200, body = Vec<String>)))]
pub async fn get_prompt_history_handler(State(state): State<AppState>, Query(params): Query<GetPromptHistoryParams>) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(service::get_prompt_history(&state.read_pool, params.project_id).await?))
}

#[utoipa::path(post, path = "/api/workspace/prompt-history", request_body = AddPromptEntryRequest, responses((status = 200, body = AddPromptEntryResponse)))]
pub async fn add_prompt_entry_handler(State(state): State<AppState>, Json(body): Json<AddPromptEntryRequest>) -> Result<Json<AddPromptEntryResponse>, AppError> {
    let inserted = service::add_prompt_entry(&state.write_pool, body.project_id, &body.content).await?;
    Ok(Json(AddPromptEntryResponse { success: true, skipped: !inserted }))
}

pub fn workspace_router() -> Router<AppState> {
    Router::new()
        .route("/api/workspace/settings", get(list_settings_handler))
        .route("/api/workspace/settings/{key}", get(get_setting_handler).put(set_setting_handler))
        .route("/api/workspace/model-settings", get(get_model_settings_handler).put(set_model_setting_handler))
        .route("/api/workspace/prompt-history", get(get_prompt_history_handler).post(add_prompt_entry_handler))
}
