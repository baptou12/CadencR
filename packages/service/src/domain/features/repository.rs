use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{Feature, Plan, Phase, PlanProgress, FeatureSetting, FeatureModelSettings};

pub async fn list_by_project(pool: &SqlitePool, project_id: i64) -> Result<Vec<Feature>, AppError> {
    let rows = sqlx::query_as::<_, Feature>(
        r#"SELECT id, project_id, title, COALESCE(type, 'feature') as type_, status,
           prd, workflow_step, workflow_config,
           model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer" as model_review_fixer, model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution,
           COALESCE(created_at, datetime('now')) as created_at
           FROM features WHERE project_id = ? ORDER BY created_at DESC"#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Feature>, AppError> {
    let row = sqlx::query_as::<_, Feature>(
        r#"SELECT id, project_id, title, COALESCE(type, 'feature') as type_, status,
           prd, workflow_step, workflow_config,
           model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer" as model_review_fixer, model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution,
           COALESCE(created_at, datetime('now')) as created_at
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
) -> Result<i64, AppError> {
    let result = sqlx::query(
        "INSERT INTO features (project_id, title, type) VALUES (?, ?, ?)",
    )
    .bind(project_id)
    .bind(title)
    .bind(type_)
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
        sqlx::query_as("SELECT COALESCE(type, 'feature'), prd FROM features WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

    let (ftype, prd) = match feature_row {
        None => return Ok(true),
        Some(r) => r,
    };

    // Never consider empty if there are active sessions
    let active: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused', 'waiting') LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    if active.is_some() {
        return Ok(false);
    }

    if ftype == "session" {
        let msg: Option<(i64,)> = sqlx::query_as(
            "SELECT 1 FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        return Ok(msg.is_none());
    }

    let has_prd = prd.map(|p| !p.trim().is_empty()).unwrap_or(false);
    let has_plan: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM plans WHERE feature_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(!has_prd && has_plan.is_none())
}

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
           prompt, phase_type, implementation_notes, deviations, order_index
           FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC"#,
    )
    .bind(plan.id)
    .fetch_all(pool)
    .await?;

    Ok(Some((plan, phases)))
}

pub async fn get_plan_progress(pool: &SqlitePool, feature_id: i64) -> Result<PlanProgress, AppError> {
    let plan_row: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1")
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
    let done: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM phases WHERE plan_id = ? AND status = 'completed'")
        .bind(plan_id)
        .fetch_one(pool)
        .await?;

    Ok(PlanProgress { total: total.0, done: done.0 })
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
    let step_row: Option<(i64,)> =
        sqlx::query_as("SELECT step_number FROM phases WHERE id = ?")
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
    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE phase_id = ?)",
    )
    .bind(phase_id)
    .execute(pool)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE phase_id = ?")
        .bind(phase_id)
        .execute(pool)
        .await?;

    sqlx::query(
        "UPDATE phases SET status = 'pending', implementation_notes = NULL, deviations = NULL WHERE id = ?",
    )
    .bind(phase_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn override_phase_status(pool: &SqlitePool, phase_id: i64, status: &str) -> Result<(), AppError> {
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM phases WHERE id = ?")
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

pub async fn get_feature_settings(pool: &SqlitePool, feature_id: i64) -> Result<Vec<FeatureSetting>, AppError> {
    // First get inline columns from features table
    let row: Option<(
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>,
    )> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer", model_session, model_qa, model_retro,
           agent_autonomy, CAST(parallel_execution AS TEXT)
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let mut result = Vec::new();
    if let Some((plan, prd, exec, risk, review, review_fixer, session, qa, retro, autonomy, parallel)) = row {
        let columns = [
            ("model_plan", plan),
            ("model_prd", prd),
            ("model_execute", exec),
            ("model_risk", risk),
            ("model_review", review),
            ("model_review-fixer", review_fixer),
            ("model_session", session),
            ("model_qa", qa),
            ("model_retro", retro),
            ("agent_autonomy", autonomy),
            ("parallel_execution", parallel),
        ];
        for (key, val) in columns {
            if let Some(v) = val {
                result.push(FeatureSetting { key: key.to_string(), value: v });
            }
        }
    }

    // Then get feature_settings table entries
    let settings: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM feature_settings WHERE feature_id = ?")
            .bind(feature_id)
            .fetch_all(pool)
            .await?;
    for (key, value) in settings {
        result.push(FeatureSetting { key, value });
    }

    Ok(result)
}

pub async fn set_feature_setting(pool: &SqlitePool, feature_id: i64, key: &str, value: &str) -> Result<(), AppError> {
    let real_columns = [
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_review-fixer", "model_session", "model_qa", "model_retro",
        "agent_autonomy", "parallel_execution",
    ];

    if real_columns.contains(&key) {
        let sql = format!(r#"UPDATE features SET "{}" = ? WHERE id = ?"#, key);
        sqlx::query(&sql)
            .bind(value)
            .bind(feature_id)
            .execute(pool)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
        )
        .bind(feature_id)
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_feature_model_settings(pool: &SqlitePool, feature_id: i64) -> Result<FeatureModelSettings, AppError> {
    let row: Option<(
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>,
    )> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer", model_session, model_qa, model_retro
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let (plan, prd, execute, risk, review, review_fixer, session, qa, retro) =
        row.unwrap_or_default();

    Ok(FeatureModelSettings {
        plan: plan.unwrap_or_default(),
        prd: prd.unwrap_or_default(),
        execute: execute.unwrap_or_default(),
        risk: risk.unwrap_or_default(),
        review: review.unwrap_or_default(),
        review_fixer: review_fixer.unwrap_or_default(),
        session: session.unwrap_or_default(),
        qa: qa.unwrap_or_default(),
        retro: retro.unwrap_or_default(),
    })
}

pub async fn set_feature_model_setting(
    pool: &SqlitePool,
    feature_id: i64,
    model_type: &str,
    model: &str,
) -> Result<(), AppError> {
    let col = format!("model_{}", model_type);
    let sql = format!(r#"UPDATE features SET "{}" = ? WHERE id = ?"#, col);
    sqlx::query(&sql)
        .bind(model)
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn resolve_working_dir(pool: &SqlitePool, feature_id: i64, project_id: i64) -> Result<Option<String>, AppError> {
    let feature_row: Option<(String,)> =
        sqlx::query_as("SELECT COALESCE(type, 'feature') FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await?;

    if let Some((ftype,)) = feature_row {
        if ftype != "session" {
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
    }

    let project_path: Option<(String,)> =
        sqlx::query_as("SELECT path FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_optional(pool)
            .await?;
    Ok(project_path.map(|r| r.0))
}

pub async fn delete_feature(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    // Get all plan IDs for cascade delete
    let plan_ids: Vec<(i64,)> =
        sqlx::query_as("SELECT id FROM plans WHERE feature_id = ?")
            .bind(id)
            .fetch_all(pool)
            .await?;

    for (plan_id,) in plan_ids {
        sqlx::query("DELETE FROM phases WHERE plan_id = ?")
            .bind(plan_id)
            .execute(pool)
            .await?;
    }

    sqlx::query("DELETE FROM plans WHERE feature_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)",
    )
    .bind(id)
    .execute(pool)
    .await?;

    sqlx::query("DELETE FROM agent_sessions WHERE feature_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM feature_settings WHERE feature_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM diff_comments WHERE feature_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM diff_viewed_files WHERE feature_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM features WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}
