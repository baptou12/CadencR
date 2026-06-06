use sqlx::{Row, SqlitePool};

use super::super::models::{Feature, FeatureStatus};
use crate::error::AppError;

const FEATURE_COLUMNS: &str = r#"id, project_id, title, status,
           COALESCE(type, 'ws-session') as type_, label,
           model_session,
           COALESCE(created_at, datetime('now')) as created_at"#;

pub async fn list_by_project(
    pool: &SqlitePool,
    project_id: i64,
    include_archived: bool,
) -> Result<Vec<Feature>, AppError> {
    let status_filter = if include_archived {
        ""
    } else {
        " AND status = 'active'"
    };
    // Order conversations by the most recent *user* message in any of their
    // sessions, falling back to the feature creation time when none exists.
    let sql = format!(
        "SELECT {FEATURE_COLUMNS} \
         FROM features f \
         LEFT JOIN ( \
             SELECT s.feature_id AS feature_id, MAX(m.created_at) AS last_user_at \
             FROM agent_sessions s \
             JOIN agent_messages m ON m.session_id = s.id AND m.role = 'user' \
             GROUP BY s.feature_id \
         ) ua ON ua.feature_id = f.id \
         WHERE f.project_id = ?{status_filter} \
         ORDER BY datetime(COALESCE(ua.last_user_at, f.created_at)) DESC, f.id DESC"
    );
    let rows = sqlx::query_as::<_, Feature>(&sql)
        .bind(project_id)
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Feature>, AppError> {
    let sql = format!("SELECT {FEATURE_COLUMNS} FROM features WHERE id = ?");
    let row = sqlx::query_as::<_, Feature>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

#[allow(dead_code)]
pub async fn create_feature(
    pool: &SqlitePool,
    project_id: i64,
    title: &str,
    type_: &str,
) -> Result<i64, AppError> {
    let result = sqlx::query(
        "INSERT INTO features (project_id, title, status, type) VALUES (?, ?, 'active', ?)",
    )
    .bind(project_id)
    .bind(title)
    .bind(type_)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn get_max_session_num(pool: &SqlitePool, project_id: i64) -> Result<i64, AppError> {
    let row: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) FROM features WHERE project_id = ? AND title LIKE 'Session %'",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.0).unwrap_or(0))
}

async fn clear_agent_session_pins(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    feature_id: i64,
) -> Result<(), AppError> {
    if !agent_sessions_has_pin_column(&mut **tx).await? {
        return Ok(());
    }

    sqlx::query("UPDATE agent_sessions SET is_pinned = 0 WHERE feature_id = ?")
        .bind(feature_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn agent_sessions_has_pin_column(
    executor: &mut sqlx::SqliteConnection,
) -> Result<bool, AppError> {
    let rows = sqlx::query(r#"PRAGMA table_info("agent_sessions")"#)
        .fetch_all(executor)
        .await?;
    for row in rows {
        let name: String = row.try_get("name")?;
        if name == "is_pinned" {
            return Ok(true);
        }
    }
    Ok(false)
}

pub async fn update_title(pool: &SqlitePool, id: i64, title: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE features SET title = ? WHERE id = ?")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_status(
    pool: &SqlitePool,
    id: i64,
    status: FeatureStatus,
) -> Result<(), AppError> {
    let result = sqlx::query("UPDATE features SET status = ? WHERE id = ?")
        .bind(status.as_str())
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("feature {id} not found")));
    }
    Ok(())
}

pub async fn update_label(pool: &SqlitePool, id: i64, label: Option<&str>) -> Result<(), AppError> {
    let result = sqlx::query("UPDATE features SET label = ? WHERE id = ?")
        .bind(label)
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("feature {id} not found")));
    }
    Ok(())
}

