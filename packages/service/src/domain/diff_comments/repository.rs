use sqlx::SqlitePool;

use super::models::*;
use crate::error::AppError;

// ---- Diff Comments ----

pub async fn list_by_feature(pool: &SqlitePool, feature_id: i64) -> Result<Vec<DiffComment>, AppError> {
    let rows: Vec<(i64, i64, String, i64, String, String, String, String)> = sqlx::query_as(
        "SELECT id, feature_id, file_path, line_number, side, content, status, created_at
         FROM diff_comments WHERE feature_id = ? ORDER BY file_path, line_number ASC",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, feature_id, file_path, line_number, side, content, status, created_at)| DiffComment {
            id,
            feature_id,
            file_path,
            line_number,
            side,
            content,
            status,
            created_at,
        })
        .collect())
}

pub async fn create(pool: &SqlitePool, req: &CreateDiffCommentRequest) -> Result<DiffComment, AppError> {
    let id = sqlx::query(
        "INSERT INTO diff_comments (feature_id, file_path, line_number, side, content, status)
         VALUES (?, ?, ?, ?, ?, 'pending')",
    )
    .bind(req.feature_id)
    .bind(&req.file_path)
    .bind(req.line_number)
    .bind(&req.side)
    .bind(&req.content)
    .execute(pool)
    .await?
    .last_insert_rowid();

    let row: (i64, i64, String, i64, String, String, String, String) = sqlx::query_as(
        "SELECT id, feature_id, file_path, line_number, side, content, status, created_at
         FROM diff_comments WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(DiffComment {
        id: row.0,
        feature_id: row.1,
        file_path: row.2,
        line_number: row.3,
        side: row.4,
        content: row.5,
        status: row.6,
        created_at: row.7,
    })
}

pub async fn update(pool: &SqlitePool, id: i64, content: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE diff_comments SET content = ? WHERE id = ?")
        .bind(content)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM diff_comments WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_as_sent(pool: &SqlitePool, feature_id: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "UPDATE diff_comments SET status = 'sent' WHERE feature_id = ? AND status = 'pending'",
    )
    .bind(feature_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

pub async fn delete_pending(pool: &SqlitePool, feature_id: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "DELETE FROM diff_comments WHERE feature_id = ? AND status = 'pending'",
    )
    .bind(feature_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// ---- Diff Viewed ----

pub async fn list_viewed_by_feature(pool: &SqlitePool, feature_id: i64) -> Result<Vec<DiffViewedFile>, AppError> {
    let rows: Vec<(i64, i64, String, String, String)> = sqlx::query_as(
        "SELECT id, feature_id, file_path, blob_sha, viewed_at
         FROM diff_viewed_files WHERE feature_id = ? ORDER BY file_path ASC",
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, feature_id, file_path, blob_sha, viewed_at)| DiffViewedFile {
            id,
            feature_id,
            file_path,
            blob_sha,
            viewed_at,
        })
        .collect())
}

pub async fn mark_viewed(pool: &SqlitePool, feature_id: i64, file_path: &str, blob_sha: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO diff_viewed_files (feature_id, file_path, blob_sha, viewed_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(feature_id, file_path) DO UPDATE SET blob_sha = excluded.blob_sha, viewed_at = excluded.viewed_at",
    )
    .bind(feature_id)
    .bind(file_path)
    .bind(blob_sha)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn unmark_viewed(pool: &SqlitePool, feature_id: i64, file_path: &str) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM diff_viewed_files WHERE feature_id = ? AND file_path = ?",
    )
    .bind(feature_id)
    .bind(file_path)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_all_viewed(pool: &SqlitePool, feature_id: i64) -> Result<u64, AppError> {
    let result = sqlx::query(
        "DELETE FROM diff_viewed_files WHERE feature_id = ?",
    )
    .bind(feature_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
