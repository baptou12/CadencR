use sqlx::SqlitePool;

use crate::error::AppError;
use super::super::models::Feature;

pub async fn list_by_project(pool: &SqlitePool, project_id: i64) -> Result<Vec<Feature>, AppError> {
    let rows = sqlx::query_as::<_, Feature>(
        r#"SELECT id, project_id, title, COALESCE(type, 'ws-feature') as type_, status,
           prd, workflow_step, workflow_config,
           model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer" as model_review_fixer, model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution,
           COALESCE(created_at, datetime('now')) as created_at,
           workflow_definition_id
           FROM features WHERE project_id = ? ORDER BY created_at DESC"#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Feature>, AppError> {
    let row = sqlx::query_as::<_, Feature>(
        r#"SELECT id, project_id, title, COALESCE(type, 'ws-feature') as type_, status,
           prd, workflow_step, workflow_config,
           model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer" as model_review_fixer, model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution,
           COALESCE(created_at, datetime('now')) as created_at,
           workflow_definition_id
           FROM features WHERE id = ?"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn create_feature(
    pool: &SqlitePool,
    project_id: i64,
    title: &str,
    type_: &str,
    workflow_definition_id: Option<i64>,
) -> Result<i64, AppError> {
    let result = sqlx::query(
        "INSERT INTO features (project_id, title, type, workflow_definition_id) VALUES (?, ?, ?, ?)",
    )
    .bind(project_id)
    .bind(title)
    .bind(type_)
    .bind(workflow_definition_id)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn get_max_session_num(pool: &SqlitePool, project_id: i64) -> Result<i64, AppError> {
    let row: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) FROM features WHERE project_id = ? AND title LIKE 'Session %'",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.0).unwrap_or(0))
}

pub async fn update_status(pool: &SqlitePool, id: i64, status: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE features SET status = ? WHERE id = ?")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_title(pool: &SqlitePool, id: i64, title: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE features SET title = ? WHERE id = ?")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_prd(pool: &SqlitePool, id: i64) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT prd FROM features WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn is_empty(pool: &SqlitePool, id: i64) -> Result<bool, AppError> {
    let feature_row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT COALESCE(type, 'ws-feature'), prd FROM features WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

    let (ftype, prd) = match feature_row {
        None => return Ok(true),
        Some(r) => r,
    };

    // For ws-sessions, emptiness is purely based on whether messages exist
    // (a paused session with no messages is still empty).
    if ftype == "ws-session" {
        let msg: Option<(i64,)> = sqlx::query_as(
            "SELECT 1 FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        return Ok(msg.is_none());
    }

    // Never consider empty if there are active sessions (for non-ws-session features)
    let active: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused', 'waiting') LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    if active.is_some() {
        return Ok(false);
    }

    let has_prd = prd.map(|p| !p.trim().is_empty()).unwrap_or(false);
    let has_plan: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM plans WHERE feature_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(!has_prd && has_plan.is_none())
}

pub async fn resolve_working_dir(pool: &SqlitePool, feature_id: i64, project_id: i64) -> Result<Option<String>, AppError> {
    let feature_row: Option<(String,)> =
        sqlx::query_as("SELECT COALESCE(type, 'ws-feature') FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;

    if feature_row.is_some() {
        // Check worktree path for all feature types (ws-feature and ws-session)
        let setting: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .bind(feature_id)
        .fetch_optional(pool)
        .await?;
        if let Some((path,)) = setting {
            return Ok(Some(path));
        }
    }

    let project_path: Option<(String,)> =
        sqlx::query_as("SELECT path FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;
    Ok(project_path.map(|r| r.0))
}

pub async fn delete_feature(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // Delete workflow_queue first — it has FKs to phases, agent_sessions, and features
    sqlx::query("DELETE FROM workflow_queue WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Delete phases (FK to plans)
    let plan_ids: Vec<(i64,)> =
        sqlx::query_as("SELECT id FROM plans WHERE feature_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;

    for (plan_id,) in plan_ids {
        sqlx::query("DELETE FROM phases WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM plans WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Delete session children, then sessions
    sqlx::query(
        "DELETE FROM session_claude_ids WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM feature_settings WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM diff_comments WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM diff_viewed_files WHERE feature_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM features WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_workflow_status(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<crate::domain::workflow::status::WorkflowStatus, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(workflow_status, 'idle') FROM features WHERE id = ?",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let status_str = row.map(|r| r.0).unwrap_or_else(|| "idle".to_string());
    status_str.parse().map_err(|e: String| AppError::BadRequest(e))
}

pub async fn set_workflow_status(
    pool: &SqlitePool,
    feature_id: i64,
    new_status: crate::domain::workflow::status::WorkflowStatus,
) -> Result<crate::domain::workflow::status::WorkflowStatus, AppError> {
    use crate::domain::workflow::status::WorkflowStatus;

    // Read current status
    let current = get_workflow_status(pool, feature_id).await.unwrap_or(WorkflowStatus::Idle);

    // Validate transition
    current.transition(new_status).map_err(|e| {
        tracing::warn!(feature_id, from = %current, to = %new_status, "invalid workflow transition (forcing)");
        AppError::BadRequest(e)
    })?;

    // Write to DB
    sqlx::query("UPDATE features SET workflow_status = ? WHERE id = ?")
        .bind(new_status.to_string())
        .bind(feature_id)
        .execute(pool)
        .await?;

    Ok(new_status)
}

/// Force-set workflow status without transition validation.
/// Used for recovery/reconnect scenarios where the DB state may be stale.
pub async fn force_workflow_status(
    pool: &SqlitePool,
    feature_id: i64,
    status: crate::domain::workflow::status::WorkflowStatus,
) -> Result<(), AppError> {
    sqlx::query("UPDATE features SET workflow_status = ? WHERE id = ?")
        .bind(status.to_string())
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}
