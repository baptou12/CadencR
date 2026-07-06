//! Timestamp-based diff for appending only genuinely-newer provider events.
//!
//! Live rows are written with SQLite's `datetime('now')` (`YYYY-MM-DD HH:MM:SS`)
//! while provider logs use ISO8601 (`…T…Z`), so the two are *not*
//! string-comparable — we parse both to `DateTime<Utc>` and compare instants.

use chrono::{DateTime, NaiveDateTime, Timelike, Utc};
use sqlx::SqlitePool;

use crate::error::AppError;

use super::persistence::insert_message;
use super::types::ImportedConversation;

/// Newest stored-message instant for a session, or `None` when the session has
/// no messages yet (in which case the whole conversation is appended).
///
/// A raw string `MAX()` is unreliable across our two formats (SQLite-naive
/// `YYYY-MM-DD HH:MM:SS` vs ISO8601 `…T…Z`, which sort differently), so we let
/// SQLite's `datetime()` normalize both to a comparable second-precision string
/// and `MAX` that — one value back instead of every row.
pub(super) async fn latest_message_time(
    pool: &SqlitePool,
    session_id: i64,
) -> Result<Option<DateTime<Utc>>, AppError> {
    let max: Option<String> = sqlx::query_scalar(
        "SELECT MAX(datetime(created_at)) FROM agent_messages WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await?;
    Ok(max.as_deref().and_then(parse_timestamp))
}

pub(super) async fn append_new_messages(
    write_pool: &SqlitePool,
    session_id: i64,
    conv: &ImportedConversation,
    cutoff: Option<DateTime<Utc>>,
) -> Result<u32, AppError> {
    // Compare at whole-second granularity: live rows are stored with SQLite's
    // second-precision `datetime('now')`, while provider logs carry sub-second
    // ISO timestamps. Without truncating, the provider's *twin* of the newest
    // stored message (e.g. `…48.828Z` vs the stored `…48`) reads as newer and
    // gets re-appended — duplicating the tail on every sync.
    let cutoff = cutoff.map(truncate_to_seconds);
    let mut tx = write_pool.begin().await?;
    let mut added = 0u32;
    for msg in conv.messages.iter() {
        // Only append events we can time-place strictly after the cutoff.
        let Some(ts) = msg.created_at.as_deref().and_then(parse_timestamp) else {
            continue;
        };
        if cutoff.is_some_and(|cutoff| truncate_to_seconds(ts) <= cutoff) {
            continue;
        }
        insert_message(&mut tx, session_id, msg, conv).await?;
        added += 1;
    }
    tx.commit().await?;
    Ok(added)
}

/// Drop sub-second precision so SQLite-naive (second) and ISO8601 (millisecond)
/// timestamps for the same event compare equal.
fn truncate_to_seconds(dt: DateTime<Utc>) -> DateTime<Utc> {
    dt.with_nanosecond(0).unwrap_or(dt)
}

/// Parse a stored or provider timestamp to a UTC instant. Handles ISO8601
/// (provider logs) and SQLite's naive `datetime('now')` format (live rows,
/// treated as UTC). Returns `None` for anything we can't place.
fn parse_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|naive| DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::imports::types::ImportedMessage;
    use sqlx::sqlite::SqlitePoolOptions;

    fn msg(ts: &str) -> ImportedMessage {
        ImportedMessage {
            role: "assistant".into(),
            content: format!("at {ts}"),
            message_type: "text".into(),
            tool_name: None,
            tool_use_id: None,
            model: Some("claude".into()),
            created_at: Some(ts.into()),
        }
    }

    fn conv_with(timestamps: &[&str]) -> ImportedConversation {
        ImportedConversation {
            source_session_id: "s".into(),
            title: "t".into(),
            model: Some("claude".into()),
            started_at: None,
            modified_at: None,
            messages: timestamps.iter().map(|ts| msg(ts)).collect(),
        }
    }

    async fn pool_with_messages(stored: &[&str]) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', tool_name TEXT, tool_use_id TEXT, parent_tool_use_id TEXT, model TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))")
            .execute(&pool)
            .await
            .unwrap();
        for ts in stored {
            sqlx::query(
                "INSERT INTO agent_messages (session_id, role, content, created_at) VALUES (1, 'user', 'x', ?)",
            )
            .bind(ts)
            .execute(&pool)
            .await
            .unwrap();
        }
        pool
    }

    #[test]
    fn parse_timestamp_handles_both_formats() {
        let iso = parse_timestamp("2026-05-27T19:56:38.828Z").unwrap();
        let sqlite = parse_timestamp("2026-05-27 19:56:38").unwrap();
        // The SQLite-naive value is the earlier instant despite sorting later
        // as a raw string ('T' > ' '), which is exactly why we parse.
        assert!(sqlite < iso);
        assert!(parse_timestamp("not a date").is_none());
    }

    #[tokio::test]
    async fn appends_only_messages_newer_than_cutoff() {
        // Stored conversation ends at 12:00:05 (SQLite-naive / UTC).
        let pool = pool_with_messages(&["2026-05-27 12:00:00", "2026-05-27 12:00:05"]).await;
        let cutoff = latest_message_time(&pool, 1).await.unwrap();

        // Provider log re-states the existing tail (ISO twin of 12:00:05) plus
        // two genuinely-newer CLI events.
        let conv = conv_with(&[
            "2026-05-27T12:00:05.000Z",
            "2026-05-27T12:01:00.000Z",
            "2026-05-27T12:02:00.000Z",
        ]);
        let added = append_new_messages(&pool, 1, &conv, cutoff).await.unwrap();
        assert_eq!(added, 2);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 4);
    }

    #[tokio::test]
    async fn subsecond_twin_of_stored_tail_is_not_reappended() {
        // Live row stored at second precision; the provider log's twin of that
        // same event carries sub-second precision and would sort as "newer"
        // without truncation — the exact cause of duplicate-on-resync.
        let pool = pool_with_messages(&["2026-05-27 12:00:05"]).await;
        let cutoff = latest_message_time(&pool, 1).await.unwrap();

        let conv = conv_with(&["2026-05-27T12:00:05.828Z", "2026-05-27T12:00:30.000Z"]);
        let added = append_new_messages(&pool, 1, &conv, cutoff).await.unwrap();
        assert_eq!(added, 1, "only the genuinely-later event should append");
    }

    #[tokio::test]
    async fn appends_everything_when_session_empty() {
        let pool = pool_with_messages(&[]).await;
        let cutoff = latest_message_time(&pool, 1).await.unwrap();
        assert!(cutoff.is_none());

        let conv = conv_with(&["2026-05-27T12:00:00.000Z", "2026-05-27T12:01:00.000Z"]);
        let added = append_new_messages(&pool, 1, &conv, cutoff).await.unwrap();
        assert_eq!(added, 2);
    }

    #[tokio::test]
    async fn skips_messages_without_a_timestamp() {
        let pool = pool_with_messages(&["2026-05-27 12:00:00"]).await;
        let cutoff = latest_message_time(&pool, 1).await.unwrap();

        let mut conv = conv_with(&["2026-05-27T12:05:00.000Z"]);
        conv.messages.push(ImportedMessage {
            created_at: None,
            ..msg("ignored")
        });
        let added = append_new_messages(&pool, 1, &conv, cutoff).await.unwrap();
        assert_eq!(added, 1);
    }
}
