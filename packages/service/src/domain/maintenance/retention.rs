//! Compacts the tool messages of features archived longer than the retention
//! window.
//!
//! Archiving is how a finished feature leaves the sidebar, and nothing has ever
//! reclaimed what it left behind — on a real installation 1,092 archived
//! features still held their full transcripts. This pass compacts them once the
//! window has passed, and it is the only maintenance pass that gives anything
//! up, so it is the only one behind a setting.
//!
//! Two properties matter more than the bytes saved:
//!
//! - **A feature is never deleted.** Neither is a session, a message row, or the
//!   conversation itself. An archived feature stays browsable, rewindable, and
//!   forkable — the tool payloads inside it get shorter. See [`compaction`] for
//!   exactly what that means.
//! - **Un-archiving cancels it.** `update_status` clears both `archived_at` and
//!   `compacted_at` when a feature leaves the archive, so restoring one before
//!   the window elapses leaves it untouched, and re-archiving restarts the
//!   clock rather than resuming an old one.
//! - **New thread activity restarts it.** An archived conversation can still
//!   receive a scheduled message. The migration trigger clears `compacted_at`,
//!   and the sweep requires the latest message to be older than the window.
//!
//! Progress is per-feature: `features.compacted_at` is stamped only after a
//! feature is fully walked, so an interrupted sweep re-does at most one feature
//! and the transform is idempotent anyway.

mod policy;
mod queries;
mod runner;
#[cfg(test)]
mod test_support;

pub use runner::run;

