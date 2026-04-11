use sqlx::SqlitePool;

use super::super::models::{Phase, Plan, PlanProgress};
use crate::error::AppError;

pub async fn get_plan_with_phases(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<(Plan, Vec<Phase>)>, AppError> {
    let plan: Option<Plan> = sqlx::query_as::<_, Plan>(
        r#"SELECT id, feature_id, COALESCE(title, '') as title, status, summary, context,
           clarifications, completion_conditions,
           COALESCE(created_at, datetime('now')) as created_at
           FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let plan = match plan {
        None => return Ok(None),
        Some(p) => p,
    };

    let phases: Vec<Phase> = sqlx::query_as::<_, Phase>(
        r#"SELECT id, plan_id, step_number, title, status, complexity, commit_message,
           prompt, phase_type, implementation_notes, deviations, order_index, depends_on
           FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC"#,
    )
    .bind(plan.id)
    .fetch_all(pool)
    .await?;

    Ok(Some((plan, phases)))
}

pub async fn get_plan_progress(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<PlanProgress, AppError> {
    let plan_row: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let plan_id = match plan_row {
        None => return Ok(PlanProgress { total: 0, done: 0 }),
        Some(r) => r.0,
    };

    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ?")
        .bind(plan_id)
        .fetch_one(pool)
        .await?;
    let done: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ? AND status = 'completed'")
            .bind(plan_id)
            .fetch_one(pool)
            .await?;

    Ok(PlanProgress {
        total: total.0,
        done: done.0,
    })
}

pub async fn reset_phase(pool: &SqlitePool, phase_id: i64) -> Result<(), AppError> {
    // Validate phase exists and is in a resettable state
    let phase_row: Option<(i64, String)> =
        sqlx::query_as("SELECT plan_id, status FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_optional(pool)
            .await?;

    let (plan_id, status) = match phase_row {
        None => return Err(AppError::NotFound(format!("Phase {phase_id} not found"))),
        Some(r) => r,
    };

    if status != "completed" && status != "error" {
        return Err(AppError::BadRequest(
            "Can only reset phases in completed or error status".to_string(),
        ));
    }

    // Get step_number to check next phase
    let step_row: Option<(i64,)> = sqlx::query_as("SELECT step_number FROM phases WHERE id = ?")
        .bind(phase_id)
        .fetch_optional(pool)
        .await?;
    let step_number = step_row.map(|r| r.0).unwrap_or(0);

    let next_phase: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM phases WHERE plan_id = ? AND step_number > ? ORDER BY step_number ASC, order_index ASC LIMIT 1",
    )
    .bind(plan_id)
    .bind(step_number)
    .fetch_optional(pool)
    .await?;

    if let Some((next_status,)) = next_phase {
        if next_status == "completed" {
            return Err(AppError::BadRequest(
                "Cannot reset a phase when the next phase is already completed".to_string(),
            ));
        }
    }

    // Delete sessions and messages for this phase, then reset
    let mut tx = pool.begin().await?;

    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE phase_id = ?)",
    )
    .bind(phase_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE phase_id = ?")
        .bind(phase_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "UPDATE phases SET status = 'pending', implementation_notes = NULL, deviations = NULL WHERE id = ?",
    )
    .bind(phase_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn override_phase_status(
    pool: &SqlitePool,
    phase_id: i64,
    status: &str,
) -> Result<(), AppError> {
    let exists: Option<(i64,)> = sqlx::query_as("SELECT id FROM phases WHERE id = ?")
        .bind(phase_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("Phase {phase_id} not found")));
    }
    sqlx::query("UPDATE phases SET status = ? WHERE id = ?")
        .bind(status)
        .bind(phase_id)
        .execute(pool)
        .await?;
    Ok(())
}
