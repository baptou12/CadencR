use serde::Deserialize;

use crate::error::AppError;

#[derive(Debug, Deserialize, sqlx::FromRow)]
pub(super) struct QueuedMessage {
    pub id: i64,
    pub source_session_id: Option<i64>,
    pub content: String,
    pub message_uuid: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct EnqueuedMessage {
    pub id: i64,
    pub inserted: bool,
}

pub(super) async fn claim_next_message(
    pool: &sqlx::SqlitePool,
    target_session_id: i64,
) -> Result<Option<QueuedMessage>, AppError> {
    Ok(sqlx::query_as(
        "UPDATE agent_session_message_queue
         SET status = 'delivering', error = NULL
         WHERE id = (
             SELECT id
             FROM agent_session_message_queue
             WHERE target_session_id = ? AND status = 'pending'
             ORDER BY id ASC
             LIMIT 1
         )
         RETURNING id, source_session_id, content, message_uuid",
    )
    .bind(target_session_id)
    .fetch_optional(pool)
    .await?)
}

pub(crate) async fn enqueue_message(
    pool: &sqlx::SqlitePool,
    target_session_id: i64,
    source_session_id: Option<i64>,
    content: &str,
    message_uuid: uuid::Uuid,
) -> Result<EnqueuedMessage, AppError> {
    let message_uuid = message_uuid.to_string();
    let inserted = sqlx::query_as::<_, QueueIdentityRow>(
        "INSERT INTO agent_session_message_queue
         (target_session_id, source_session_id, content, status, message_uuid)
         VALUES (?, ?, ?, 'pending', ?)
         ON CONFLICT(target_session_id, message_uuid) WHERE message_uuid IS NOT NULL DO NOTHING
         RETURNING id, source_session_id, content, status",
    )
    .bind(target_session_id)
    .bind(source_session_id)
    .bind(content)
    .bind(&message_uuid)
    .fetch_optional(pool)
    .await?;
    if let Some(row) = inserted {
        return Ok(EnqueuedMessage {
            id: row.id,
            inserted: true,
        });
    }
    let existing = sqlx::query_as::<_, QueueIdentityRow>(
        "SELECT id, source_session_id, content, status
         FROM agent_session_message_queue
         WHERE target_session_id = ? AND message_uuid = ?",
    )
    .bind(target_session_id)
    .bind(&message_uuid)
    .fetch_one(pool)
    .await?;
    validate_existing_identity(
        &existing,
        target_session_id,
        source_session_id,
        content,
        &message_uuid,
    )?;
    retry_errored_identity(pool, &existing, &message_uuid).await?;
    Ok(EnqueuedMessage {
        id: existing.id,
        inserted: false,
    })
}

fn validate_existing_identity(
    existing: &QueueIdentityRow,
    target_session_id: i64,
    source_session_id: Option<i64>,
    content: &str,
    message_uuid: &str,
) -> Result<(), AppError> {
    if existing.content != content || existing.source_session_id != source_session_id {
        return Err(AppError::Conflict(format!(
            "queued message UUID {message_uuid} already has different content or provenance in session {target_session_id}"
        )));
    }
    if existing.status == "cancelled" {
        return Err(AppError::Conflict(format!(
            "queued message UUID {message_uuid} was cancelled; submit a new message identity to enqueue it again"
        )));
    }
    Ok(())
}

async fn retry_errored_identity(
    pool: &sqlx::SqlitePool,
    existing: &QueueIdentityRow,
    message_uuid: &str,
) -> Result<(), AppError> {
    if existing.status != "error" {
        return Ok(());
    }
    sqlx::query(
        "UPDATE agent_session_message_queue
         SET status = 'pending', delivered_at = NULL, error = NULL
         WHERE id = ? AND status = 'error' AND message_uuid = ?",
    )
    .bind(existing.id)
    .bind(message_uuid)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct QueueIdentityRow {
    id: i64,
    source_session_id: Option<i64>,
    content: String,
    status: String,
}

pub(super) fn queued_message_uuid(message: &QueuedMessage) -> Result<uuid::Uuid, AppError> {
    match message.message_uuid.as_deref() {
        Some(value) => uuid::Uuid::parse_str(value).map_err(|_| {
            AppError::Internal(format!(
                "queued message {} has an invalid canonical UUID",
                message.id
            ))
        }),
        None => Ok(uuid::Uuid::new_v5(
            &uuid::Uuid::NAMESPACE_URL,
            format!("cadencr:legacy-queued-message:{}", message.id).as_bytes(),
        )),
    }
}

pub(super) async fn mark_delivered(pool: &sqlx::SqlitePool, id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE agent_session_message_queue
         SET status = 'delivered', delivered_at = datetime('now'), error = NULL
         WHERE id = ? AND status = 'delivering'",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn mark_error(
    pool: &sqlx::SqlitePool,
    id: i64,
    error: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE agent_session_message_queue
         SET status = 'error', error = ?
         WHERE id = ? AND status = 'delivering'",
    )
    .bind(error)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
pub(super) async fn seed_queue_fixture(pool: &sqlx::SqlitePool) {
    sqlx::query("INSERT INTO projects (id, name, path) VALUES (7, 'Proj', '/tmp/proj')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO features (id, project_id, title, status, type)
         VALUES (42, 7, 'Source', 'active', 'ws-session'),
                (43, 7, 'Target', 'active', 'ws-session')",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, runtime_provider)
         VALUES (777, 42, 'session', 'completed', 'missing_provider'),
                (888, 43, 'session', 'completed', 'missing_provider')",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_session_message_queue
         (id, target_session_id, source_session_id, content, status)
         VALUES (1, 888, 777, 'Queued work item', 'pending')",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::migrate::{run_migrations, MigrationContext};

    async fn queue_pool() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        seed_queue_fixture(&pool).await;
        pool
    }

    #[tokio::test]
    async fn claim_next_message_marks_row_delivering_atomically() {
        let pool = queue_pool().await;

        let first = claim_next_message(&pool, 888).await.unwrap();
        let second = claim_next_message(&pool, 888).await.unwrap();

        assert!(first.is_some());
        assert!(second.is_none());
        let status: String =
            sqlx::query_scalar("SELECT status FROM agent_session_message_queue WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "delivering");
    }

    #[tokio::test]
    async fn enqueue_message_reuses_the_same_uuid_without_a_second_row() {
        let pool = queue_pool().await;
        let message_uuid = uuid::Uuid::new_v4();

        let first = enqueue_message(&pool, 888, Some(777), "same", message_uuid)
            .await
            .unwrap();
        let retry = enqueue_message(&pool, 888, Some(777), "same", message_uuid)
            .await
            .unwrap();

        assert!(first.inserted);
        assert!(!retry.inserted);
        assert_eq!(first.id, retry.id);
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_session_message_queue WHERE message_uuid = ?",
        )
        .bind(message_uuid.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn enqueue_retry_moves_an_errored_identity_back_to_pending() {
        let pool = queue_pool().await;
        let message_uuid = uuid::Uuid::new_v4();
        let first = enqueue_message(&pool, 888, Some(777), "retry queued", message_uuid)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE agent_session_message_queue
             SET status = 'error', error = 'temporary failure' WHERE id = ?",
        )
        .bind(first.id)
        .execute(&pool)
        .await
        .unwrap();

        let retry = enqueue_message(&pool, 888, Some(777), "retry queued", message_uuid)
            .await
            .unwrap();

        assert!(!retry.inserted);
        assert_eq!(retry.id, first.id);
        let state: (String, Option<String>) =
            sqlx::query_as("SELECT status, error FROM agent_session_message_queue WHERE id = ?")
                .bind(first.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(state, ("pending".to_string(), None));
    }
}
