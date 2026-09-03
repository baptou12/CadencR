use axum::http::StatusCode;
use sqlx::{AssertSqlSafe, SqlitePool};

use super::super::scope::is_active_db_state;
use super::{FeatureChanges, FeatureState};
use crate::app_state::AppState;
use crate::domain::feature_events::FeatureEventAction;
use crate::domain::features::models::FeatureStatus;
use crate::domain::features::repository::upsert_feature_setting;
use crate::domain::features::title::MANUAL_TITLE_SETTING_KEY;
use crate::domain::mcp::write_scope::WriteScope;
use crate::domain::workflow::ws_sender::{
    send_feature_renamed_envelope, send_feature_updated_envelope,
};
use crate::error::AppError;

#[derive(sqlx::FromRow)]
struct FeatureRow {
    project_id: i64,
    title: String,
    label: Option<String>,
    is_pinned: bool,
    status: String,
}

/// Read the state that exists before the write, and refuse features the caller
/// does not own. Read-before-write: the snapshot is what makes the update
/// undoable, so it must come from the same pool the write goes to.
///
/// `owning_project_id` is `Some` for project-scoped writes, which may only touch
/// their own project's features; a workspace-scoped (Steward) write passes
/// `None` because it is authorized on the source instead. Returns the target's
/// project id alongside the snapshot so the audit row points at the project the
/// write actually landed in.
pub(super) async fn load_snapshot(
    pool: &SqlitePool,
    feature_id: i64,
    owning_project_id: Option<i64>,
) -> Result<(FeatureState, i64), AppError> {
    let row: FeatureRow = sqlx::query_as(
        "SELECT project_id, title, label, is_pinned, status FROM features WHERE id = ?",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("feature {feature_id}")))?;
    if owning_project_id.is_some_and(|caller_project_id| row.project_id != caller_project_id) {
        return Err(AppError::coded(
            StatusCode::FORBIDDEN,
            "FEATURE_NOT_IN_PROJECT",
            format!(
                "Feature {feature_id} belongs to another project. Only features listed by project_list_sessions can be updated."
            ),
        ));
    }
    Ok((
        FeatureState {
            title: row.title,
            label: row.label,
            pinned: row.is_pinned,
            status: row.status,
        },
        row.project_id,
    ))
}

/// Archiving a feature whose agent is mid-turn would pull the worktree out from
/// under it. The caller's own session is excluded: it is running precisely
/// because it is making this call, and "archive your own feature when done" is
/// the tool's primary use.
pub(super) async fn ensure_no_other_running_session(
    pool: &SqlitePool,
    feature_id: i64,
    caller_session_id: i64,
    scope: WriteScope,
) -> Result<(), AppError> {
    let sessions: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT status, pending_permission, pending_questions
         FROM agent_sessions WHERE feature_id = ? AND id != ?",
    )
    .bind(feature_id)
    .bind(caller_session_id)
    .fetch_all(pool)
    .await?;
    let running = sessions.iter().any(|(status, permission, question)| {
        is_active_db_state(status, permission.is_some(), question.is_some())
    });
    if running {
        return Err(AppError::coded(
            StatusCode::CONFLICT,
            "FEATURE_HAS_RUNNING_SESSION",
            format!(
                "A session in this feature is still running. Stop it first via {}, or skip this feature.",
                scope.stop_session_tool()
            ),
        ));
    }
    Ok(())
}

