//! Additional queue queries and bulk operations.
//!
//! Split from queue_repository.rs to keep files under 400 lines.

use sqlx::SqlitePool;

use crate::error::AppError;

pub async fn mark_item_paused(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'paused' WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_running_item_paused(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'paused', ended_at = datetime('now') WHERE id = ? AND status = 'running'")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_item_running_only(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'running' WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reset_item_for_retry(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'ready', started_at = NULL, ended_at = NULL, result = NULL WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_group_index(pool: &SqlitePool, item_id: i64) -> Result<Option<i64>, AppError> {
    let row: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT group_index FROM workflow_queue WHERE id = ?")
            .bind(item_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(g,)| g))
}

pub async fn set_item_agent_session(pool: &SqlitePool, item_id: i64, session_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET agent_session_id = ? WHERE id = ?")
        .bind(session_id)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn clear_agent_session(pool: &SqlitePool, session_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET agent_session_id = NULL WHERE agent_session_id = ?")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[allow(dead_code)]
pub async fn set_item_phase(pool: &SqlitePool, item_id: i64, phase_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET phase_id = ? WHERE id = ?")
        .bind(phase_id)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[allow(dead_code)]
pub async fn delete_item(pool: &SqlitePool, item_id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM workflow_queue WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_max_order_index(pool: &SqlitePool, feature_id: i64) -> Result<i64, AppError> {
    let val: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(order_index), 0) FROM workflow_queue WHERE feature_id = ?",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await?;
    Ok(val)
}

pub async fn get_max_group_index(pool: &SqlitePool, feature_id: i64) -> Result<i64, AppError> {
    let val: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(group_index), 0) FROM workflow_queue WHERE feature_id = ?",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await?;
    Ok(val)
}

pub async fn get_workflow_type_for_feature(pool: &SqlitePool, feature_id: i64) -> Result<Option<String>, AppError> {
    let val: Option<String> = sqlx::query_scalar(
        "SELECT workflow_type FROM workflow_queue WHERE feature_id = ? LIMIT 1",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;
    Ok(val)
}

pub async fn get_existing_phase_ids(pool: &SqlitePool, feature_id: i64) -> Result<Vec<i64>, AppError> {
    let rows: Vec<(Option<i64>,)> = sqlx::query_as(
        "SELECT phase_id FROM workflow_queue WHERE feature_id = ? AND phase_id IS NOT NULL",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().filter_map(|(id,)| id).collect())
}

pub async fn upgrade_draft_to_ready(pool: &SqlitePool, feature_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE workflow_queue SET status = 'ready' WHERE feature_id = ? AND status = 'draft'")
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_fix_item_ids_after_order(
    pool: &SqlitePool,
    feature_id: i64,
    after_order: i64,
) -> Result<Vec<i64>, AppError> {
    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT id FROM workflow_queue WHERE feature_id = ? AND order_index > ? AND item_type = 'execute' ORDER BY order_index",
    )
    .bind(feature_id)
    .bind(after_order)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

pub async fn get_paused_queue_items(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<(i64, Option<i64>, Option<String>)>, AppError> {
    let rows: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT wq.id, wq.agent_session_id, ags.claude_session_id \
         FROM workflow_queue wq \
         LEFT JOIN agent_sessions ags ON ags.id = wq.agent_session_id \
         WHERE wq.feature_id = ? AND wq.status = 'paused'",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_session_for_queue_item(
    pool: &SqlitePool,
    item_id: i64,
) -> Result<Option<(i64, Option<String>)>, AppError> {
    let row: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT ags.id, ags.claude_session_id FROM agent_sessions ags \
         INNER JOIN workflow_queue wq ON wq.agent_session_id = ags.id \
         WHERE wq.id = ? AND ags.status IN ('running', 'paused') \
         LIMIT 1",
    )
    .bind(item_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn get_max_order_index_nullable(pool: &SqlitePool, feature_id: i64) -> Result<Option<i64>, AppError> {
    let val: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(order_index) FROM workflow_queue WHERE feature_id = ?",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await?;
    Ok(val)
}

pub async fn get_max_group_index_nullable(pool: &SqlitePool, feature_id: i64) -> Result<Option<i64>, AppError> {
    let val: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(group_index) FROM workflow_queue WHERE feature_id = ?",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await?;
    Ok(val)
}
