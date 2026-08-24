//! Live worktree-setup output streaming with periodic durable snapshots.

use std::time::Duration;

use sqlx::SqlitePool;

use super::setup_events::send_output_line;
use crate::domain::workflow::ws_sender::WsSender;

const SETUP_LOG_PERSIST_INTERVAL: Duration = Duration::from_secs(1);

pub(super) struct CollectedSetupOutput {
    pub log: String,
    pub persistence_error: Option<String>,
}

pub(super) async fn collect_setup_output(
    write_pool: &SqlitePool,
    feature_id: i64,
    ws_sender: &WsSender,
    output_rx: tokio::sync::mpsc::Receiver<String>,
) -> CollectedSetupOutput {
    collect_with_interval(
        write_pool,
        feature_id,
        ws_sender,
        output_rx,
        SETUP_LOG_PERSIST_INTERVAL,
    )
    .await
}

async fn collect_with_interval(
    write_pool: &SqlitePool,
    feature_id: i64,
    ws_sender: &WsSender,
    mut output_rx: tokio::sync::mpsc::Receiver<String>,
    persist_interval: Duration,
) -> CollectedSetupOutput {
    let mut log = String::new();
    let mut dirty = false;
    let mut persist_tick = tokio::time::interval(persist_interval);
    persist_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    persist_tick.tick().await;
    let (snapshot_tx, snapshot_rx) = tokio::sync::watch::channel(None::<String>);
    let snapshot_pool = write_pool.clone();
    let snapshot_task =
        tokio::spawn(
            async move { persist_snapshots(snapshot_pool, feature_id, snapshot_rx).await },
        );

    loop {
        tokio::select! {
            output = output_rx.recv() => {
                let Some(line) = output else { break };
                if !log.is_empty() {
                    log.push('\n');
                }
                log.push_str(&line);
                dirty = true;
                send_output_line(feature_id, ws_sender, line);
            }
            _ = persist_tick.tick(), if dirty => {
                snapshot_tx.send_replace(Some(log.clone()));
                dirty = false;
            }
        }
    }

    drop(snapshot_tx);
    let persistence_error = snapshot_task
        .await
        .map_err(|error| format!("Worktree setup output persistence task failed: {error}"))
        .unwrap_or_else(Some);
    CollectedSetupOutput {
        log,
        persistence_error,
    }
}

async fn persist_snapshots(
    write_pool: SqlitePool,
    feature_id: i64,
    mut snapshots: tokio::sync::watch::Receiver<Option<String>>,
) -> Option<String> {
    let mut persistence_error = None;
    while snapshots.changed().await.is_ok() {
        let Some(snapshot) = snapshots.borrow_and_update().clone() else {
            continue;
        };
        let result = crate::domain::features::repository::upsert_feature_setting(
            &write_pool,
            feature_id,
            "worktree_setup_log",
            &snapshot,
        )
        .await;
        persistence_error = result
            .err()
            .map(|error| format!("Failed to persist worktree setup output: {error}"));
    }
    persistence_error
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ws::Message;

    #[tokio::test]
    async fn persists_output_before_the_stream_finishes() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, \
             PRIMARY KEY (feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        let (ws, _ws_rx) = tokio::sync::mpsc::unbounded_channel();
        let (output_tx, output_rx) = tokio::sync::mpsc::channel(4);
        let collector_pool = pool.clone();
        let task = tokio::spawn(async move {
            collect_with_interval(
                &collector_pool,
                9,
                &ws,
                output_rx,
                Duration::from_millis(10),
            )
            .await
        });

        output_tx.send("installing".to_string()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;

        let persisted: String = sqlx::query_scalar(
            "SELECT value FROM feature_settings WHERE feature_id = 9 AND key = 'worktree_setup_log'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(persisted, "installing");

        drop(output_tx);
        let collected = task.await.unwrap();
        assert_eq!(collected.log, "installing");
        assert!(collected.persistence_error.is_none());
    }

    #[tokio::test]
    async fn slow_snapshot_write_does_not_block_live_output() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, \
             PRIMARY KEY (feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        let held_connection = pool.acquire().await.unwrap();
        let (ws, mut ws_rx) = tokio::sync::mpsc::unbounded_channel();
        let (output_tx, output_rx) = tokio::sync::mpsc::channel(4);
        let collector_pool = pool.clone();
        let task = tokio::spawn(async move {
            collect_with_interval(
                &collector_pool,
                9,
                &ws,
                output_rx,
                Duration::from_millis(10),
            )
            .await
        });

        output_tx.send("first".to_string()).await.unwrap();
        assert!(matches!(ws_rx.recv().await, Some(Message::Text(_))));
        tokio::time::sleep(Duration::from_millis(30)).await;
        output_tx.send("second".to_string()).await.unwrap();
        assert!(matches!(
            tokio::time::timeout(Duration::from_millis(100), ws_rx.recv())
                .await
                .unwrap(),
            Some(Message::Text(_))
        ));

        drop(held_connection);
        drop(output_tx);
        let collected = task.await.unwrap();
        assert_eq!(collected.log, "first\nsecond");
    }
}