pub async fn is_empty(pool: &SqlitePool, id: i64) -> Result<bool, AppError> {
    let feature_exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM features WHERE id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    if feature_exists.is_none() {
        return Ok(true);
    }

    let message_exists: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM agent_messages WHERE session_id IN \
         (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(message_exists.is_none())
}

pub async fn resolve_working_dir(
    pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
) -> Result<Option<String>, AppError> {
    let feature_row: Option<(String,)> =
        sqlx::query_as("SELECT COALESCE(type, 'ws-session') FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;

    if feature_row.is_some() {
        let setting: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .bind(feature_id)
        .fetch_optional(pool)
        .await?;
        if let Some((path,)) = setting {
            return Ok(Some(path));
        }
    }

    let project_path: Option<(String,)> = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    Ok(project_path.map(|r| r.0))
}

pub async fn delete_feature(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // Clear pinned-session bookkeeping (no-op when the column doesn't exist).
    clear_agent_session_pins(&mut tx, id).await?;

    // Delete session children, then sessions.
    sqlx::query(
        "DELETE FROM session_runtime_ids WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM feature_settings WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM diff_comments WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM diff_viewed_files WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM features WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::super::models::FeatureStatus;
    use super::*;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                label TEXT,
                type TEXT NOT NULL DEFAULT 'ws-session',
                model_session TEXT,
                created_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY,
                feature_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY,
                session_id INTEGER NOT NULL,
                role TEXT,
                created_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn get_by_id_returns_feature() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type) VALUES (1, 1, 'f', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let f = get_by_id(&pool, 1).await.unwrap().unwrap();
        assert_eq!(f.title, "f");
        assert_eq!(f.type_, "ws-session");
    }

    #[tokio::test]
    async fn list_by_project_hides_archived_features() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type) VALUES \
             (1, 1, 'active', 'active', 'ws-session'), \
             (2, 1, 'hidden', 'archived', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let features = list_by_project(&pool, 1, false).await.unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].id, 1);
        assert_eq!(features[0].status, FeatureStatus::Active);
    }

    #[tokio::test]
    async fn list_by_project_can_include_archived_features() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type, created_at) VALUES \
             (1, 1, 'active', 'active', 'ws-session', '2026-01-01T00:00:00Z'), \
             (2, 1, 'archived', 'archived', 'ws-session', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let features = list_by_project(&pool, 1, true).await.unwrap();
        let statuses: Vec<FeatureStatus> = features.iter().map(|feature| feature.status).collect();
        assert_eq!(features.len(), 2);
        assert_eq!(
            statuses,
            vec![FeatureStatus::Archived, FeatureStatus::Active]
        );
    }

    #[tokio::test]
    async fn list_by_project_orders_by_latest_user_message() {
        let pool = setup_pool().await;
        // Feature 1 is created first but its only user message is older.
        // Feature 2 is created later and has the newest user message, so it
        // must sort first. An assistant message on feature 1 is newer than
        // everything but must be ignored.
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type, created_at) VALUES \
             (1, 1, 'older', 'active', 'ws-session', '2026-01-01T00:00:00Z'), \
             (2, 1, 'newer', 'active', 'ws-session', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_sessions (id, feature_id, status) VALUES (10, 1, 'paused'), (20, 2, 'paused')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_messages (session_id, role, created_at) VALUES \
             (10, 'user', '2026-02-01T00:00:00Z'), \
             (20, 'user', '2026-03-01T00:00:00Z'), \
             (10, 'assistant', '2026-04-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let features = list_by_project(&pool, 1, false).await.unwrap();
        let ids: Vec<i64> = features.iter().map(|f| f.id).collect();
        assert_eq!(ids, vec![2, 1]);
    }

    #[tokio::test]
    async fn get_by_id_missing_returns_none() {
        let pool = setup_pool().await;
        assert!(get_by_id(&pool, 99).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn is_empty_returns_true_when_ws_session_has_no_messages() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type) VALUES \
             (1, 1, 'empty', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (10, 1, 'paused')")
            .execute(&pool)
            .await
            .unwrap();

        assert!(is_empty(&pool, 1).await.unwrap());
    }

    #[tokio::test]
    async fn is_empty_returns_false_when_ws_session_has_messages() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type) VALUES \
             (1, 1, 'non-empty', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (10, 1, 'paused')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_messages (session_id) VALUES (10)")
            .execute(&pool)
            .await
            .unwrap();

        assert!(!is_empty(&pool, 1).await.unwrap());
    }
}
