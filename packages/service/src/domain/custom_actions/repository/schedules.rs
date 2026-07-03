use sqlx::SqlitePool;

use super::super::models::CustomActionSchedule;
use crate::error::AppError;

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
    use super::super::test_support::pool_with_project_and_feature;
    use super::*;
    use crate::domain::custom_actions::models::Scope;
    use crate::domain::custom_actions::repository::insert;
    #[tokio::test]
    async fn upsert_schedule_then_disable_via_delete() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(
            &pool,
            "n",
            "echo",
            None,
            Scope::Project,
            Some(project_id),
            false,
        )
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
        let a = insert(
            &pool,
            "a",
            "echo",
            None,
            Scope::Project,
            Some(project_id),
            false,
        )
        .await
        .unwrap();
        let b = insert(
            &pool,
            "b",
            "echo",
            None,
            Scope::Project,
            Some(project_id),
            false,
        )
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
