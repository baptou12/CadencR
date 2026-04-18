use axum::extract::{Json, Path, State};
use axum::routing::get;
use axum::Router;
use serde::Serialize;

use crate::app_state::AppState;
use crate::domain::projects::models::*;
use crate::domain::projects::service;
use crate::domain::settings_allowlist;
use crate::error::AppError;

#[derive(Serialize, utoipa::ToSchema)]
pub struct SuccessResponse {
    pub success: bool,
}

#[utoipa::path(get, path = "/api/projects", responses((status = 200, body = Vec<Project>)))]
pub async fn list_projects_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<Project>>, AppError> {
    Ok(Json(service::list_projects(&state.read_pool).await?))
}

#[utoipa::path(post, path = "/api/projects", request_body = CreateProjectRequest, responses((status = 200, body = Project)))]
pub async fn create_project_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateProjectRequest>,
) -> Result<Json<Project>, AppError> {
    Ok(Json(
        service::create_project(&state.write_pool, &body.name, &body.path).await?,
    ))
}

#[utoipa::path(delete, path = "/api/projects/{id}", params(("id" = i64, Path,)), responses((status = 200, body = SuccessResponse)))]
pub async fn delete_project_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::delete_project(&state.write_pool, id).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/projects/{id}/settings", params(("id" = i64, Path,)), responses((status = 200, body = Vec<ProjectSetting>)))]
pub async fn get_project_settings_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ProjectSetting>>, AppError> {
    Ok(Json(
        service::get_project_settings(&state.read_pool, id).await?,
    ))
}

#[utoipa::path(put, path = "/api/projects/{id}/settings", params(("id" = i64, Path,)), request_body = SetProjectSettingRequest, responses((status = 200, body = SuccessResponse)))]
pub async fn set_project_setting_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetProjectSettingRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    if !settings_allowlist::is_project_key_allowed(&body.key) {
        return Err(AppError::BadRequest(format!(
            "unknown project settings key: {}",
            body.key
        )));
    }
    service::set_project_setting(&state.write_pool, id, &body.key, &body.value).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/projects/{id}/model-settings", params(("id" = i64, Path,)), responses((status = 200, body = ProjectModelSettings)))]
pub async fn get_project_model_settings_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<ProjectModelSettings>, AppError> {
    Ok(Json(
        service::get_project_model_settings(&state.read_pool, id).await?,
    ))
}

#[utoipa::path(put, path = "/api/projects/{id}/model-settings", params(("id" = i64, Path,)), request_body = SetProjectModelSettingRequest, responses((status = 200, body = SuccessResponse)))]
pub async fn set_project_model_setting_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetProjectModelSettingRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::set_project_model_setting(&state.write_pool, id, &body.model_type, &body.model)
        .await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/projects/{id}/provider-settings", params(("id" = i64, Path,)), responses((status = 200, body = ProjectProviderSettings)))]
pub async fn get_project_provider_settings_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<ProjectProviderSettings>, AppError> {
    Ok(Json(
        service::get_project_provider_settings(&state.read_pool, id).await?,
    ))
}

#[utoipa::path(put, path = "/api/projects/{id}/provider-settings", params(("id" = i64, Path,)), request_body = SetProjectProviderSettingRequest, responses((status = 200, body = SuccessResponse)))]
pub async fn set_project_provider_setting_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetProjectProviderSettingRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::set_project_provider_setting(
        &state.write_pool,
        id,
        &body.provider_type,
        &body.provider,
    )
    .await?;
    Ok(Json(SuccessResponse { success: true }))
}

pub fn projects_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects",
            get(list_projects_handler).post(create_project_handler),
        )
        .route(
            "/api/projects/{id}",
            axum::routing::delete(delete_project_handler),
        )
        .route(
            "/api/projects/{id}/settings",
            get(get_project_settings_handler).put(set_project_setting_handler),
        )
        .route(
            "/api/projects/{id}/model-settings",
            get(get_project_model_settings_handler).put(set_project_model_setting_handler),
        )
        .route(
            "/api/projects/{id}/provider-settings",
            get(get_project_provider_settings_handler).put(set_project_provider_setting_handler),
        )
}
