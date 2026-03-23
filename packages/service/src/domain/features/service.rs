use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{
    Feature, PlanProgress, PlanWithPhases, PrdResponse, IsEmptyResponse,
    WorkingDirResponse, CreateFeatureResponse, FeatureSetting, FeatureModelSettings,
    FeatureSnapshotResponse,
};
use super::repository;

pub async fn list_by_project(pool: &SqlitePool, project_id: i64) -> Result<Vec<Feature>, AppError> {
    repository::list_by_project(pool, project_id).await
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Feature>, AppError> {
    repository::get_by_id(pool, id).await
}

pub async fn create_feature(
    pool: &SqlitePool,
    project_id: i64,
    title: Option<String>,
    type_: Option<String>,
) -> Result<CreateFeatureResponse, AppError> {
    let type_str = type_.as_deref().unwrap_or("ws-feature");
    let title = match title {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            let max_num = repository::get_max_session_num(pool, project_id).await?;
            format!("Session {}", max_num + 1)
        }
    };
    let id = repository::create_feature(pool, project_id, &title, type_str).await?;
    Ok(CreateFeatureResponse { id })
}

pub async fn update_status(pool: &SqlitePool, id: i64, status: &str) -> Result<(), AppError> {
    repository::update_status(pool, id, status).await
}

pub async fn update_title(pool: &SqlitePool, id: i64, title: &str) -> Result<(), AppError> {
    repository::update_title(pool, id, title).await
}

pub async fn get_prd(pool: &SqlitePool, id: i64) -> Result<PrdResponse, AppError> {
    let prd = repository::get_prd(pool, id).await?;
    Ok(PrdResponse { prd })
}

pub async fn is_empty(pool: &SqlitePool, id: i64) -> Result<IsEmptyResponse, AppError> {
    let empty = repository::is_empty(pool, id).await?;
    Ok(IsEmptyResponse { empty })
}

pub async fn get_plan_with_phases(pool: &SqlitePool, feature_id: i64) -> Result<Option<PlanWithPhases>, AppError> {
    let result = repository::get_plan_with_phases(pool, feature_id).await?;
    Ok(result.map(|(plan, phases)| PlanWithPhases { plan, phases }))
}

pub async fn get_plan_progress(pool: &SqlitePool, feature_id: i64) -> Result<PlanProgress, AppError> {
    repository::get_plan_progress(pool, feature_id).await
}

pub async fn reset_phase(pool: &SqlitePool, phase_id: i64) -> Result<(), AppError> {
    repository::reset_phase(pool, phase_id).await
}

pub async fn override_phase_status(pool: &SqlitePool, phase_id: i64, status: &str) -> Result<(), AppError> {
    repository::override_phase_status(pool, phase_id, status).await
}

pub async fn get_feature_settings(pool: &SqlitePool, feature_id: i64) -> Result<Vec<FeatureSetting>, AppError> {
    repository::get_feature_settings(pool, feature_id).await
}

pub async fn set_feature_setting(pool: &SqlitePool, feature_id: i64, key: &str, value: &str) -> Result<(), AppError> {
    repository::set_feature_setting(pool, feature_id, key, value).await
}

pub async fn get_feature_model_settings(pool: &SqlitePool, feature_id: i64) -> Result<FeatureModelSettings, AppError> {
    repository::get_feature_model_settings(pool, feature_id).await
}

pub async fn set_feature_model_setting(
    pool: &SqlitePool,
    feature_id: i64,
    model_type: &str,
    model: &str,
) -> Result<(), AppError> {
    repository::set_feature_model_setting(pool, feature_id, model_type, model).await
}

pub async fn resolve_working_dir(
    pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
) -> Result<WorkingDirResponse, AppError> {
    let path = repository::resolve_working_dir(pool, feature_id, project_id).await?;
    Ok(WorkingDirResponse { path })
}

/// Delete a feature.
pub async fn delete_feature(
    write_pool: &SqlitePool,
    _read_pool: &SqlitePool,
    id: i64,
) -> Result<(), AppError> {
    repository::delete_feature(write_pool, id).await
}

pub async fn get_feature_snapshot(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<FeatureSnapshotResponse, AppError> {
    repository::get_feature_snapshot(pool, feature_id).await
}