#[cfg(test)]
use super::compaction;
#[cfg(test)]
use super::{StorageMaintenanceEvent, StorageMaintenanceTask};
#[cfg(test)]
use policy::{window_days, DEFAULT_DAYS};
#[cfg(test)]
use runner::{
    compact_feature, compact_feature_with_policy, run_for_test, run_for_test_with_policy,
    stamp_compacted, store_compacted_if_eligible, MESSAGE_BATCH,
};
#[cfg(test)]
use sqlx::SqlitePool;

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    static POLICY_CHECKS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    fn policy_changes_after_first_check(_: i64) -> bool {
        POLICY_CHECKS.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0
    }

    #[tokio::test]
    async fn compacts_a_feature_past_the_window_and_stamps_it() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 60).await;
        insert_message(&pool, 1, 1, "tool_result", &huge_output()).await;

        assert_eq!(run_without_events(&pool).await, 1);
        assert!(content_of(&pool, 1).await.len() < huge_output().len() / 5);
        assert!(compacted_at(&pool, 1).await.is_some());
    }

    #[tokio::test]
    async fn reports_progress_and_completion_around_a_due_sweep() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 60).await;
        insert_message(&pool, 1, 1, "tool_result", &huge_output()).await;
        let (events, mut receiver) = event_channel();

        assert_eq!(run_for_test(&pool, &events, DEFAULT_DAYS).await, 1);
        assert_eq!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Started {
                task: StorageMaintenanceTask::Cleanup,
                completed: 0,
                total: 1,
            }
        );
        assert_eq!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Progress {
                task: StorageMaintenanceTask::Cleanup,
                completed: 1,
                total: 1,
            }
        );
        assert_eq!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Completed {
                task: StorageMaintenanceTask::Cleanup,
                completed: 1,
                total: 1,
            }
        );
    }

    #[tokio::test]
    async fn reports_policy_cancellation_instead_of_success() {
        POLICY_CHECKS.store(0, std::sync::atomic::Ordering::SeqCst);
        let pool = test_pool().await;
        archived_feature(&pool, 1, 60).await;
        insert_message(&pool, 1, 1, "tool_result", &huge_output()).await;
        let (events, mut receiver) = event_channel();

        assert_eq!(
            run_for_test_with_policy(
                &pool,
                &events,
                DEFAULT_DAYS,
                policy_changes_after_first_check
            )
            .await,
            0
        );
        assert!(matches!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Started { .. }
        ));
        assert_eq!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Cancelled {
                task: StorageMaintenanceTask::Cleanup,
                completed: 0,
                total: 1,
            }
        );
    }

    #[tokio::test]
    async fn reports_a_sweep_that_cannot_list_due_features() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let (events, mut receiver) = event_channel();

        assert_eq!(run_for_test(&pool, &events, DEFAULT_DAYS).await, 0);
        assert_eq!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Failed {
                task: StorageMaintenanceTask::Cleanup,
                completed: 0,
                total: 0,
            }
        );
    }

    #[tokio::test]
    async fn failed_cleanup_does_not_report_the_feature_as_completed() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 60).await;
        sqlx::query(
            "CREATE TRIGGER reject_compaction_stamp BEFORE UPDATE OF compacted_at ON features
             BEGIN SELECT RAISE(FAIL, 'transient write failure'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        let (events, mut receiver) = event_channel();

        assert_eq!(run_for_test(&pool, &events, DEFAULT_DAYS).await, 0);
        assert!(matches!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Started { .. }
        ));
        assert!(matches!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Progress { .. }
        ));
        assert_eq!(
            receiver.recv().await.unwrap(),
            StorageMaintenanceEvent::Failed {
                task: StorageMaintenanceTask::Cleanup,
                completed: 0,
                total: 1,
            }
        );
    }

    #[tokio::test]
    async fn leaves_a_recently_archived_feature_alone() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 3).await;
        let original = huge_output();
        insert_message(&pool, 1, 1, "tool_result", &original).await;

        assert_eq!(run_without_events(&pool).await, 0);
        assert_eq!(content_of(&pool, 1).await, original);
        assert!(compacted_at(&pool, 1).await.is_none());
    }

    #[tokio::test]
    async fn recent_thread_activity_restarts_the_quiet_period() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        let original = huge_output();
        insert_message(&pool, 1, 1, "tool_result", &original).await;
        sqlx::query(
            "INSERT INTO agent_messages \
             (id, session_id, content, message_type, created_at) \
             VALUES (2, 1, 'scheduled follow-up', 'user_message', datetime('now'))",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(run_without_events(&pool).await, 0);
        assert_eq!(content_of(&pool, 1).await, original);
        assert!(compacted_at(&pool, 1).await.is_none());
    }

    #[tokio::test]
    async fn never_compacts_an_active_feature() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO features (id, status, archived_at) VALUES (1, 'active', NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_sessions (id, feature_id) VALUES (1, 1)")
            .execute(&pool)
            .await
            .unwrap();
        let original = huge_output();
        insert_message(&pool, 1, 1, "tool_result", &original).await;

        assert_eq!(run_without_events(&pool).await, 0);
        assert_eq!(content_of(&pool, 1).await, original);
    }

    /// Read-path truncation is Bash-only, so a `Read` result is rendered in full
    /// however old the feature is and compaction must leave it that way. The
    /// tool name is resolved from the matching `tool_call`, since a `tool_result`
    /// row carries none of its own.
    #[tokio::test]
    async fn never_compacts_the_output_of_a_tool_the_ui_renders_in_full() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        let original = huge_output();

        sqlx::query(
            "INSERT INTO agent_messages \
             (id, session_id, content, message_type, tool_name, tool_use_id, created_at) \
             VALUES (1, 1, '{}', 'tool_call', 'Read', 'call-1', datetime('now', '-400 days'))",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_messages \
             (id, session_id, content, message_type, tool_use_id, created_at) \
             VALUES (2, 1, ?, 'tool_result', 'call-1', datetime('now', '-400 days'))",
        )
        .bind(&original)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(run_without_events(&pool).await, 0);
        assert_eq!(content_of(&pool, 2).await, original);
    }

    /// Un-archiving mid-sweep must stop the walk and leave no `compacted_at`
    /// behind — a stale stamp would exclude the feature from every later sweep.
    #[tokio::test]
    async fn stops_and_leaves_no_stamp_when_a_feature_is_un_archived_mid_sweep() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        insert_message(&pool, 1, 1, "tool_result", &huge_output()).await;

        // Simulate `update_status` running between the due-list snapshot and the
        // walk: the feature is active again by the time compaction reaches it.
        sqlx::query("UPDATE features SET status = 'active', archived_at = NULL WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(compact_feature(&pool, 1, DEFAULT_DAYS).await.unwrap(), 0);
        assert!(!stamp_compacted(&pool, 1, DEFAULT_DAYS).await.unwrap());
        assert!(compacted_at(&pool, 1).await.is_none());
    }

    #[tokio::test]
    async fn a_loaded_message_cannot_be_rewritten_after_unarchive() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        let original = huge_output();
        insert_message(&pool, 1, 1, "tool_result", &original).await;
        let compacted = compaction::compact_content(&original, Some("Bash")).unwrap();

        // This models the exact gap that existed between loading a batch and
        // issuing each UPDATE.
        sqlx::query("UPDATE features SET status = 'active', archived_at = NULL WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();

        assert!(
            !store_compacted_if_eligible(&pool, 1, 1, &compacted, DEFAULT_DAYS)
                .await
                .unwrap()
        );
        assert_eq!(content_of(&pool, 1).await, original);
    }

    #[tokio::test]
    async fn a_loaded_message_cannot_be_rewritten_after_recent_activity() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        let original = huge_output();
        insert_message(&pool, 1, 1, "tool_result", &original).await;
        let compacted = compaction::compact_content(&original, Some("Bash")).unwrap();

        sqlx::query(
            "INSERT INTO agent_messages \
             (id, session_id, content, message_type, created_at) \
             VALUES (2, 1, 'scheduled follow-up', 'user_message', datetime('now'))",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(
            !store_compacted_if_eligible(&pool, 1, 1, &compacted, DEFAULT_DAYS)
                .await
                .unwrap()
        );
        assert!(!stamp_compacted(&pool, 1, DEFAULT_DAYS).await.unwrap());
        assert_eq!(content_of(&pool, 1).await, original);
        assert!(compacted_at(&pool, 1).await.is_none());
    }

    #[tokio::test]
    async fn a_changed_policy_stops_before_the_next_lossy_rewrite() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        let original = huge_output();
        insert_message(&pool, 1, 1, "tool_result", &original).await;

        assert_eq!(
            compact_feature_with_policy(&pool, 1, DEFAULT_DAYS, |_| false)
                .await
                .unwrap(),
            0
        );
        assert_eq!(content_of(&pool, 1).await, original);
        assert!(compacted_at(&pool, 1).await.is_none());
    }

    /// The conversation itself survives at any age — only tool payloads shrink.
    #[tokio::test]
    async fn never_compacts_user_or_assistant_messages() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 400).await;
        let prompt = "please do the thing\n".repeat(2_000);
        let reply = "here is a very long explanation\n".repeat(2_000);
        insert_message(&pool, 1, 1, "user_message", &prompt).await;
        insert_message(&pool, 2, 1, "text", &reply).await;

        assert_eq!(run_without_events(&pool).await, 0);
        assert_eq!(content_of(&pool, 1).await, prompt);
        assert_eq!(content_of(&pool, 2).await, reply);
    }

    #[tokio::test]
    async fn keeps_every_feature_session_and_message_row() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 90).await;
        insert_message(&pool, 1, 1, "tool_result", &huge_output()).await;

        run_without_events(&pool).await;

        for (table, expected) in [
            ("features", 1),
            ("agent_sessions", 1),
            ("agent_messages", 1),
        ] {
            let count = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM {table}"
            )))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, expected, "{table} lost rows");
        }
    }

    #[tokio::test]
    async fn a_second_sweep_does_no_work() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 60).await;
        insert_message(&pool, 1, 1, "tool_result", &huge_output()).await;

        assert_eq!(run_without_events(&pool).await, 1);
        // `compacted_at` is stamped, so the feature isn't even selected again.
        assert_eq!(run_without_events(&pool).await, 0);
    }

    #[tokio::test]
    async fn walks_past_the_message_batch_size() {
        let pool = test_pool().await;
        archived_feature(&pool, 1, 60).await;
        for id in 1..=(MESSAGE_BATCH + 7) {
            insert_message(&pool, id, 1, "tool_result", &huge_output()).await;
        }

        assert_eq!(run_without_events(&pool).await, (MESSAGE_BATCH + 7) as u64);
    }

    #[tokio::test]
    async fn compaction_defaults_off_when_unset() {
        assert_eq!(window_days(), None);
    }
}
