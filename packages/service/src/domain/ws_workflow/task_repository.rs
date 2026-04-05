use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::WorkflowTask;

pub async fn insert_task(
    pool: &SqlitePool,
    feature_id: i64,
    source_phase_slug: &str,
    title: &str,
    description: &str,
    commit_message: &str,
    order_index: i32,
    parallel_group: i32,
    depends_on: &[String],
) -> Result<i64, AppError> {
    let depends_json = serde_json::to_string(depends_on)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let id = sqlx::query(
        "INSERT INTO workflow_tasks \
         (feature_id, source_phase_slug, title, description, commit_message, \
          order_index, parallel_group, depends_on) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(feature_id)
    .bind(source_phase_slug)
    .bind(title)
    .bind(description)
    .bind(commit_message)
    .bind(order_index)
    .bind(parallel_group)
    .bind(&depends_json)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .last_insert_rowid();

    Ok(id)
}

pub async fn list_tasks(
    pool: &SqlitePool,
    feature_id: i64,
    source_phase_slug: &str,
) -> Result<Vec<WorkflowTask>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, String, String, i32, i32, String, String)>(
        "SELECT id, feature_id, source_phase_slug, title, description, commit_message, \
         order_index, parallel_group, depends_on, status \
         FROM workflow_tasks WHERE feature_id = ? AND source_phase_slug = ? ORDER BY order_index",
    )
    .bind(feature_id)
    .bind(source_phase_slug)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let depends_on: Vec<String> =
                serde_json::from_str(&r.8).unwrap_or_default();
            WorkflowTask {
                id: r.0,
                feature_id: r.1,
                source_phase_slug: r.2,
                title: r.3,
                description: r.4,
                commit_message: r.5,
                order_index: r.6,
                parallel_group: r.7,
                depends_on,
                status: r.9,
            }
        })
        .collect())
}

pub async fn count_tasks(
    pool: &SqlitePool,
    feature_id: i64,
    source_phase_slug: &str,
) -> Result<i64, AppError> {
    let (count,) = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*) FROM workflow_tasks WHERE feature_id = ? AND source_phase_slug = ?",
    )
    .bind(feature_id)
    .bind(source_phase_slug)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(count)
}

pub async fn finalize_tasks(
    pool: &SqlitePool,
    feature_id: i64,
    source_phase_slug: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE workflow_tasks SET status = 'pending' \
         WHERE feature_id = ? AND source_phase_slug = ? AND status = 'draft'",
    )
    .bind(feature_id)
    .bind(source_phase_slug)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}
