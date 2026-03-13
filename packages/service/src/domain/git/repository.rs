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

/// Get feature type and project_id by feature ID.
pub async fn get_feature_type_and_project(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<(i64, String)>, AppError> {
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT project_id, type FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;
    Ok(row)
}

/// Get feature title by feature ID.
pub async fn get_feature_title(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT title FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, path TEXT, branch_prefix TEXT DEFAULT 'feature/')"
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT, status TEXT DEFAULT 'draft', type TEXT NOT NULL DEFAULT 'feature')"
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(feature_id, key))"
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_get_project_path_found() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'test', '/tmp/repo')")
            .execute(&pool).await.unwrap();

        let path = get_project_path(&pool, 1).await.unwrap();
        assert_eq!(path, "/tmp/repo");
    }

    #[tokio::test]
    async fn test_get_project_path_not_found() {
        let pool = setup_test_db().await;
        let result = get_project_path(&pool, 9999).await;
        assert!(matches!(result, Err(AppError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_get_set_delete_feature_setting() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'test', '/tmp')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        // Initially missing
        let val = get_feature_setting(&pool, 1, "worktree_path").await.unwrap();
        assert!(val.is_none());

        // Set
        set_feature_setting(&pool, 1, "worktree_path", "/tmp/wt").await.unwrap();
        let val = get_feature_setting(&pool, 1, "worktree_path").await.unwrap();
        assert_eq!(val, Some("/tmp/wt".into()));

        // Update
        set_feature_setting(&pool, 1, "worktree_path", "/tmp/wt2").await.unwrap();
        let val = get_feature_setting(&pool, 1, "worktree_path").await.unwrap();
        assert_eq!(val, Some("/tmp/wt2".into()));

        // Delete
        delete_feature_setting(&pool, 1, "worktree_path").await.unwrap();
        let val = get_feature_setting(&pool, 1, "worktree_path").await.unwrap();
        assert!(val.is_none());
    }

    #[tokio::test]
    async fn test_get_feature_setting_missing() {
        let pool = setup_test_db().await;
        let val = get_feature_setting(&pool, 999, "nonexistent").await.unwrap();
        assert_eq!(val, None);
    }

    #[tokio::test]
    async fn test_get_worktree_paths() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'test', '/tmp')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool).await.unwrap();

        set_feature_setting(&pool, 1, "worktree_path", "/tmp/wt").await.unwrap();
        set_feature_setting(&pool, 1, "worktree_branch", "feature/test").await.unwrap();
        set_feature_setting(&pool, 1, "worktree_original_branch", "main").await.unwrap();

        let paths = get_worktree_paths(&pool, 1).await.unwrap();
        assert_eq!(paths.worktree_path, Some("/tmp/wt".into()));
        assert_eq!(paths.worktree_branch, Some("feature/test".into()));
        assert_eq!(paths.worktree_original_branch, Some("main".into()));
    }
}
