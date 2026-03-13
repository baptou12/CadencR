use sqlx::SqlitePool;

use crate::domain::git::models::{FeatureRow, WorktreePaths};
use crate::error::AppError;

/// Get the filesystem path for a project by ID.
pub async fn get_project_path(pool: &SqlitePool, project_id: i64) -> Result<String, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT path FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    row.map(|r| r.0)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))
}

/// Get the project name for a project by ID.
pub async fn get_project_name(pool: &SqlitePool, project_id: i64) -> Result<String, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT name FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    row.map(|r| r.0)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))
}

/// Get the branch prefix for a project (defaults to "feature/").
pub async fn get_branch_prefix(pool: &SqlitePool, project_id: i64) -> Result<String, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT branch_prefix FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;

    Ok(row
        .and_then(|r| r.0)
        .unwrap_or_else(|| "feature/".to_string()))
}

/// Get a feature row by ID.
pub async fn get_feature(pool: &SqlitePool, feature_id: i64) -> Result<FeatureRow, AppError> {
    let row: Option<FeatureRow> =
        sqlx::query_as("SELECT id, project_id, status FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;

    row.ok_or_else(|| AppError::NotFound(format!("Feature not found: {feature_id}")))
}

/// Get a single feature_settings value.
pub async fn get_feature_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM feature_settings WHERE feature_id = ? AND key = ?")
            .bind(feature_id)
            .bind(key)
            .fetch_optional(pool)
            .await?;

    Ok(row.map(|r| r.0))
}

/// Set (upsert) a feature_settings value.
pub async fn set_feature_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) \
         ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
    )
    .bind(feature_id)
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete a feature_settings value.
pub async fn delete_feature_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM feature_settings WHERE feature_id = ? AND key = ?")
        .bind(feature_id)
        .bind(key)
        .execute(pool)
        .await?;

    Ok(())
}

/// Delete multiple feature_settings keys at once.
pub async fn delete_feature_settings(
    pool: &SqlitePool,
    feature_id: i64,
    keys: &[&str],
) -> Result<(), AppError> {
    for key in keys {
        delete_feature_setting(pool, feature_id, key).await?;
    }
    Ok(())
}

/// Fetch all worktree-related settings for a feature.
pub async fn get_worktree_paths(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<WorktreePaths, AppError> {
    let worktree_path = get_feature_setting(pool, feature_id, "worktree_path").await?;
    let worktree_branch = get_feature_setting(pool, feature_id, "worktree_branch").await?;
    let worktree_original_branch =
        get_feature_setting(pool, feature_id, "worktree_original_branch").await?;

    Ok(WorktreePaths {
        worktree_path,
        worktree_branch,
        worktree_original_branch,
    })
}

/// Lookup feature info for worktrees belonging to a project.
#[derive(Debug, sqlx::FromRow)]
pub struct WorktreeFeatureLookup {
    pub worktree_path: String,
    pub feature_id: i64,
    pub feature_title: String,
    pub feature_status: String,
}

pub async fn get_worktree_feature_lookup(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<WorktreeFeatureLookup>, AppError> {
    let rows: Vec<WorktreeFeatureLookup> = sqlx::query_as(
        "SELECT fs.value AS worktree_path, f.id AS feature_id, f.title AS feature_title, f.status AS feature_status \
         FROM feature_settings fs \
         JOIN features f ON f.id = fs.feature_id \
         WHERE fs.key = 'worktree_path' AND f.project_id = ?",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
