use sqlx::SqlitePool;

/// Columns that exist on both `features` and `projects` tables.
const SHARED_COLUMNS: &[&str] = &[
    "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
    "model_review-fixer", "model_session", "model_qa", "model_retro",
    "agent_autonomy", "parallel_execution",
];

/// Columns that only exist on the `projects` table.
const PROJECT_ONLY_COLUMNS: &[&str] = &["branch_prefix", "qa_prompt"];

/// Resolve a setting using the cascade: feature column → project column → global EAV → default.
///
/// - For columns in `SHARED_COLUMNS`: feature → project → global → default.
/// - For columns in `PROJECT_ONLY_COLUMNS`: project → global → default.
/// - For anything else: global settings EAV table → default.
///
/// The literal value `"default"` is treated as unset and falls through.
pub async fn resolve_setting(
    pool: &SqlitePool,
    key: &str,
    feature_id: Option<i64>,
    project_id: Option<i64>,
    default_value: Option<&str>,
) -> Option<String> {
    // 1. Feature-level (real column)
    if let Some(fid) = feature_id {
        if SHARED_COLUMNS.contains(&key) {
            let sql = format!(r#"SELECT "{key}" as v FROM features WHERE id = ?"#);
            if let Ok(Some((Some(v),))) = sqlx::query_as::<_, (Option<String>,)>(&sql)
                .bind(fid)
                .fetch_optional(pool)
                .await
            {
                if !v.is_empty() && v != "default" {
                    return Some(v);
                }
            }
        }
    }

    // 2. Project-level (real column)
    if let Some(pid) = project_id {
        if SHARED_COLUMNS.contains(&key) || PROJECT_ONLY_COLUMNS.contains(&key) {
            let sql = format!(r#"SELECT "{key}" as v FROM projects WHERE id = ?"#);
            if let Ok(Some((Some(v),))) = sqlx::query_as::<_, (Option<String>,)>(&sql)
                .bind(pid)
                .fetch_optional(pool)
                .await
            {
                if !v.is_empty() && v != "default" {
                    return Some(v);
                }
            }
        }
    }

    // 3. Global settings (EAV table)
    if let Ok(Some(v)) = super::workspace::repository::get_setting(pool, key).await {
        if !v.is_empty() && v != "default" {
            return Some(v);
        }
    }

    default_value.map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                title TEXT,
                agent_autonomy TEXT,
                parallel_execution TEXT,
                model_plan TEXT, model_prd TEXT, model_execute TEXT,
                model_risk TEXT, model_review TEXT, "model_review-fixer" TEXT,
                model_session TEXT, model_qa TEXT, model_retro TEXT
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                agent_autonomy TEXT,
                parallel_execution TEXT,
                branch_prefix TEXT,
                qa_prompt TEXT,
                model_plan TEXT, model_prd TEXT, model_execute TEXT,
                model_risk TEXT, model_review TEXT,
                model_session TEXT, model_qa TEXT, model_retro TEXT
            )"#,
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)",
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_feature_level_wins() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path, agent_autonomy) VALUES (1, 'p', '/tmp', '3')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, agent_autonomy) VALUES (1, 1, 'f', '1')")
            .execute(&pool).await.unwrap();

        let result = resolve_setting(&pool, "agent_autonomy", Some(1), Some(1), Some("3")).await;
        assert_eq!(result, Some("1".to_string()));
    }

    #[tokio::test]
    async fn test_project_level_fallback() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path, agent_autonomy) VALUES (1, 'p', '/tmp', '2')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool).await.unwrap();

        let result = resolve_setting(&pool, "agent_autonomy", Some(1), Some(1), Some("3")).await;
        assert_eq!(result, Some("2".to_string()));
    }

    #[tokio::test]
    async fn test_global_fallback() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('agent_autonomy', '2')")
            .execute(&pool).await.unwrap();

        let result = resolve_setting(&pool, "agent_autonomy", Some(1), Some(1), Some("3")).await;
        assert_eq!(result, Some("2".to_string()));
    }

    #[tokio::test]
    async fn test_default_fallback() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool).await.unwrap();

        let result = resolve_setting(&pool, "agent_autonomy", Some(1), Some(1), Some("1")).await;
        assert_eq!(result, Some("1".to_string()));
    }

    #[tokio::test]
    async fn test_default_value_treated_as_unset() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path, agent_autonomy) VALUES (1, 'p', '/tmp', 'default')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, agent_autonomy) VALUES (1, 1, 'f', 'default')")
            .execute(&pool).await.unwrap();

        let result = resolve_setting(&pool, "agent_autonomy", Some(1), Some(1), Some("1")).await;
        assert_eq!(result, Some("1".to_string()));
    }

    #[tokio::test]
    async fn test_project_only_column() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path, qa_prompt) VALUES (1, 'p', '/tmp', 'run tests')")
            .execute(&pool).await.unwrap();

        let result = resolve_setting(&pool, "qa_prompt", None, Some(1), None).await;
        assert_eq!(result, Some("run tests".to_string()));
    }
}
