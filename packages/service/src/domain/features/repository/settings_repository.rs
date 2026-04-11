use sqlx::SqlitePool;

use super::super::models::{FeatureModelSettings, FeatureProviderSettings, FeatureSetting};
use crate::domain::agents::runtime::{
    default_provider_settings, runtime_setting_key, validate_agent_type,
};
use crate::error::AppError;

pub async fn get_feature_settings(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<FeatureSetting>, AppError> {
    // First get inline columns from features table
    let row: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT model_plan, model_prd, model_execute, model_risk, model_review,
           "model_review-fixer", model_session, model_qa, model_retro,
           agent_autonomy, parallel_execution
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let provider_row: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT agent_runtime_plan, agent_runtime_prd, agent_runtime_execute, agent_runtime_risk,
           agent_runtime_review, "agent_runtime_review-fixer", agent_runtime_session,
           agent_runtime_qa, agent_runtime_retro
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let mut result = Vec::new();
    if let Some((
        plan,
        prd,
        exec,
        risk,
        review,
        review_fixer,
        session,
        qa,
        retro,
        autonomy,
        parallel,
    )) = row
    {
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
                result.push(FeatureSetting {
                    key: key.to_string(),
                    value: v,
                });
            }
        }
    }

    if let Some((
        runtime_plan,
        runtime_prd,
        runtime_execute,
        runtime_risk,
        runtime_review,
        runtime_review_fixer,
        runtime_session,
        runtime_qa,
        runtime_retro,
    )) = provider_row
    {
        let columns = [
            ("agent_runtime_plan", runtime_plan),
            ("agent_runtime_prd", runtime_prd),
            ("agent_runtime_execute", runtime_execute),
            ("agent_runtime_risk", runtime_risk),
            ("agent_runtime_review", runtime_review),
            ("agent_runtime_review-fixer", runtime_review_fixer),
            ("agent_runtime_session", runtime_session),
            ("agent_runtime_qa", runtime_qa),
            ("agent_runtime_retro", runtime_retro),
        ];
        for (key, val) in columns {
            if let Some(v) = val {
                result.push(FeatureSetting {
                    key: key.to_string(),
                    value: v,
                });
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

pub async fn set_feature_setting(
    pool: &SqlitePool,
    feature_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    let real_columns = [
        "model_plan",
        "model_prd",
        "model_execute",
        "model_risk",
        "model_review",
        "model_review-fixer",
        "model_session",
        "model_qa",
        "model_retro",
        "agent_runtime_plan",
        "agent_runtime_prd",
        "agent_runtime_execute",
        "agent_runtime_risk",
        "agent_runtime_review",
        "agent_runtime_review-fixer",
        "agent_runtime_session",
        "agent_runtime_qa",
        "agent_runtime_retro",
        "agent_autonomy",
        "parallel_execution",
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

pub async fn get_feature_model_settings(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<FeatureModelSettings, AppError> {
    let row: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
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
    if !validate_agent_type(model_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid model type: {}",
            model_type
        )));
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

pub async fn get_feature_provider_settings(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<FeatureProviderSettings, AppError> {
    let row: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        r#"SELECT agent_runtime_plan, agent_runtime_prd, agent_runtime_execute, agent_runtime_risk,
           agent_runtime_review, "agent_runtime_review-fixer", agent_runtime_session,
           agent_runtime_qa, agent_runtime_retro
           FROM features WHERE id = ?"#,
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await?;

    let (plan, prd, execute, risk, review, review_fixer, session, qa, retro) =
        row.unwrap_or_default();
    let defaults = default_provider_settings();

    Ok(FeatureProviderSettings {
        plan: plan.unwrap_or(defaults.plan),
        prd: prd.unwrap_or(defaults.prd),
        execute: execute.unwrap_or(defaults.execute),
        risk: risk.unwrap_or(defaults.risk),
        review: review.unwrap_or(defaults.review),
        review_fixer: review_fixer.unwrap_or(defaults.review_fixer),
        session: session.unwrap_or(defaults.session),
        qa: qa.unwrap_or(defaults.qa),
        retro: retro.unwrap_or(defaults.retro),
    })
}

pub async fn set_feature_provider_setting(
    pool: &SqlitePool,
    feature_id: i64,
    provider_type: &str,
    provider: &str,
) -> Result<(), AppError> {
    if !validate_agent_type(provider_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid provider type: {}",
            provider_type
        )));
    }
    let col = runtime_setting_key(provider_type);
    let sql = format!(r#"UPDATE features SET "{}" = ? WHERE id = ?"#, col);
    sqlx::query(&sql)
        .bind(provider)
        .bind(feature_id)
        .execute(pool)
        .await?;
    Ok(())
}
