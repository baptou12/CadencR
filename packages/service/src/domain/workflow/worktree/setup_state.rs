//! Atomic persistence for the terminal state and transcript of worktree setup.

use sqlx::SqlitePool;

pub(super) enum SetupState<'a> {
    Running { log: &'a str },
    Ready { log: &'a str },
    Error { error: &'a str, log: &'a str },
}

impl<'a> SetupState<'a> {
    fn values(self) -> (&'static str, &'a str, &'a str) {
        match self {
            Self::Running { log } => ("setup_running", "", log),
            Self::Ready { log } => ("ready", "", log),
            Self::Error { error, log } => ("setup_error", error, log),
        }
    }
}

pub(super) async fn persist_setup_state(
    pool: &SqlitePool,
    feature_id: i64,
    state: SetupState<'_>,
) -> Result<(), String> {
    let (step, error, log) = state.values();
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin worktree setup state update: {error}"))?;
    for (key, value) in [
        ("worktree_setup_step", step),
        ("worktree_setup_error", error),
        ("worktree_setup_log", log),
    ] {
        crate::domain::features::repository::upsert_feature_setting(
            &mut *transaction,
            feature_id,
            key,
            value,
        )
        .await
        .map_err(|error| format!("Failed to persist worktree setup state: {error}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit worktree setup state: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn persists_step_error_and_log_together() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, \
             PRIMARY KEY (feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();

        persist_setup_state(
            &pool,
            3,
            SetupState::Error {
                error: "interrupted",
                log: "partial output",
            },
        )
        .await
        .unwrap();

        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT key, value FROM feature_settings WHERE feature_id = 3 ORDER BY key",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                (
                    "worktree_setup_error".to_string(),
                    "interrupted".to_string()
                ),
                (
                    "worktree_setup_log".to_string(),
                    "partial output".to_string()
                ),
                ("worktree_setup_step".to_string(), "setup_error".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn failed_field_update_rolls_back_the_entire_state() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (
                feature_id INTEGER, key TEXT, value TEXT,
                PRIMARY KEY (feature_id, key),
                CHECK (key != 'worktree_setup_log' OR value != 'rejected log'))",
        )
        .execute(&pool)
        .await
        .unwrap();
        for (key, value) in [
            ("worktree_setup_step", "setup_running"),
            ("worktree_setup_error", ""),
            ("worktree_setup_log", "partial"),
        ] {
            crate::domain::features::repository::upsert_feature_setting(&pool, 3, key, value)
                .await
                .unwrap();
        }

        assert!(persist_setup_state(
            &pool,
            3,
            SetupState::Error {
                error: "interrupted",
                log: "rejected log",
            },
        )
        .await
        .is_err());

        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT key, value FROM feature_settings WHERE feature_id = 3 ORDER BY key",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("worktree_setup_error".to_string(), "".to_string()),
                ("worktree_setup_log".to_string(), "partial".to_string()),
                (
                    "worktree_setup_step".to_string(),
                    "setup_running".to_string()
                ),
            ]
        );
    }
}
