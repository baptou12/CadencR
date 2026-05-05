use sqlx::SqlitePool;

use super::models::{
    CreateFeatureResponse, Feature, FeatureModelSettings, FeatureProviderSettings, FeatureSetting,
    FeatureSnapshotResponse, IsEmptyResponse, PlanProgress, PlanWithPhases, PrdResponse,
    WorkingDirResponse,
};
use super::repository;
use crate::error::AppError;

pub async fn list_by_project(pool: &SqlitePool, project_id: i64) -> Result<Vec<Feature>, AppError> {
    repository::list_by_project(pool, project_id).await
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Feature>, AppError> {
    repository::get_by_id(pool, id).await
}

/// Create a feature row and persist worktree-mode preferences atomically so a
/// failed settings write cannot leave a partially configured feature behind.
/// Validation happens in the HTTP handler — this layer trusts its inputs.
pub async fn create_feature_with_worktree(
    pool: &SqlitePool,
    project_id: i64,
    title: Option<String>,
    type_: Option<String>,
    worktree_mode: Option<String>,
    reuse_branch: Option<String>,
) -> Result<CreateFeatureResponse, AppError> {
    let type_str = type_.as_deref().unwrap_or("ws-feature");
    let title = match title {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            let max_num = repository::get_max_session_num(pool, project_id).await?;
            format!("Session {}", max_num + 1)
        }
    };
    let mut tx = pool.begin().await?;
    let result = sqlx::query("INSERT INTO features (project_id, title, type) VALUES (?, ?, ?)")
        .bind(project_id)
        .bind(&title)
        .bind(type_str)
        .execute(&mut *tx)
        .await?;
    let id = result.last_insert_rowid();
    if let Some(mode) = worktree_mode.as_deref() {
        set_feature_setting_in_tx(&mut tx, id, "worktree_mode", mode).await?;
    }
    if let Some(branch) = reuse_branch.as_deref() {
        set_feature_setting_in_tx(&mut tx, id, "worktree_reuse_branch", branch).await?;
    }
    tx.commit().await?;
    Ok(CreateFeatureResponse { id })
}

async fn set_feature_setting_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    feature_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
    )
    .bind(feature_id)
    .bind(key)
    .bind(value)
    .execute(&mut **tx)
    .await?;
    Ok(())
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

pub async fn get_plan_with_phases(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<PlanWithPhases>, AppError> {
    let result = repository::get_plan_with_phases(pool, feature_id).await?;
    Ok(result.map(|(plan, phases)| PlanWithPhases { plan, phases }))
}

pub async fn get_plan_progress(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<PlanProgress, AppError> {
    repository::get_plan_progress(pool, feature_id).await
}

pub async fn reset_phase(pool: &SqlitePool, phase_id: i64) -> Result<(), AppError> {
    repository::reset_phase(pool, phase_id).await
}

pub async fn override_phase_status(
    pool: &SqlitePool,
    phase_id: i64,
    status: &str,
) -> Result<(), AppError> {
    repository::override_phase_status(pool, phase_id, status).await
}

pub async fn get_feature_settings(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<FeatureSetting>, AppError> {
    repository::get_feature_settings(pool, feature_id).await
}

pub async fn set_feature_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    repository::set_feature_setting(pool, feature_id, key, value).await
}

pub async fn get_feature_model_settings(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<FeatureModelSettings, AppError> {
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

pub async fn get_feature_provider_settings(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<FeatureProviderSettings, AppError> {
    repository::get_feature_provider_settings(pool, feature_id).await
}

pub async fn set_feature_provider_setting(
    pool: &SqlitePool,
    feature_id: i64,
    provider_type: &str,
    provider: &str,
) -> Result<(), AppError> {
    repository::set_feature_provider_setting(pool, feature_id, provider_type, provider).await
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

/// Resolve the working directory for a feature without requiring the caller to
/// know the `project_id`. Falls back to the project root if no worktree is set.
pub async fn get_feature_cwd(pool: &SqlitePool, feature_id: i64) -> Result<String, AppError> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(pool)
        .await?;
    let project_id = row
        .ok_or_else(|| AppError::NotFound(format!("feature {feature_id} not found")))?
        .0;
    let path = repository::resolve_working_dir(pool, feature_id, project_id).await?;
    path.ok_or_else(|| AppError::NotFound(format!("no working dir for feature {feature_id}")))
}
