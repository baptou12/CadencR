//! Settings + project lookups used across the worktree provisioning flow.

use sqlx::SqlitePool;

/// Look up the project_id for a given feature.
pub async fn get_project_id_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<i64, String> {
    sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            format!(
                "Failed to look up project for feature {}: {}",
                feature_id, e
            )
        })
}

/// Look up the project directory for a given project_id.
pub async fn get_project_directory(pool: &SqlitePool, project_id: i64) -> Result<String, String> {
    sqlx::query_scalar("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            format!(
                "Failed to look up directory for project {}: {}",
                project_id, e
            )
        })
}

pub async fn get_setting(pool: &SqlitePool, feature_id: i64, key: &str) -> Option<String> {
    sqlx::query_as::<_, (String,)>(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = ?",
    )
    .bind(feature_id)
    .bind(key)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|r| r.0)
}

pub async fn set_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
    value: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?)",
    )
    .bind(feature_id)
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|e| format!("DB error setting {key}: {e}"))?;
    Ok(())
}

/// Look up project path + name in one query — both the new and reuse paths
/// need them.
pub(super) async fn lookup_project(
    read_pool: &SqlitePool,
    project_id: i64,
) -> Result<(String, String), String> {
    sqlx::query_as::<_, (String, String)>("SELECT p.path, p.name FROM projects p WHERE p.id = ?")
        .bind(project_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("DB error looking up project: {e}"))?
        .ok_or_else(|| format!("Project {project_id} not found"))
}

/// Read the optional `worktree_base_branch` setting. Empty/whitespace values
/// are treated as unset so the caller falls back to project HEAD.
pub(super) async fn read_base_branch(read_pool: &SqlitePool, feature_id: i64) -> Option<String> {
    get_setting(read_pool, feature_id, "worktree_base_branch")
        .await
        .and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, \
             PRIMARY KEY (feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn read_base_branch_returns_none_when_unset() {
        let pool = make_pool().await;
        assert_eq!(read_base_branch(&pool, 1).await, None);
    }

    #[tokio::test]
    async fn read_base_branch_returns_trimmed_value_when_set() {
        let pool = make_pool().await;
        set_setting(&pool, 1, "worktree_base_branch", "  develop  ")
            .await
            .unwrap();
        assert_eq!(
            read_base_branch(&pool, 1).await,
            Some("develop".to_string())
        );
    }

    #[tokio::test]
    async fn read_base_branch_treats_blank_as_unset() {
        let pool = make_pool().await;
        set_setting(&pool, 1, "worktree_base_branch", "   ")
            .await
            .unwrap();
        assert_eq!(read_base_branch(&pool, 1).await, None);
    }
}
