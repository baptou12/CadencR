use sqlx::SqlitePool;

/// Workspace setting key holding the last-used thinking effort for a given
/// provider/model pair. Mirrors the frontend helper in
/// `packages/desktop/src/shared/thinking-effort.ts`.
pub fn thinking_effort_model_key(provider_id: &str, model_id: &str) -> String {
    format!("thinking_effort_model_{provider_id}_{model_id}")
}

/// Columns that exist on both `features` and `projects` tables.
const SHARED_COLUMNS: &[&str] = &["model_session", "agent_runtime_session"];

/// Columns that only exist on the `projects` table.
const PROJECT_ONLY_COLUMNS: &[&str] = &["branch_prefix"];

async fn resolve_table_kv_setting(
    pool: &SqlitePool,
    table: &str,
    row_id: i64,
    key: &str,
) -> Option<String> {
    let (scope_id, kv_table) = match table {
        "features" => ("feature_id", "feature_settings"),
        "projects" => ("project_id", "project_settings"),
        _ => return None,
    };

    let sql = format!("SELECT value FROM {kv_table} WHERE {scope_id} = ? AND key = ? LIMIT 1");
    sqlx::query_scalar::<_, Option<String>>(&sql)
        .bind(row_id)
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .filter(|value| !value.is_empty())
}

async fn table_has_column(pool: &SqlitePool, table: &str, key: &str) -> bool {
    let sql = format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ? LIMIT 1");
    sqlx::query_scalar::<_, i64>(&sql)
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .is_some()
}

pub(crate) async fn resolve_table_column_setting(
    pool: &SqlitePool,
    table: &str,
    row_id: i64,
    key: &str,
) -> Option<String> {
    if !table_has_column(pool, table, key).await {
        return None;
    }

    let sql = format!(r#"SELECT "{key}" as v FROM {table} WHERE id = ?"#);
    if let Ok(Some((Some(v),))) = sqlx::query_as::<_, (Option<String>,)>(&sql)
        .bind(row_id)
        .fetch_optional(pool)
        .await
    {
        if !v.is_empty() {
            return Some(v);
        }
    }

    None
}

/// Resolve a setting using the cascade: feature column → project column → global EAV → default.
///
/// - For columns in `SHARED_COLUMNS`: feature → project → global → default.
/// - For columns in `PROJECT_ONLY_COLUMNS`: project → global → default.
/// - For anything else: global settings EAV table → default.
///
/// Only empty strings are treated as unset and fall through.
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
            if let Some(v) = resolve_table_column_setting(pool, "features", fid, key).await {
                return Some(v);
            }
        }
        if let Some(v) = resolve_table_kv_setting(pool, "features", fid, key).await {
            return Some(v);
        }
    }

    // 2. Project-level (real column)
    if let Some(pid) = project_id {
        if SHARED_COLUMNS.contains(&key) || PROJECT_ONLY_COLUMNS.contains(&key) {
            if let Some(v) = resolve_table_column_setting(pool, "projects", pid, key).await {
                return Some(v);
            }
        }
        if let Some(v) = resolve_table_kv_setting(pool, "projects", pid, key).await {
            return Some(v);
        }
    }

    // 3. Global settings (EAV table)
    if let Ok(Some(v)) = super::workspace::repository::get_setting(pool, key).await {
        if !v.is_empty() {
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
                model_session TEXT,
                agent_runtime_session TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                branch_prefix TEXT,
                model_session TEXT,
                agent_runtime_session TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE project_settings (project_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(project_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn test_feature_level_wins() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO projects (id, name, path, model_session) VALUES (1, 'p', '/tmp', 'project-model')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO features (id, project_id, title, model_session) VALUES (1, 1, 'f', 'feature-model')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = resolve_setting(
            &pool,
            "model_session",
            Some(1),
            Some(1),
            Some("default-model"),
        )
        .await;
        assert_eq!(result, Some("feature-model".to_string()));
    }

    #[tokio::test]
    async fn test_project_level_fallback() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO projects (id, name, path, model_session) VALUES (1, 'p', '/tmp', 'project-model')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool)
            .await
            .unwrap();

        let result = resolve_setting(
            &pool,
            "model_session",
            Some(1),
            Some(1),
            Some("default-model"),
        )
        .await;
        assert_eq!(result, Some("project-model".to_string()));
    }

    #[tokio::test]
    async fn test_global_fallback() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('model_session', 'global-model')")
            .execute(&pool)
            .await
            .unwrap();

        let result = resolve_setting(
            &pool,
            "model_session",
            Some(1),
            Some(1),
            Some("default-model"),
        )
        .await;
        assert_eq!(result, Some("global-model".to_string()));
    }

    #[tokio::test]
    async fn test_default_fallback() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool)
            .await
            .unwrap();

        let result = resolve_setting(
            &pool,
            "model_session",
            Some(1),
            Some(1),
            Some("default-model"),
        )
        .await;
        assert_eq!(result, Some("default-model".to_string()));
    }

    #[tokio::test]
    async fn test_feature_kv_fallback_supports_non_column_keys() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO project_settings (project_id, key, value) VALUES (1, 'bypass_acknowledged', 'medium')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (1, 'bypass_acknowledged', 'high')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = resolve_setting(&pool, "bypass_acknowledged", Some(1), Some(1), None).await;
        assert_eq!(result, Some("high".to_string()));
    }

    #[tokio::test]
    async fn test_default_value_is_not_special() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO projects (id, name, path, model_session) VALUES (1, 'p', '/tmp', 'default')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title, model_session) VALUES (1, 1, 'f', 'default')")
            .execute(&pool).await.unwrap();

        // "default" is a regular value, not a magic keyword — feature level wins
        let result = resolve_setting(
            &pool,
            "model_session",
            Some(1),
            Some(1),
            Some("default-model"),
        )
        .await;
        assert_eq!(result, Some("default".to_string()));
    }

    #[tokio::test]
    async fn test_project_only_column() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO projects (id, name, path, branch_prefix) VALUES (1, 'p', '/tmp', 'feature/')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = resolve_setting(&pool, "branch_prefix", None, Some(1), None).await;
        assert_eq!(result, Some("feature/".to_string()));
    }

    #[tokio::test]
    async fn test_missing_shared_column_falls_back_to_default() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                title TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE project_settings (project_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(project_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool)
            .await
            .unwrap();

        let result = resolve_setting(
            &pool,
            "agent_runtime_session",
            Some(1),
            Some(1),
            Some("claude_code"),
        )
        .await;

        assert_eq!(result, Some("claude_code".to_string()));
    }
}
