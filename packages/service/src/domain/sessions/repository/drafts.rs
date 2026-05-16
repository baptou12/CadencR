//! Small per-session draft / message-content queries.

use sqlx::SqlitePool;

use crate::error::AppError;

pub async fn get_draft(pool: &SqlitePool, session_id: i64) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT draft_prompt FROM agent_sessions WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(v,)| v))
}

/// Fetch the full, untruncated `content` for a single `agent_messages` row.
/// Used by the "Show all" affordance on Bash blocks whose payload was
/// tail-truncated for the agent-state response.
pub async fn get_message_content(
    pool: &SqlitePool,
    message_id: i64,
) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT content FROM agent_messages WHERE id = ?")
        .bind(message_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(c,)| c))
}

pub async fn save_draft(
    pool: &SqlitePool,
    session_id: i64,
    draft: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE agent_sessions SET draft_prompt = ? WHERE id = ?")
        .bind(draft)
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

    #[tokio::test]
    async fn test_get_draft() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "paused").await;

        save_draft(&pool, session_id, Some("my draft"))
            .await
            .unwrap();
        let draft = get_draft(&pool, session_id).await.unwrap();
        assert_eq!(draft.as_deref(), Some("my draft"));
    }

    #[tokio::test]
    async fn test_get_draft_empty() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "paused").await;

        let draft = get_draft(&pool, session_id).await.unwrap();
        assert!(draft.is_none());
    }

    #[tokio::test]
    async fn test_save_draft_upsert() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "paused").await;

        save_draft(&pool, session_id, Some("first draft"))
            .await
            .unwrap();
        save_draft(&pool, session_id, Some("updated draft"))
            .await
            .unwrap();

        let draft = get_draft(&pool, session_id).await.unwrap();
        assert_eq!(draft.as_deref(), Some("updated draft"));
    }

    #[tokio::test]
    async fn test_get_message_content_returns_row() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let sid = insert_session(&pool, fid.0, "completed").await;
        let mid = insert_message(
            &pool,
            sid,
            "tool_result",
            "the full bash output",
            None,
            Some("tu-1"),
            None,
        )
        .await;

        let content = get_message_content(&pool, mid).await.unwrap();
        assert_eq!(content.as_deref(), Some("the full bash output"));
    }

    #[tokio::test]
    async fn test_get_message_content_missing_returns_none() {
        let pool = setup_test_db().await;
        let res = get_message_content(&pool, 999_999).await.unwrap();
        assert!(res.is_none());
    }
}
