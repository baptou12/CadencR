//! Persisted cursors and completion markers for the maintenance passes.
//!
//! Every value is a string so a pass can store whatever shape it needs (an id
//! cursor, a timestamp, a version tag) without a schema change. Reads degrade to
//! `None` on errors after logging: losing a cursor costs a redundant scan, never
//! correctness, but the failure must remain diagnosable.

use sqlx::SqlitePool;

/// How far the lossless tool-output dedup backfill has walked `agent_messages.id`.
pub const TOOL_OUTPUT_BACKFILL_CURSOR: &str = "tool_output_backfill_cursor";

/// How far the inline-image off-load backfill has walked `agent_messages.id`.
pub const IMAGE_BACKFILL_CURSOR: &str = "image_backfill_cursor";

/// Whether a completed sweep freed enough logical content that startup should
/// consider returning SQLite freelist pages to the filesystem.
pub const DATABASE_COMPACTION_REQUESTED: &str = "database_compaction_requested";

pub async fn get(pool: &SqlitePool, key: &str) -> Option<String> {
    match sqlx::query_scalar::<_, String>("SELECT value FROM maintenance_state WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(key, "failed to read maintenance state: {error}");
            None
        }
    }
}

/// Read a key as an `i64`, falling back to `default` when unset or unparseable.
pub async fn get_i64(pool: &SqlitePool, key: &str, default: i64) -> i64 {
    let Some(value) = get(pool, key).await else {
        return default;
    };
    match value.parse::<i64>() {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(key, value, "invalid integer maintenance state: {error}");
            default
        }
    }
}

pub async fn set(pool: &SqlitePool, key: &str, value: &str) {
    let result = sqlx::query(
        "INSERT INTO maintenance_state (key, value, updated_at) \
         VALUES (?, ?, datetime('now')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await;
    if let Err(e) = result {
        tracing::warn!(key, "failed to persist maintenance state: {e}");
    }
}

pub async fn set_i64(pool: &SqlitePool, key: &str, value: i64) {
    set(pool, key, &value.to_string()).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE maintenance_state (\
             key TEXT PRIMARY KEY, \
             value TEXT NOT NULL, \
             updated_at TEXT NOT NULL DEFAULT (datetime('now'))\
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn round_trips_values_and_upserts() {
        let pool = test_pool().await;

        assert_eq!(get(&pool, "missing").await, None);
        assert_eq!(get_i64(&pool, "missing", 7).await, 7);

        set(&pool, "k", "first").await;
        assert_eq!(get(&pool, "k").await.as_deref(), Some("first"));

        set(&pool, "k", "second").await;
        assert_eq!(get(&pool, "k").await.as_deref(), Some("second"));

        set_i64(&pool, "cursor", 4242).await;
        assert_eq!(get_i64(&pool, "cursor", 0).await, 4242);
    }

    #[tokio::test]
    async fn unparseable_number_falls_back_to_default() {
        let pool = test_pool().await;
        set(&pool, "cursor", "not-a-number").await;
        assert_eq!(get_i64(&pool, "cursor", 99).await, 99);
    }
}
