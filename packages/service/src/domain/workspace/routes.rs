use axum::extract::{Json, Path, State};
use axum::routing::get;
use axum::Router;
use serde::Serialize;

use crate::app_state::AppState;
use crate::domain::settings_allowlist;
use crate::domain::workspace::models::*;
use crate::domain::workspace::service;
use crate::error::AppError;

#[derive(Serialize, utoipa::ToSchema)]
pub struct SettingValueResponse {
    pub value: Option<String>,
}

#[utoipa::path(get, path = "/api/workspace/settings", responses((status = 200, body = Vec<Setting>)))]
pub async fn list_settings_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<Setting>>, AppError> {
    Ok(Json(service::list_settings(&state.read_pool).await?))
}

#[utoipa::path(get, path = "/api/workspace/settings/{key}", params(("key" = String, Path,)), responses((status = 200, body = SettingValueResponse)))]
pub async fn get_setting_handler(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<SettingValueResponse>, AppError> {
    let value = service::get_setting(&state.read_pool, &key).await?;
    Ok(Json(SettingValueResponse { value }))
}

#[utoipa::path(put, path = "/api/workspace/settings/{key}", params(("key" = String, Path,)), request_body = SetSettingRequest, responses((status = 200, body = SettingValueResponse)))]
pub async fn set_setting_handler(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<SetSettingRequest>,
) -> Result<Json<SettingValueResponse>, AppError> {
    if !settings_allowlist::is_workspace_key_allowed(&key) {
        return Err(AppError::BadRequest(format!(
            "unknown workspace settings key: {key}"
        )));
    }
    service::set_setting(&state.write_pool, &key, &body.value).await?;
    Ok(Json(SettingValueResponse {
        value: Some(body.value),
    }))
}

#[utoipa::path(get, path = "/api/workspace/model-settings", responses((status = 200, body = ModelSettings)))]
pub async fn get_model_settings_handler(
    State(state): State<AppState>,
) -> Result<Json<ModelSettings>, AppError> {
    Ok(Json(service::get_model_settings(&state.read_pool).await?))
}

#[utoipa::path(get, path = "/api/workspace/provider-settings", responses((status = 200, body = AgentProviderSettings)))]
pub async fn get_provider_settings_handler(
    State(state): State<AppState>,
) -> Result<Json<AgentProviderSettings>, AppError> {
    Ok(Json(
        service::get_provider_settings(&state.read_pool).await?,
    ))
}

#[utoipa::path(put, path = "/api/workspace/model-settings", request_body = SetModelSettingRequest, responses((status = 200, body = SettingValueResponse)))]
pub async fn set_model_setting_handler(
    State(state): State<AppState>,
    Json(body): Json<SetModelSettingRequest>,
) -> Result<Json<SettingValueResponse>, AppError> {
    service::set_model_setting(&state.write_pool, &body.agent_type, &body.model_id).await?;
    Ok(Json(SettingValueResponse {
        value: Some(body.model_id),
    }))
}

#[utoipa::path(put, path = "/api/workspace/provider-settings", request_body = SetProviderSettingRequest, responses((status = 200, body = SettingValueResponse)))]
pub async fn set_provider_setting_handler(
    State(state): State<AppState>,
    Json(body): Json<SetProviderSettingRequest>,
) -> Result<Json<SettingValueResponse>, AppError> {
    service::set_provider_setting(&state.write_pool, &body.agent_type, &body.provider_id).await?;
    Ok(Json(SettingValueResponse {
        value: Some(body.provider_id),
    }))
}

pub fn workspace_router() -> Router<AppState> {
    Router::new()
        .route("/api/workspace/settings", get(list_settings_handler))
        .route(
            "/api/workspace/settings/{key}",
            get(get_setting_handler).put(set_setting_handler),
        )
        .route(
            "/api/workspace/model-settings",
            get(get_model_settings_handler).put(set_model_setting_handler),
        )
        .route(
            "/api/workspace/provider-settings",
            get(get_provider_settings_handler).put(set_provider_setting_handler),
        )
}
