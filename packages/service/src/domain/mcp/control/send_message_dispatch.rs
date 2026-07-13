use crate::error::AppError;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ImmediateDispatchClaim {
    Claimed { token: String },
    InProgress,
    Dispatched,
}

pub(super) async fn claim_immediate_dispatch(
    pool: &sqlx::SqlitePool,
    message_id: i64,
) -> Result<ImmediateDispatchClaim, AppError> {
    let token = uuid::Uuid::new_v4().to_string();
    let claimed: Option<String> = sqlx::query_scalar(
        "UPDATE agent_message_dispatches
         SET status = 'dispatching', attempt_count = attempt_count + 1,
             claim_token = ?, claimed_at = datetime('now'), error = NULL,
             updated_at = datetime('now')
         WHERE message_id = ? AND status IN ('pending', 'error')
         RETURNING claim_token",
    )
    .bind(&token)
    .bind(message_id)
    .fetch_optional(pool)
    .await?;
    if claimed.is_some() {
        return Ok(ImmediateDispatchClaim::Claimed { token });
    }

    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM agent_message_dispatches WHERE message_id = ?")
            .bind(message_id)
            .fetch_optional(pool)
            .await?;
    match status.as_deref() {
        Some("dispatching") => Ok(ImmediateDispatchClaim::InProgress),
        Some("dispatched") => Ok(ImmediateDispatchClaim::Dispatched),
        Some(other) => Err(AppError::Internal(format!(
            "message {message_id} has an unclaimable dispatch status '{other}'"
        ))),
        None => Err(AppError::Internal(format!(
            "message {message_id} has no dispatch lifecycle"
        ))),
    }
}

pub(super) async fn mark_immediate_dispatch_succeeded(
    pool: &sqlx::SqlitePool,
    message_id: i64,
    claim_token: &str,
) -> Result<(), AppError> {
    update_claimed_dispatch(pool, message_id, claim_token, "dispatched", None).await
}

pub(super) async fn mark_immediate_dispatch_failed(
    pool: &sqlx::SqlitePool,
    message_id: i64,
    claim_token: &str,
    error: &str,
) -> Result<(), AppError> {
    update_claimed_dispatch(pool, message_id, claim_token, "error", Some(error)).await
}

async fn update_claimed_dispatch(
    pool: &sqlx::SqlitePool,
    message_id: i64,
    claim_token: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    let result = sqlx::query(
        "UPDATE agent_message_dispatches
         SET status = ?, error = ?,
             dispatched_at = CASE WHEN ? = 'dispatched' THEN datetime('now') ELSE NULL END,
             updated_at = datetime('now')
         WHERE message_id = ? AND status = 'dispatching' AND claim_token = ?",
    )
    .bind(status)
    .bind(error)
    .bind(status)
    .bind(message_id)
    .bind(claim_token)
    .execute(pool)
    .await?;
    if result.rows_affected() != 1 {
        return Err(AppError::Internal(format!(
            "dispatch claim for message {message_id} is no longer current"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_dispatch_can_be_claimed_once_by_an_idempotent_retry() {
        let pool = setup().await;

        let first = claim_immediate_dispatch(&pool, 1).await.unwrap();
        let ImmediateDispatchClaim::Claimed { token: first_token } = first else {
            panic!("first attempt should own the dispatch claim");
        };
        assert_eq!(
            claim_immediate_dispatch(&pool, 1).await.unwrap(),
            ImmediateDispatchClaim::InProgress
        );
        mark_immediate_dispatch_failed(&pool, 1, &first_token, "temporary failure")
            .await
            .unwrap();

        let retry = claim_immediate_dispatch(&pool, 1).await.unwrap();
        let ImmediateDispatchClaim::Claimed { token: retry_token } = retry else {
            panic!("failed attempt should be retryable");
        };
        assert_ne!(first_token, retry_token);
        mark_immediate_dispatch_succeeded(&pool, 1, &retry_token)
            .await
            .unwrap();
        assert_eq!(
            claim_immediate_dispatch(&pool, 1).await.unwrap(),
            ImmediateDispatchClaim::Dispatched
        );
        let lifecycle: (String, i64, Option<String>) = sqlx::query_as(
            "SELECT status, attempt_count, error
             FROM agent_message_dispatches WHERE message_id = 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(lifecycle, ("dispatched".to_string(), 2, None));
    }

    async fn setup() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(
            "CREATE TABLE agent_message_dispatches (
                message_id INTEGER PRIMARY KEY,
                status TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                claim_token TEXT,
                claimed_at TEXT,
                dispatched_at TEXT,
                error TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             INSERT INTO agent_message_dispatches (message_id, status) VALUES (1, 'pending');",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }
}
