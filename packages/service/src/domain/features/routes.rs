use axum::extract::{Json, Path, Query, State};
use axum::routing::{get, put};
use axum::Router;
use serde::Deserialize;

use crate::app_state::AppState;
use crate::domain::features::models::*;
use crate::domain::features::service;
use crate::error::AppError;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ListFeaturesParams {
    pub project_id: i64,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ResolveWorkingDirParams {
    pub project_id: i64,
}

#[utoipa::path(get, path = "/api/features",
    params(ListFeaturesParams),
    responses((status = 200, body = Vec<Feature>)))]
pub async fn list_features_handler(
    State(state): State<AppState>,
    Query(params): Query<ListFeaturesParams>,
) -> Result<Json<Vec<Feature>>, AppError> {
    Ok(Json(service::list_by_project(&state.read_pool, params.project_id).await?))
}

#[utoipa::path(post, path = "/api/features",
    request_body = CreateFeatureRequest,
    responses((status = 200, body = CreateFeatureResponse)))]
pub async fn create_feature_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateFeatureRequest>,
) -> Result<Json<CreateFeatureResponse>, AppError> {
    Ok(Json(
        service::create_feature(&state.write_pool, body.project_id, body.title, body.type_).await?,
    ))
}

#[utoipa::path(get, path = "/api/features/{id}",
    params(("id" = i64, Path,)),
    responses((status = 200, body = Feature)))]
pub async fn get_feature_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Option<Feature>>, AppError> {
    Ok(Json(service::get_by_id(&state.read_pool, id).await?))
}

#[utoipa::path(delete, path = "/api/features/{id}",
    params(("id" = i64, Path,)),
    responses((status = 200, body = SuccessResponse)))]
pub async fn delete_feature_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::delete_feature(&state.write_pool, &state.read_pool, id, state.electron_port).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(put, path = "/api/features/{id}/status",
    params(("id" = i64, Path,)),
    request_body = UpdateStatusRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn update_feature_status_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::update_status(&state.write_pool, id, &body.status).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(put, path = "/api/features/{id}/title",
    params(("id" = i64, Path,)),
    request_body = UpdateTitleRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn update_feature_title_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateTitleRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::update_title(&state.write_pool, id, &body.title).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/features/{id}/prd",
    params(("id" = i64, Path,)),
    responses((status = 200, body = PrdResponse)))]
pub async fn get_prd_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<PrdResponse>, AppError> {
    Ok(Json(service::get_prd(&state.read_pool, id).await?))
}

#[utoipa::path(get, path = "/api/features/{id}/empty",
    params(("id" = i64, Path,)),
    responses((status = 200, body = IsEmptyResponse)))]
pub async fn is_empty_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<IsEmptyResponse>, AppError> {
    Ok(Json(service::is_empty(&state.read_pool, id).await?))
}

#[utoipa::path(get, path = "/api/features/{id}/plan",
    params(("id" = i64, Path,)),
    responses((status = 200, body = Option<PlanWithPhases>)))]
pub async fn get_plan_with_phases_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Option<PlanWithPhases>>, AppError> {
    Ok(Json(service::get_plan_with_phases(&state.read_pool, id).await?))
}

#[utoipa::path(get, path = "/api/features/{id}/plan/progress",
    params(("id" = i64, Path,)),
    responses((status = 200, body = PlanProgress)))]
pub async fn get_plan_progress_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<PlanProgress>, AppError> {
    Ok(Json(service::get_plan_progress(&state.read_pool, id).await?))
}

#[utoipa::path(put, path = "/api/phases/{id}/reset",
    params(("id" = i64, Path,)),
    responses((status = 200, body = SuccessResponse)))]
pub async fn reset_phase_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::reset_phase(&state.write_pool, id).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(put, path = "/api/phases/{id}/status",
    params(("id" = i64, Path,)),
    request_body = OverridePhaseStatusRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn override_phase_status_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<OverridePhaseStatusRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::override_phase_status(&state.write_pool, id, &body.status).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/features/{id}/settings",
    params(("id" = i64, Path,)),
    responses((status = 200, body = Vec<FeatureSetting>)))]
pub async fn get_feature_settings_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<FeatureSetting>>, AppError> {
    Ok(Json(service::get_feature_settings(&state.read_pool, id).await?))
}

#[utoipa::path(put, path = "/api/features/{id}/settings",
    params(("id" = i64, Path,)),
    request_body = SetFeatureSettingRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn set_feature_setting_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetFeatureSettingRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::set_feature_setting(&state.write_pool, id, &body.key, &body.value).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/features/{id}/model-settings",
    params(("id" = i64, Path,)),
    responses((status = 200, body = FeatureModelSettings)))]
pub async fn get_feature_model_settings_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<FeatureModelSettings>, AppError> {
    Ok(Json(service::get_feature_model_settings(&state.read_pool, id).await?))
}

#[utoipa::path(put, path = "/api/features/{id}/model-settings",
    params(("id" = i64, Path,)),
    request_body = SetFeatureModelSettingRequest,
    responses((status = 200, body = SuccessResponse)))]
pub async fn set_feature_model_setting_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<SetFeatureModelSettingRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    service::set_feature_model_setting(&state.write_pool, id, &body.model_type, &body.model).await?;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/features/{id}/working-dir",
    params(("id" = i64, Path,), ResolveWorkingDirParams),
    responses((status = 200, body = WorkingDirResponse)))]
pub async fn get_working_dir_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<ResolveWorkingDirParams>,
) -> Result<Json<WorkingDirResponse>, AppError> {
    Ok(Json(
        service::resolve_working_dir(&state.read_pool, id, params.project_id).await?,
    ))
}

#[utoipa::path(get, path = "/api/features/{id}/snapshot",
    params(("id" = i64, Path,)),
    responses((status = 200, body = FeatureSnapshotResponse)))]
pub async fn get_feature_snapshot_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<FeatureSnapshotResponse>, AppError> {
    Ok(Json(service::get_feature_snapshot(&state.read_pool, id).await?))
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct SuccessResponse {
    pub success: bool,
}

pub fn features_router() -> Router<AppState> {
    Router::new()
        .route("/api/features", get(list_features_handler).post(create_feature_handler))
        .route("/api/features/{id}", get(get_feature_handler).delete(delete_feature_handler))
        .route("/api/features/{id}/status", put(update_feature_status_handler))
        .route("/api/features/{id}/title", put(update_feature_title_handler))
        .route("/api/features/{id}/prd", get(get_prd_handler))
        .route("/api/features/{id}/empty", get(is_empty_handler))
        .route("/api/features/{id}/plan", get(get_plan_with_phases_handler))
        .route("/api/features/{id}/plan/progress", get(get_plan_progress_handler))
        .route("/api/phases/{id}/reset", put(reset_phase_handler))
        .route("/api/phases/{id}/status", put(override_phase_status_handler))
        .route("/api/features/{id}/settings", get(get_feature_settings_handler).put(set_feature_setting_handler))
        .route("/api/features/{id}/model-settings", get(get_feature_model_settings_handler).put(set_feature_model_setting_handler))
        .route("/api/features/{id}/snapshot", get(get_feature_snapshot_handler))
        .route("/api/features/{id}/working-dir", get(get_working_dir_handler))
}
