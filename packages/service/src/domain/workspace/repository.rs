use sqlx::SqlitePool;
use crate::error::AppError;
use super::models::{Setting, ModelSettings};

const DEFAULT_MODEL: &str = "claude-opus-4-6";
const MODEL_KEYS: &[(&str, &str)] = &[
    ("plan", "model_plan"),
    ("prd", "model_prd"),
    ("execute", "model_execute"),
    ("risk", "model_risk"),
    ("review", "model_review"),
    ("review-fixer", "model_review-fixer"),
    ("session", "model_session"),
    ("qa", "model_qa"),
    ("retro", "model_retro"),
];

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_settings(pool: &SqlitePool) -> Result<Vec<Setting>, AppError> {
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT key, value FROM settings")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(key, value)| Setting { key, value }).collect())
}

pub async fn get_model_settings(pool: &SqlitePool) -> Result<ModelSettings, AppError> {
    let mut plan = DEFAULT_MODEL.to_string();
    let mut prd = DEFAULT_MODEL.to_string();
    let mut execute = DEFAULT_MODEL.to_string();
    let mut risk = DEFAULT_MODEL.to_string();
    let mut review = DEFAULT_MODEL.to_string();
    let mut review_fixer = DEFAULT_MODEL.to_string();
    let mut session = DEFAULT_MODEL.to_string();
    let mut qa = DEFAULT_MODEL.to_string();
    let mut retro = DEFAULT_MODEL.to_string();

    for (agent_type, db_key) in MODEL_KEYS {
        let val = get_setting(pool, db_key).await?;
        let model = val.unwrap_or_else(|| DEFAULT_MODEL.to_string());
        match *agent_type {
            "plan" => plan = model,
            "prd" => prd = model,
            "execute" => execute = model,
            "risk" => risk = model,
            "review" => review = model,
            "review-fixer" => review_fixer = model,
            "session" => session = model,
            "qa" => qa = model,
            "retro" => retro = model,
            _ => {}
        }
    }

    Ok(ModelSettings { plan, prd, execute, risk, review, review_fixer, session, qa, retro })
}

pub async fn set_model_setting(pool: &SqlitePool, agent_type: &str, model_id: &str) -> Result<(), AppError> {
    let db_key = format!("model_{}", agent_type);
    set_setting(pool, &db_key, model_id).await
}

pub async fn get_prompt_history(pool: &SqlitePool, project_id: i64) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

pub async fn add_prompt_entry(pool: &SqlitePool, project_id: i64, content: &str) -> Result<bool, AppError> {
    // Dedup: skip if the most recent entry has the same content
    let latest: Option<(String,)> = sqlx::query_as(
        "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    if let Some((latest_content,)) = latest {
        if latest_content == content {
            return Ok(false); // skipped
        }
    }

    sqlx::query("INSERT INTO prompt_history (project_id, content) VALUES (?, ?)")
        .bind(project_id)
        .bind(content)
        .execute(pool)
        .await?;

    // Trim to 100 entries
    sqlx::query(
        "DELETE FROM prompt_history WHERE project_id = ? AND id NOT IN \
         (SELECT id FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100)",
    )
    .bind(project_id)
    .bind(project_id)
    .execute(pool)
    .await?;

    Ok(true) // inserted
}
