use sqlx::SqlitePool;

use super::super::{StorageMaintenanceBroadcaster, StorageMaintenanceEvent};
use super::policy::DEFAULT_DAYS;
use super::runner::run_for_test;

pub(super) async fn run_without_events(pool: &SqlitePool) -> u64 {
    let events = StorageMaintenanceBroadcaster::new(4);
    run_for_test(pool, &events, DEFAULT_DAYS).await
}

pub(super) async fn test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    for sql in [
        "CREATE TABLE features (id INTEGER PRIMARY KEY, status TEXT NOT NULL, \
         archived_at TEXT, compacted_at TEXT)",
        "CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL)",
        "CREATE TABLE agent_messages (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, \
         content TEXT NOT NULL, message_type TEXT NOT NULL, tool_name TEXT, tool_use_id TEXT, \
         created_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "CREATE TABLE maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, \
         updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    pool
}

pub(super) async fn archived_feature(pool: &SqlitePool, id: i64, archived_days_ago: i64) {
    sqlx::query(
        "INSERT INTO features (id, status, archived_at) \
         VALUES (?, 'archived', datetime('now', ?))",
    )
    .bind(id)
    .bind(format!("-{archived_days_ago} days"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO agent_sessions (id, feature_id) VALUES (?, ?)")
        .bind(id)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

pub(super) async fn insert_message(
    pool: &SqlitePool,
    id: i64,
    session_id: i64,
    kind: &str,
    body: &str,
) {
    insert_tool_message(pool, id, session_id, kind, body, Some("Bash")).await;
}

pub(super) async fn insert_tool_message(
    pool: &SqlitePool,
    id: i64,
    session_id: i64,
    kind: &str,
    body: &str,
    tool_name: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO agent_messages \
         (id, session_id, content, message_type, tool_name, created_at) \
         VALUES (?, ?, ?, ?, ?, datetime('now', '-400 days'))",
    )
    .bind(id)
    .bind(session_id)
    .bind(body)
    .bind(kind)
    .bind(tool_name)
    .execute(pool)
    .await
    .unwrap();
}

pub(super) async fn content_of(pool: &SqlitePool, id: i64) -> String {
    sqlx::query_scalar::<_, String>("SELECT content FROM agent_messages WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn compacted_at(pool: &SqlitePool, id: i64) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>("SELECT compacted_at FROM features WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) fn huge_output() -> String {
    serde_json::json!({ "output": "a long line of build output\n".repeat(2_000) }).to_string()
}

pub(super) fn event_channel() -> (
    StorageMaintenanceBroadcaster,
    tokio::sync::broadcast::Receiver<StorageMaintenanceEvent>,
) {
    let events = StorageMaintenanceBroadcaster::new(4);
    let receiver = events.subscribe();
    (events, receiver)
}
