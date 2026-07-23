use sqlx::SqlitePool;

use crate::domain::features::title::{is_default_title, MANUAL_TITLE_SETTING_KEY};
use crate::error::AppError;

/// A default-looking title remains eligible only until the user explicitly
/// renames it. The marker matters when a user deliberately chooses a title
/// such as "Session 42", which cannot be distinguished from a generated
/// placeholder by text alone.
pub async fn has_default_title(pool: &SqlitePool, feature_id: i64) -> Result<bool, AppError> {
    let row: Option<(String, bool)> = sqlx::query_as(
        "SELECT f.title,
                EXISTS(
                    SELECT 1 FROM feature_settings fs
                    WHERE fs.feature_id = f.id AND fs.key = ? AND fs.value = 'true'
                )
         FROM features f
         WHERE f.id = ?",
    )
    .bind(MANUAL_TITLE_SETTING_KEY)
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.is_some_and(|(title, manually_set)| !manually_set && is_default_title(&title)))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn title_pool(title: &str) -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::query("CREATE TABLE features (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (
                feature_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (feature_id, key)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO features (id, title) VALUES (1, ?)")
            .bind(title)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn manually_renamed_default_looking_title_is_not_eligible() {
        let pool = title_pool("Session 1").await;
        crate::domain::features::repository::update_title_manually(&pool, 1, "Session 42")
            .await
            .unwrap();
        assert!(!has_default_title(&pool, 1).await.unwrap());
    }

    #[tokio::test]
    async fn untouched_default_title_remains_eligible() {
        let pool = title_pool("Session 42").await;
        assert!(has_default_title(&pool, 1).await.unwrap());
    }
}
