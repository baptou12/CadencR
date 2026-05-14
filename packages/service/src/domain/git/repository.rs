use sqlx::SqlitePool;

use crate::error::AppError;

/// Get the filesystem path for a project by ID.
pub async fn get_project_path(pool: &SqlitePool, project_id: i64) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

    row.map(|r| r.0)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))
}

/// Get the project name for a project by ID.
pub async fn get_project_name(pool: &SqlitePool, project_id: i64) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT name FROM projects WHERE id = ?")
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

/// Get all feature_settings whose key starts with a given prefix.
#[allow(dead_code)]
pub async fn get_feature_settings_by_prefix(
    pool: &SqlitePool,
    feature_id: i64,
    prefix: &str,
) -> Result<Vec<(String, String)>, AppError> {
    let pattern = format!("{}%", prefix);
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM feature_settings WHERE feature_id = ? AND key LIKE ?",
    )
    .bind(feature_id)
    .bind(&pattern)
    .fetch_all(pool)
    .await?;
    Ok(rows)
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
    let row: Option<(String,)> = sqlx::query_as("SELECT title FROM features WHERE id = ?")
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
}

/// Per-feature worktree setting row for a project.
#[derive(Debug, sqlx::FromRow)]
pub struct FeatureWorktreeSettingRow {
    pub feature_id: i64,
    pub worktree_path: String,
    pub worktree_branch: Option<String>,
}

/// Return one row per feature in `project_id` that has a `worktree_path`
/// setting, regardless of feature status or whether the directory still
/// exists on disk. `worktree_branch` is joined in when present.
pub async fn list_feature_worktree_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<FeatureWorktreeSettingRow>, AppError> {
    let rows: Vec<FeatureWorktreeSettingRow> = sqlx::query_as(
        "SELECT f.id AS feature_id, \
                fs_path.value AS worktree_path, \
                fs_branch.value AS worktree_branch \
         FROM features f \
         JOIN feature_settings fs_path \
           ON fs_path.feature_id = f.id AND fs_path.key = 'worktree_path' \
         LEFT JOIN feature_settings fs_branch \
           ON fs_branch.feature_id = f.id AND fs_branch.key = 'worktree_branch' \
         WHERE f.project_id = ?",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn get_worktree_feature_lookup(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<WorktreeFeatureLookup>, AppError> {
    let rows: Vec<WorktreeFeatureLookup> = sqlx::query_as(
        "SELECT fs.value AS worktree_path, f.id AS feature_id, f.title AS feature_title \
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
            "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT, type TEXT NOT NULL DEFAULT 'ws-session')"
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
            .execute(&pool)
            .await
            .unwrap();

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
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();

        // Initially missing
        let val = get_feature_setting(&pool, 1, "worktree_path")
            .await
            .unwrap();
        assert!(val.is_none());

        // Set
        set_feature_setting(&pool, 1, "worktree_path", "/tmp/wt")
            .await
            .unwrap();
        let val = get_feature_setting(&pool, 1, "worktree_path")
            .await
            .unwrap();
        assert_eq!(val, Some("/tmp/wt".into()));

        // Update
        set_feature_setting(&pool, 1, "worktree_path", "/tmp/wt2")
            .await
            .unwrap();
        let val = get_feature_setting(&pool, 1, "worktree_path")
            .await
            .unwrap();
        assert_eq!(val, Some("/tmp/wt2".into()));

        // Delete
        delete_feature_setting(&pool, 1, "worktree_path")
            .await
            .unwrap();
        let val = get_feature_setting(&pool, 1, "worktree_path")
            .await
            .unwrap();
        assert!(val.is_none());
    }

    #[tokio::test]
    async fn test_get_feature_setting_missing() {
        let pool = setup_test_db().await;
        let val = get_feature_setting(&pool, 999, "nonexistent")
            .await
            .unwrap();
        assert_eq!(val, None);
    }

    #[tokio::test]
    async fn test_get_feature_settings_by_prefix() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();

        set_feature_setting(&pool, 1, "model_phase_plan", "sonnet")
            .await
            .unwrap();
        set_feature_setting(&pool, 1, "model_phase_execute", "haiku")
            .await
            .unwrap();
        set_feature_setting(&pool, 1, "worktree_branch", "feature/test")
            .await
            .unwrap();

        let results = get_feature_settings_by_prefix(&pool, 1, "model_phase_")
            .await
            .unwrap();
        assert_eq!(results.len(), 2);
        let map: std::collections::HashMap<_, _> = results.into_iter().collect();
        assert_eq!(map.get("model_phase_plan").unwrap(), "sonnet");
        assert_eq!(map.get("model_phase_execute").unwrap(), "haiku");
    }

    #[tokio::test]
    async fn test_get_feature_settings_by_prefix_empty() {
        let pool = setup_test_db().await;
        let results = get_feature_settings_by_prefix(&pool, 999, "model_phase_")
            .await
            .unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_list_feature_worktree_settings() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool)
            .await
            .unwrap();
        // Feature 1 has both path and branch. Feature 2 (same project) has
        // only a path. Feature 3 is in a different project and must be
        // filtered out. Feature 4 has no worktree settings and must not
        // appear even though it's in the target project.
        sqlx::query(
            "INSERT INTO features (id, project_id, title) VALUES \
             (1, 1, 'a'), \
             (2, 1, 'b'), \
             (3, 2, 'c'), \
             (4, 1, 'd')",
        )
        .execute(&pool)
        .await
        .unwrap();
        set_feature_setting(&pool, 1, "worktree_path", "/tmp/wt1")
            .await
            .unwrap();
        set_feature_setting(&pool, 1, "worktree_branch", "feature/a")
            .await
            .unwrap();
        set_feature_setting(&pool, 2, "worktree_path", "/tmp/wt2")
            .await
            .unwrap();
        set_feature_setting(&pool, 3, "worktree_path", "/tmp/wt3")
            .await
            .unwrap();

        let rows = list_feature_worktree_settings(&pool, 1).await.unwrap();
        let by_id: std::collections::HashMap<_, _> =
            rows.iter().map(|r| (r.feature_id, r)).collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(by_id[&1].worktree_path, "/tmp/wt1");
        assert_eq!(by_id[&1].worktree_branch.as_deref(), Some("feature/a"));
        // Archived feature still appears, and a missing branch is None.
        assert_eq!(by_id[&2].worktree_path, "/tmp/wt2");
        assert!(by_id[&2].worktree_branch.is_none());
    }
}
