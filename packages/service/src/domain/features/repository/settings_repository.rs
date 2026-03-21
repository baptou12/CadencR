use sqlx::SqlitePool;

use crate::error::AppError;
use super::super::models::{FeatureSetting, FeatureModelSettings};

pub async fn get_feature_settings(pool: &SqlitePool, feature_id: i64) -> Result<Vec<FeatureSetting>, AppError> {
    // First get inline columns from features table
    let row: Option<(
        Option<String>, Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>, Option<String>, Option<String>,
        Option<String>, Option<String>,
    )> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer", model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution
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
    const VALID_MODEL_TYPES: &[&str] = &["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"];
    if !VALID_MODEL_TYPES.contains(&model_type) {
        return Err(AppError::BadRequest(format!("Invalid model type: {}", model_type)));
    }
    let col = format!("model_{}", model_type);
    let sql = format!(r#"UPDATE features SET "{}" = ? WHERE id = ?"#, col);
    sqlx::query(&sql)
        .bind(model)
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}