/// One `UPDATE` for every changed column so a multi-field request can never
/// half-apply, in a transaction because a title change also stamps the
/// manual-title flag in `feature_settings`.
pub(super) async fn apply_changes(
    pool: &SqlitePool,
    feature_id: i64,
    changes: &FeatureChanges,
) -> Result<(), AppError> {
    let mut assignments: Vec<&str> = Vec::new();
    if changes.title.is_some() {
        assignments.push("title = ?");
    }
    if changes.label.is_some() {
        assignments.push("label = ?");
    }
    if changes.pinned.is_some() {
        assignments.push("is_pinned = ?");
    }
    if let Some(status) = changes.status {
        assignments.push("status = ?");
        // Mirrors features::repository::update_status: archiving starts the
        // retention clock once, un-archiving resets it and drops the sweep record.
        assignments.push(match status {
            FeatureStatus::Archived => "archived_at = COALESCE(archived_at, datetime('now'))",
            FeatureStatus::Active => "archived_at = NULL, compacted_at = NULL",
        });
    }
    let mut query = sqlx::query(AssertSqlSafe(format!(
        "UPDATE features SET {} WHERE id = ?",
        assignments.join(", ")
    )));
    if let Some(title) = &changes.title {
        query = query.bind(title.clone());
    }
    if let Some(label) = &changes.label {
        query = query.bind(label.clone());
    }
    if let Some(pinned) = changes.pinned {
        query = query.bind(i64::from(pinned));
    }
    if let Some(status) = changes.status {
        query = query.bind(status.as_str());
    }

    let mut tx = pool.begin().await?;
    let result = query.bind(feature_id).execute(&mut *tx).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "feature {feature_id} not found"
        )));
    }
    if changes.title.is_some() {
        upsert_feature_setting(&mut *tx, feature_id, MANUAL_TITLE_SETTING_KEY, "true").await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Mirror what the HTTP feature routes broadcast so an open client sees the
/// change: title/label on the feature's own socket, pin/status as a feature-list
/// invalidation for every client.
pub(super) async fn notify_feature_update(
    state: &AppState,
    feature_id: i64,
    changes: &FeatureChanges,
    updated: &FeatureState,
) {
    let mut changed: Vec<&str> = Vec::new();
    if changes.title.is_some() {
        changed.push("title");
    }
    if changes.label.is_some() {
        changed.push("label");
    }
    if !changed.is_empty() {
        for sender in state.ws_feature_senders.get_senders(feature_id).await {
            if changes.title.is_some() {
                send_feature_renamed_envelope(&sender, feature_id, &updated.title);
            }
            send_feature_updated_envelope(&sender, feature_id, &changed);
        }
    }
    if changes.pinned.is_some() || changes.status.is_some() {
        state
            .feature_events_tx
            .emit(feature_id, None, FeatureEventAction::Updated);
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_changes, ensure_no_other_running_session, load_snapshot, FeatureChanges};
    use crate::domain::features::models::FeatureStatus;
    use crate::domain::mcp::write_scope::WriteScope;
    use crate::error::AppError;

    async fn seeded_pool() -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        sqlx::raw_sql(
            "INSERT INTO projects (id, name, path) VALUES (7, 'Proj', '/tmp/proj');
             INSERT INTO features (id, project_id, title, status, type, label)
             VALUES (42, 7, 'Old title', 'active', 'ws-session', 'old');",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn every_changed_column_lands_in_one_write_and_stamps_the_manual_title() {
        let pool = seeded_pool().await;

        apply_changes(
            &pool,
            42,
            &FeatureChanges {
                title: Some("Renamed".to_string()),
                label: Some(None),
                pinned: Some(true),
                status: Some(FeatureStatus::Archived),
            },
        )
        .await
        .unwrap();

        let row: (String, Option<String>, bool, String, Option<String>) = sqlx::query_as(
            "SELECT title, label, is_pinned, status, archived_at FROM features WHERE id = 42",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "Renamed");
        assert_eq!(row.1, None);
        assert!(row.2);
        assert_eq!(row.3, "archived");
        assert!(row.4.is_some());
        let manual: String = sqlx::query_scalar(
            "SELECT value FROM feature_settings WHERE feature_id = 42 AND key = 'title_manually_set'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(manual, "true");
    }

    #[tokio::test]
    async fn a_snapshot_outside_the_callers_project_is_refused() {
        let pool = seeded_pool().await;

        let error = load_snapshot(&pool, 42, Some(8)).await.unwrap_err();

        assert!(matches!(
            error,
            AppError::Coded {
                code: "FEATURE_NOT_IN_PROJECT",
                ..
            }
        ));
        assert!(load_snapshot(&pool, 99, Some(7)).await.is_err());
    }

    /// A workspace-scoped write is authorized on its source, so it passes no
    /// owning project and reads any feature — still reporting where it lives.
    #[tokio::test]
    async fn an_unscoped_snapshot_reads_a_feature_in_any_project() {
        let pool = seeded_pool().await;

        let (state, project_id) = load_snapshot(&pool, 42, None).await.unwrap();

        assert_eq!(state.title, "Old title");
        assert_eq!(project_id, 7);
    }

    #[tokio::test]
    async fn only_sessions_other_than_the_caller_block_archiving() {
        let pool = seeded_pool().await;
        sqlx::raw_sql(
            "INSERT INTO agent_sessions (id, feature_id, agent_type, status)
             VALUES (777, 42, 'session', 'running');",
        )
        .execute(&pool)
        .await
        .unwrap();

        ensure_no_other_running_session(&pool, 42, 777, WriteScope::Project)
            .await
            .expect("the caller's own running session never blocks");

        sqlx::raw_sql(
            "INSERT INTO agent_sessions (id, feature_id, agent_type, status)
             VALUES (778, 42, 'session', 'running');",
        )
        .execute(&pool)
        .await
        .unwrap();
        let error = ensure_no_other_running_session(&pool, 42, 777, WriteScope::Project)
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            AppError::Coded {
                code: "FEATURE_HAS_RUNNING_SESSION",
                ..
            }
        ));
        // The refusal has to name a tool the caller can actually reach.
        let workspace = ensure_no_other_running_session(&pool, 42, 777, WriteScope::Workspace)
            .await
            .unwrap_err();
        assert!(matches!(
            workspace,
            AppError::Coded { ref message, .. } if message.contains("workspace_stop_session")
        ));
    }
}
