use std::collections::HashMap;

use sqlx::SqlitePool;

use super::models::{
    CustomAction, CustomActionRun, CustomActionSchedule, CustomActionVariable, LastRunSummary,
    Scope, TriggeredBy,
};
use super::service;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// custom_actions
// ---------------------------------------------------------------------------

/// Raw DB columns. The public [`CustomAction`] also carries derived fields
/// (`variable_names`, `last_run`) that are stitched in by [`hydrate`].
#[derive(sqlx::FromRow)]
struct ActionRow {
    id: i64,
    name: String,
    command: String,
    icon_data: Option<String>,
    scope: Scope,
    project_id: Option<i64>,
    position: i64,
    created_at: String,
    updated_at: String,
}

fn hydrate(row: ActionRow, last_run: Option<LastRunSummary>) -> CustomAction {
    CustomAction {
        variable_names: service::extract_variables(&row.command),
        id: row.id,
        name: row.name,
        command: row.command,
        icon_data: row.icon_data,
        scope: row.scope,
        project_id: row.project_id,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_run,
    }
}

/// Returns global actions plus any actions scoped to `project_id`. When
/// `feature_id` is provided, each action's latest run for that feature is
/// embedded so the header bar can paint status dots without N additional HTTP
/// calls.
pub async fn list_for_project(
    pool: &SqlitePool,
    project_id: i64,
    feature_id: Option<i64>,
) -> Result<Vec<CustomAction>, AppError> {
    let rows = sqlx::query_as::<_, ActionRow>(
        r#"SELECT id, name, command, icon_data, scope, project_id, position, created_at, updated_at
           FROM custom_actions
           WHERE scope = 'global' OR project_id = ?
           ORDER BY position ASC, id ASC"#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let last_runs = match feature_id {
        Some(fid) => latest_runs_for_feature(pool, fid).await?,
        None => HashMap::new(),
    };

    Ok(rows
        .into_iter()
        .map(|r| {
            let last = last_runs.get(&r.id).cloned();
            hydrate(r, last)
        })
        .collect())
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<CustomAction>, AppError> {
    let row = sqlx::query_as::<_, ActionRow>(
        r#"SELECT id, name, command, icon_data, scope, project_id, position, created_at, updated_at
           FROM custom_actions WHERE id = ?"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| hydrate(r, None)))
}

pub async fn insert(
    pool: &SqlitePool,
    name: &str,
    command: &str,
    icon_data: Option<&str>,
    scope: Scope,
    project_id: Option<i64>,
) -> Result<i64, AppError> {
    let result = sqlx::query(
        r#"INSERT INTO custom_actions (name, command, icon_data, scope, project_id)
           VALUES (?, ?, ?, ?, ?)"#,
    )
    .bind(name)
    .bind(command)
    .bind(icon_data)
    .bind(scope)
    .bind(project_id)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

/// Single-statement partial update using `COALESCE`: any field passed as `None`
/// keeps its current DB value. The icon clear path uses `Some(Some(""))` to
/// distinguish "leave alone" (`None`) from "set to NULL" (`Some(None)`).
pub async fn update(
    pool: &SqlitePool,
    id: i64,
    name: Option<&str>,
    command: Option<&str>,
    icon_data: Option<Option<&str>>,
    scope: Option<Scope>,
    project_id: Option<Option<i64>>,
    position: Option<i64>,
) -> Result<(), AppError> {
    // `clear_icon = 1` lets us pass NULL through the COALESCE without losing
    // the "leave alone" semantics encoded by `Option<Option<&str>>`.
    let (icon_param, clear_icon) = match icon_data {
        Some(Some(s)) => (Some(s), false),
        Some(None) => (None, true),
        None => (None, false),
    };
    let (project_param, clear_project) = match project_id {
        Some(Some(id)) => (Some(id), false),
        Some(None) => (None, true),
        None => (None, false),
    };

    let result = sqlx::query(
        r#"UPDATE custom_actions SET
               name       = COALESCE(?, name),
               command    = COALESCE(?, command),
               icon_data  = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, icon_data) END,
               project_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, project_id) END,
               scope      = COALESCE(?, scope),
               position   = COALESCE(?, position),
               updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(name)
    .bind(command)
    .bind(clear_icon as i64)
    .bind(icon_param)
    .bind(clear_project as i64)
    .bind(project_param)
    .bind(scope)
    .bind(position)
    .bind(id)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Custom action {id} not found")));
    }
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM custom_actions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// custom_action_variables
// ---------------------------------------------------------------------------

pub async fn list_variables(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
) -> Result<Vec<CustomActionVariable>, AppError> {
    let rows = sqlx::query_as::<_, CustomActionVariable>(
        r#"SELECT var_name, value FROM custom_action_variables
           WHERE action_id = ? AND feature_id = ?"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn upsert_variable(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
    var_name: &str,
    value: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO custom_action_variables (action_id, feature_id, var_name, value)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(action_id, feature_id, var_name) DO UPDATE SET value = excluded.value"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .bind(var_name)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// custom_action_runs
// ---------------------------------------------------------------------------

pub async fn insert_run(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
    triggered_by: TriggeredBy,
) -> Result<i64, AppError> {
    let result = sqlx::query(
        r#"INSERT INTO custom_action_runs (action_id, feature_id, triggered_by)
           VALUES (?, ?, ?)"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .bind(triggered_by)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

/// Finalize a run with the captured exit code and streams. Returns the
/// `ended_at` we just stamped so the caller doesn't need a follow-up SELECT.
pub async fn finalize_run(
    pool: &SqlitePool,
    run_id: i64,
    exit_code: Option<i64>,
    stdout: &str,
    stderr: &str,
) -> Result<String, AppError> {
    let ended_at: (String,) = sqlx::query_as(
        r#"UPDATE custom_action_runs
           SET exit_code = ?, stdout = ?, stderr = ?, ended_at = datetime('now')
           WHERE id = ?
           RETURNING ended_at"#,
    )
    .bind(exit_code)
    .bind(stdout)
    .bind(stderr)
    .bind(run_id)
    .fetch_one(pool)
    .await?;
    Ok(ended_at.0)
}

pub async fn list_runs(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
    limit: i64,
) -> Result<Vec<CustomActionRun>, AppError> {
    let rows = sqlx::query_as::<_, CustomActionRun>(
        r#"SELECT id, action_id, feature_id, exit_code, stdout, stderr,
                  started_at, ended_at, triggered_by
           FROM custom_action_runs
           WHERE action_id = ? AND feature_id = ?
           ORDER BY started_at DESC, id DESC
           LIMIT ?"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Latest run per action for a given feature, keyed by `action_id`.
async fn latest_runs_for_feature(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<HashMap<i64, LastRunSummary>, AppError> {
    let rows: Vec<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
        r#"SELECT r.action_id, r.exit_code, r.ended_at
           FROM custom_action_runs r
           INNER JOIN (
               SELECT action_id, MAX(id) AS max_id
               FROM custom_action_runs
               WHERE feature_id = ?
               GROUP BY action_id
           ) latest ON latest.max_id = r.id"#,
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(action_id, exit_code, ended_at)| {
            (
                action_id,
                LastRunSummary {
                    exit_code,
                    ended_at,
                },
            )
        })
        .collect())
}

// ---------------------------------------------------------------------------
// custom_action_schedules
// ---------------------------------------------------------------------------

pub async fn get_schedule(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
) -> Result<Option<CustomActionSchedule>, AppError> {
    let row = sqlx::query_as::<_, CustomActionSchedule>(
        r#"SELECT id, action_id, feature_id, interval_seconds, enabled, last_run_at
           FROM custom_action_schedules
           WHERE action_id = ? AND feature_id = ?"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn upsert_schedule(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
    interval_seconds: i64,
    enabled: bool,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO custom_action_schedules (action_id, feature_id, interval_seconds, enabled)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(action_id, feature_id) DO UPDATE SET
               interval_seconds = excluded.interval_seconds,
               enabled = excluded.enabled"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .bind(interval_seconds)
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_schedule(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM custom_action_schedules WHERE action_id = ? AND feature_id = ?")
        .bind(action_id)
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_enabled_schedules(
    pool: &SqlitePool,
) -> Result<Vec<CustomActionSchedule>, AppError> {
    let rows = sqlx::query_as::<_, CustomActionSchedule>(
        r#"SELECT id, action_id, feature_id, interval_seconds, enabled, last_run_at
           FROM custom_action_schedules
           WHERE enabled = 1"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn touch_schedule_last_run(pool: &SqlitePool, schedule_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE custom_action_schedules SET last_run_at = datetime('now') WHERE id = ?")
        .bind(schedule_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    async fn pool_with_project_and_feature() -> (SqlitePool, i64, i64) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        let project_id: i64 =
            sqlx::query_scalar("INSERT INTO projects (name, path) VALUES (?, ?) RETURNING id")
                .bind("p")
                .bind("/tmp/p")
                .fetch_one(&pool)
                .await
                .unwrap();
        let feature_id: i64 = sqlx::query_scalar(
            "INSERT INTO features (project_id, title) VALUES (?, ?) RETURNING id",
        )
        .bind(project_id)
        .bind("f")
        .fetch_one(&pool)
        .await
        .unwrap();
        (pool, project_id, feature_id)
    }

    #[tokio::test]
    async fn insert_then_get_returns_hydrated_action_with_variables() {
        let (pool, project_id, _) = pool_with_project_and_feature().await;
        let id = insert(
            &pool,
            "Greet",
            "echo hi ${NAME}",
            None,
            Scope::Project,
            Some(project_id),
        )
        .await
        .unwrap();

        let row = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.name, "Greet");
        assert_eq!(row.variable_names, vec!["NAME".to_string()]);
        assert!(row.last_run.is_none(), "no runs recorded yet");
    }

    #[tokio::test]
    async fn list_for_project_returns_global_and_project_scoped() {
        let (pool, project_id, _) = pool_with_project_and_feature().await;
        let other_project: i64 =
            sqlx::query_scalar("INSERT INTO projects (name, path) VALUES (?, ?) RETURNING id")
                .bind("o")
                .bind("/tmp/o")
                .fetch_one(&pool)
                .await
                .unwrap();
        insert(&pool, "global", "echo g", None, Scope::Global, None)
            .await
            .unwrap();
        insert(
            &pool,
            "mine",
            "echo m",
            None,
            Scope::Project,
            Some(project_id),
        )
        .await
        .unwrap();
        insert(
            &pool,
            "other",
            "echo o",
            None,
            Scope::Project,
            Some(other_project),
        )
        .await
        .unwrap();

        let rows = list_for_project(&pool, project_id, None).await.unwrap();
        let names: Vec<_> = rows.iter().map(|r| r.name.clone()).collect();
        assert!(names.contains(&"global".to_string()));
        assert!(names.contains(&"mine".to_string()));
        assert!(!names.contains(&"other".to_string()));
    }

    #[tokio::test]
    async fn list_for_project_embeds_last_run_for_feature() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        let run_id = insert_run(&pool, action_id, feature_id, TriggeredBy::Manual)
            .await
            .unwrap();
        finalize_run(&pool, run_id, Some(0), "ok\n", "")
            .await
            .unwrap();

        let rows = list_for_project(&pool, project_id, Some(feature_id))
            .await
            .unwrap();
        let action = rows.iter().find(|a| a.id == action_id).unwrap();
        let last = action.last_run.as_ref().expect("last_run embedded");
        assert_eq!(last.exit_code, Some(0));
        assert!(last.ended_at.is_some());
    }

    #[tokio::test]
    async fn update_partial_keeps_unset_fields() {
        let (pool, project_id, _) = pool_with_project_and_feature().await;
        let id = insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        update(&pool, id, Some("renamed"), None, None, None, None, None)
            .await
            .unwrap();
        let row = get(&pool, id).await.unwrap().unwrap();
        assert_eq!(row.name, "renamed");
        assert_eq!(row.command, "echo");
    }

    #[tokio::test]
    async fn update_can_clear_icon_via_some_none() {
        let (pool, project_id, _) = pool_with_project_and_feature().await;
        let id = insert(
            &pool,
            "n",
            "echo",
            Some("data:image/png;base64,xx"),
            Scope::Project,
            Some(project_id),
        )
        .await
        .unwrap();
        update(&pool, id, None, None, Some(None), None, None, None)
            .await
            .unwrap();
        let row = get(&pool, id).await.unwrap().unwrap();
        assert!(row.icon_data.is_none());
    }

    #[tokio::test]
    async fn update_returns_not_found_for_missing_id() {
        let (pool, _, _) = pool_with_project_and_feature().await;
        let err = update(&pool, 9_999, Some("x"), None, None, None, None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn delete_cascades_to_variables_runs_and_schedules() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        upsert_variable(&pool, action_id, feature_id, "X", "v")
            .await
            .unwrap();
        let run_id = insert_run(&pool, action_id, feature_id, TriggeredBy::Manual)
            .await
            .unwrap();
        finalize_run(&pool, run_id, Some(0), "", "").await.unwrap();
        upsert_schedule(&pool, action_id, feature_id, 60, true)
            .await
            .unwrap();

        delete(&pool, action_id).await.unwrap();

        assert!(list_variables(&pool, action_id, feature_id)
            .await
            .unwrap()
            .is_empty());
        assert!(list_runs(&pool, action_id, feature_id, 10)
            .await
            .unwrap()
            .is_empty());
        assert!(get_schedule(&pool, action_id, feature_id)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn upsert_variable_overwrites_existing_value() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        upsert_variable(&pool, action_id, feature_id, "X", "first")
            .await
            .unwrap();
        upsert_variable(&pool, action_id, feature_id, "X", "second")
            .await
            .unwrap();
        let vars = list_variables(&pool, action_id, feature_id).await.unwrap();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].value, "second");
    }

    #[tokio::test]
    async fn finalize_run_returns_stamped_ended_at() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        let run_id = insert_run(&pool, action_id, feature_id, TriggeredBy::Schedule)
            .await
            .unwrap();
        let ended = finalize_run(&pool, run_id, Some(2), "out", "err")
            .await
            .unwrap();
        assert!(
            !ended.is_empty(),
            "finalize_run returns the stamped timestamp"
        );

        let runs = list_runs(&pool, action_id, feature_id, 10).await.unwrap();
        assert_eq!(runs[0].exit_code, Some(2));
        assert_eq!(runs[0].stdout, "out");
        assert_eq!(runs[0].stderr, "err");
        assert_eq!(runs[0].ended_at.as_deref(), Some(ended.as_str()));
    }

    #[tokio::test]
    async fn upsert_schedule_then_disable_via_delete() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(&pool, "n", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        upsert_schedule(&pool, action_id, feature_id, 30, true)
            .await
            .unwrap();
        let s = get_schedule(&pool, action_id, feature_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s.interval_seconds, 30);
        assert!(s.enabled);

        upsert_schedule(&pool, action_id, feature_id, 90, true)
            .await
            .unwrap();
        let s2 = get_schedule(&pool, action_id, feature_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s2.interval_seconds, 90, "upsert overrides interval");

        delete_schedule(&pool, action_id, feature_id).await.unwrap();
        assert!(get_schedule(&pool, action_id, feature_id)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn list_enabled_schedules_filters_disabled_rows() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let a = insert(&pool, "a", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        let b = insert(&pool, "b", "echo", None, Scope::Project, Some(project_id))
            .await
            .unwrap();
        upsert_schedule(&pool, a, feature_id, 30, true)
            .await
            .unwrap();
        upsert_schedule(&pool, b, feature_id, 30, false)
            .await
            .unwrap();

        let enabled = list_enabled_schedules(&pool).await.unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].action_id, a);
    }
}
