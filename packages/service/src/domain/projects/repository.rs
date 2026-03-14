use sqlx::SqlitePool;
use crate::error::AppError;
use super::models::{Project, ProjectSetting, ProjectModelSettings};

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT id, name, path, branch_prefix, qa_prompt, agent_autonomy, parallel_execution, created_at FROM projects ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, path, branch_prefix, qa_prompt, agent_autonomy, parallel_execution, created_at)| Project {
            id,
            name,
            path,
            branch_prefix,
            qa_prompt,
            agent_autonomy,
            parallel_execution,
            created_at,
        })
        .collect())
}

pub async fn create_project(pool: &SqlitePool, name: &str, path: &str) -> Result<Project, AppError> {
    let id = sqlx::query("INSERT INTO projects (name, path) VALUES (?, ?)")
        .bind(name)
        .bind(path)
        .execute(pool)
        .await?
        .last_insert_rowid();

    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT id, name, path, branch_prefix, qa_prompt, agent_autonomy, parallel_execution, created_at FROM projects WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(Project {
        id: row.0,
        name: row.1,
        path: row.2,
        branch_prefix: row.3,
        qa_prompt: row.4,
        agent_autonomy: row.5,
        parallel_execution: row.6,
        created_at: row.7,
    })
}

pub async fn delete_project(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    // Get feature IDs
    let feature_ids: Vec<i64> = sqlx::query_as::<_, (i64,)>(
        "SELECT id FROM features WHERE project_id = ?",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|r| r.0)
    .collect();

    if !feature_ids.is_empty() {
        // Get plan IDs and session IDs for these features
        let ph = feature_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

        let plan_ids: Vec<i64> = {
            let query = format!("SELECT id FROM plans WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query_as::<_, (i64,)>(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.fetch_all(&mut *tx).await?.into_iter().map(|r| r.0).collect()
        };

        let session_ids: Vec<i64> = {
            let query = format!("SELECT id FROM agent_sessions WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query_as::<_, (i64,)>(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.fetch_all(&mut *tx).await?.into_iter().map(|r| r.0).collect()
        };

        // Delete agent_messages for sessions
        if !session_ids.is_empty() {
            let sp = session_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let query = format!("DELETE FROM agent_messages WHERE session_id IN ({})", sp);
            let mut q = sqlx::query(&query);
            for sid in &session_ids {
                q = q.bind(sid);
            }
            q.execute(&mut *tx).await?;
        }

        // Delete phases for plans
        if !plan_ids.is_empty() {
            let pp = plan_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let query = format!("DELETE FROM phases WHERE plan_id IN ({})", pp);
            let mut q = sqlx::query(&query);
            for pid in &plan_ids {
                q = q.bind(pid);
            }
            q.execute(&mut *tx).await?;
        }

        // Delete feature children
        {
            let query = format!("DELETE FROM agent_sessions WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM plans WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM feature_settings WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM diff_viewed_files WHERE feature_id IN ({})", ph);
            let mut q = sqlx::query(&query);
            for fid in &feature_ids {
                q = q.bind(fid);
            }
            q.execute(&mut *tx).await?;
        }
        {
            let query = format!("DELETE FROM features WHERE project_id = ?");
            sqlx::query(&query).bind(id).execute(&mut *tx).await?;
        }
    }

    // Delete project children and project itself
    sqlx::query("DELETE FROM project_settings WHERE project_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_project_settings(pool: &SqlitePool, project_id: i64) -> Result<Vec<ProjectSetting>, AppError> {
    // Read known columns from the projects table
    let column_row: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT agent_autonomy, branch_prefix, qa_prompt, parallel_execution FROM projects WHERE id = ?"
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

    let mut settings: Vec<ProjectSetting> = Vec::new();

    if let Some((agent_autonomy, branch_prefix, qa_prompt, parallel_execution)) = column_row {
        let column_settings = [
            ("agent_autonomy", agent_autonomy),
            ("branch_prefix", branch_prefix),
            ("qa_prompt", qa_prompt),
            ("parallel_execution", parallel_execution),
        ];
        for (key, value) in column_settings {
            if value.is_some() {
                settings.push(ProjectSetting { key: key.to_string(), value });
            }
        }
    }

    // Read additional settings from the key-value table
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT key, value FROM project_settings WHERE project_id = ?")
            .bind(project_id)
            .fetch_all(pool)
            .await?;
    settings.extend(rows.into_iter().map(|(key, value)| ProjectSetting { key, value }));

    Ok(settings)
}

pub async fn set_project_setting(pool: &SqlitePool, project_id: i64, key: &str, value: &str) -> Result<(), AppError> {
    let real_columns = [
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_session", "model_qa", "agent_autonomy", "branch_prefix", "qa_prompt",
        "parallel_execution",
    ];

    if real_columns.contains(&key) {
        let query = format!("UPDATE projects SET \"{}\" = ? WHERE id = ?", key);
        sqlx::query(&query)
            .bind(value)
            .bind(project_id)
            .execute(pool)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value",
        )
        .bind(project_id)
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_project_model_settings(pool: &SqlitePool, project_id: i64) -> Result<ProjectModelSettings, AppError> {
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review, "model_review-fixer", model_session, model_qa, model_retro FROM projects WHERE id = ?"#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    let (plan, prd, execute, risk, review, review_fixer, session, qa, retro) =
        row.unwrap_or_default();

    Ok(ProjectModelSettings {
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

pub async fn set_project_model_setting(pool: &SqlitePool, project_id: i64, model_type: &str, model: &str) -> Result<(), AppError> {
    let col = format!("model_{}", model_type);
    let query = format!("UPDATE projects SET \"{}\" = ? WHERE id = ?", col);
    sqlx::query(&query)
        .bind(model)
        .bind(project_id)
        .execute(pool)
        .await?;
    Ok(())
}
