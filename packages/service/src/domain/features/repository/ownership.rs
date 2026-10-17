use sqlx::SqlitePool;

use crate::error::AppError;

/// The project a feature belongs to; `NotFound` when the feature is gone.
pub async fn project_id_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("feature {feature_id} not found")))
}
