//! First-upgrade lossless storage optimization.
//!
//! The initial historical pass runs before the read pool and HTTP server are
//! opened. This lets the same launch immediately run the requested SQLite
//! `VACUUM`, instead of making the user restart once for the backfill and again
//! to reclaim the resulting free pages. Later incremental work stays in the
//! background scheduler.

use sqlx::SqlitePool;

use super::{request_database_compaction, run_lossless_optimization, state};

const DETAIL: &str = "Removing verified duplicate terminal output and moving pasted images out of the database. Conversations are preserved.";

/// Run the one-time lossless pass when its durable marker is not complete.
///
/// The pass itself is resumable and best-effort. A partial failure leaves its
/// cursor and completion marker behind, so startup can continue and a later
/// launch or background sweep can safely resume it.
pub async fn run_initial_optimization(pool: &SqlitePool) {
    if state::get(pool, state::INITIAL_OPTIMIZATION_COMPLETED)
        .await
        .as_deref()
        == Some("1")
    {
        return;
    }

    let changed = crate::shared::startup_progress::run_phase(
        "optimizing_storage",
        DETAIL,
        run_lossless_optimization(pool, None),
    )
    .await;
    request_database_compaction(pool, changed).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, \
             updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
            "CREATE TABLE agent_messages (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, \
             role TEXT NOT NULL DEFAULT 'assistant', content TEXT NOT NULL, \
             message_type TEXT NOT NULL, tool_name TEXT, tool_use_id TEXT)",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn insert(pool: &SqlitePool, id: i64, kind: &str, content: &str) {
        sqlx::query(
            "INSERT INTO agent_messages \
             (id, session_id, content, message_type, tool_name, tool_use_id) \
             VALUES (?, 1, ?, ?, ?, 'tool-1')",
        )
        .bind(id)
        .bind(content)
        .bind(kind)
        .bind((kind == "tool_call").then_some("Bash"))
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn completes_lossless_backfill_and_requests_same_start_compaction() {
        let pool = test_pool().await;
        insert(
            &pool,
            1,
            "tool_call",
            r#"{"command":"test","output":"kept in result"}"#,
        )
        .await;
        insert(&pool, 2, "tool_result", "kept in result").await;

        run_initial_optimization(&pool).await;

        let content =
            sqlx::query_scalar::<_, String>("SELECT content FROM agent_messages WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(content, r#"{"command":"test"}"#);
        assert_eq!(
            state::get(&pool, state::INITIAL_OPTIMIZATION_COMPLETED)
                .await
                .as_deref(),
            Some("1")
        );
        assert_eq!(
            state::get(&pool, state::DATABASE_COMPACTION_REQUESTED)
                .await
                .as_deref(),
            Some("1")
        );
    }
}
