use sqlx::SqlitePool;

use crate::error::AppError;
use super::super::models::QueueItem;

pub async fn insert_queue_item(
    pool: &SqlitePool,
    feature_id: i64,
    workflow_type: &str,
    item_type: &str,
    phase_id: Option<i64>,
    status: &str,
    order_index: i64,
    group_index: Option<i64>,
) -> Result<i64, AppError> {
    let result = sqlx::query(
        r#"INSERT INTO workflow_queue (feature_id, workflow_type, item_type, phase_id, status, order_index, group_index)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(feature_id)
    .bind(workflow_type)
    .bind(item_type)
    .bind(phase_id)
    .bind(status)
    .bind(order_index)
    .bind(group_index)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn insert_dependency(
    pool: &SqlitePool,
    queue_item_id: i64,
    depends_on_item_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO workflow_dependencies (queue_item_id, depends_on_item_id) VALUES (?, ?)",
    )
    .bind(queue_item_id)
    .bind(depends_on_item_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_queue_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<Vec<QueueItem>, AppError> {
    let rows = sqlx::query_as::<_, QueueItem>(
        "SELECT * FROM workflow_queue WHERE feature_id = ? ORDER BY order_index",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_ready_items(pool: &SqlitePool, feature_id: i64) -> Result<Vec<QueueItem>, AppError> {
    let rows = sqlx::query_as::<_, QueueItem>(
        "SELECT * FROM workflow_queue WHERE feature_id = ? AND status = 'ready' ORDER BY order_index",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn mark_item_running(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'running', started_at = datetime('now') WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_item_completed(pool: &SqlitePool, item_id: i64, result_json: Option<&str>) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'completed', result = ?, ended_at = datetime('now') WHERE id = ?")
        .bind(result_json)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_item_error(pool: &SqlitePool, item_id: i64, error_json: Option<&str>) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'error', result = ?, ended_at = datetime('now') WHERE id = ?")
        .bind(error_json)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_item_skipped(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'skipped', ended_at = datetime('now') WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_item_pid(pool: &SqlitePool, item_id: i64, pid: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET pid = ? WHERE id = ?")
        .bind(pid)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_queue_item(pool: &SqlitePool, item_id: i64) -> Result<Option<QueueItem>, AppError> {
    let item = sqlx::query_as::<_, QueueItem>("SELECT * FROM workflow_queue WHERE id = ?")
        .bind(item_id)
        .fetch_optional(pool)
        .await?;
    Ok(item)
}

pub async fn unblock_ready_items(pool: &SqlitePool, feature_id: i64) -> Result<Vec<QueueItem>, AppError> {
    // Atomically update blocked items whose dependencies are all completed/skipped
    sqlx::query(
        r#"UPDATE workflow_queue SET status = 'ready'
           WHERE feature_id = ? AND status = 'blocked'
           AND NOT EXISTS (
               SELECT 1 FROM workflow_dependencies d
               INNER JOIN workflow_queue dep ON dep.id = d.depends_on_item_id
               WHERE d.queue_item_id = workflow_queue.id AND dep.status NOT IN ('completed', 'skipped')
           )"#,
    )
    .bind(feature_id)
    .execute(pool)
    .await?;

    // Return the newly-ready items
    let items = sqlx::query_as::<_, QueueItem>(
        "SELECT * FROM workflow_queue WHERE feature_id = ? AND status = 'ready' ORDER BY order_index",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    Ok(items)
}

pub async fn clear_queue_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<(), AppError> {
    // Dependencies cascade on delete, but delete explicitly for clarity
    sqlx::query(
        "DELETE FROM workflow_dependencies WHERE queue_item_id IN (SELECT id FROM workflow_queue WHERE feature_id = ?)",
    )
    .bind(feature_id)
    .execute(pool)
    .await?;

    sqlx::query("DELETE FROM workflow_queue WHERE feature_id = ?")
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}
