//! User-added Claude Code models, merged into the live catalog.

use sqlx::SqlitePool;

use crate::domain::agents::runtime::ModelCatalogEntry;
use crate::error::AppError;

fn validate_model_id(model_id: &str) -> Result<(), AppError> {
    if model_id.trim().is_empty() {
        return Err(AppError::BadRequest(
            "custom model id must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn validate_label(label: &str) -> Result<(), AppError> {
    if label.trim().is_empty() {
        return Err(AppError::BadRequest(
            "custom model label must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn row_to_entry(model_id: String, label: String, description: Option<String>) -> ModelCatalogEntry {
    ModelCatalogEntry {
        id: model_id,
        label,
        description,
        supports_effort: None,
        supported_effort_levels: None,
        supports_adaptive_thinking: None,
        supports_fast_mode: None,
        supports_auto_mode: None,
    }
}

pub async fn list_custom_models(pool: &SqlitePool) -> Result<Vec<ModelCatalogEntry>, AppError> {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT model_id, label, description FROM claude_code_custom_models ORDER BY model_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(model_id, label, description)| row_to_entry(model_id, label, description))
        .collect())
}

pub async fn upsert_custom_model(
    pool: &SqlitePool,
    model_id: &str,
    label: &str,
    description: Option<&str>,
) -> Result<ModelCatalogEntry, AppError> {
    validate_model_id(model_id)?;
    validate_label(label)?;
    sqlx::query(
        "INSERT INTO claude_code_custom_models (model_id, label, description) VALUES (?, ?, ?) \
         ON CONFLICT(model_id) DO UPDATE SET label = excluded.label, description = excluded.description",
    )
    .bind(model_id)
    .bind(label)
    .bind(description)
    .execute(pool)
    .await?;
    Ok(row_to_entry(
        model_id.to_string(),
        label.to_string(),
        description.map(str::to_string),
    ))
}

pub async fn delete_custom_model(pool: &SqlitePool, model_id: &str) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM claude_code_custom_models WHERE model_id = ?")
        .bind(model_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "custom model '{model_id}' not found"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE claude_code_custom_models (\
                id INTEGER PRIMARY KEY, \
                model_id TEXT NOT NULL UNIQUE, \
                label TEXT NOT NULL, \
                description TEXT, \
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn upsert_and_list_roundtrip() {
        let pool = setup().await;
        upsert_custom_model(
            &pool,
            "claude-sonnet-3-5",
            "Sonnet 3.5 (legacy)",
            Some("older model via proxy"),
        )
        .await
        .unwrap();

        let models = list_custom_models(&pool).await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "claude-sonnet-3-5");
        assert_eq!(models[0].label, "Sonnet 3.5 (legacy)");
        assert_eq!(
            models[0].description.as_deref(),
            Some("older model via proxy")
        );
        // Capability flags default to None.
        assert!(models[0].supports_effort.is_none());
    }

    #[tokio::test]
    async fn upsert_replaces_existing_entry() {
        let pool = setup().await;
        upsert_custom_model(&pool, "m1", "Old", None).await.unwrap();
        upsert_custom_model(&pool, "m1", "New", Some("d"))
            .await
            .unwrap();
        let models = list_custom_models(&pool).await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].label, "New");
        assert_eq!(models[0].description.as_deref(), Some("d"));
    }

    #[tokio::test]
    async fn upsert_rejects_empty_fields() {
        let pool = setup().await;
        let err = upsert_custom_model(&pool, "   ", "label", None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
        let err = upsert_custom_model(&pool, "m1", "  ", None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[tokio::test]
    async fn delete_removes_entry() {
        let pool = setup().await;
        upsert_custom_model(&pool, "m1", "M1", None).await.unwrap();
        delete_custom_model(&pool, "m1").await.unwrap();
        assert!(list_custom_models(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_missing_is_not_found() {
        let pool = setup().await;
        let err = delete_custom_model(&pool, "m1").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
