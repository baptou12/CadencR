use super::models::{AgentProviderSettings, ModelSettings, Setting};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashMap;

use crate::domain::agents::providers::provider_default_model;
use crate::domain::agents::runtime::{
    default_provider_settings, runtime_setting_key, validate_agent_type,
};

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

fn provider_keys() -> [(&'static str, String); 9] {
    [
        ("plan", runtime_setting_key("plan")),
        ("prd", runtime_setting_key("prd")),
        ("execute", runtime_setting_key("execute")),
        ("risk", runtime_setting_key("risk")),
        ("review", runtime_setting_key("review")),
        ("review-fixer", runtime_setting_key("review-fixer")),
        ("session", runtime_setting_key("session")),
        ("qa", runtime_setting_key("qa")),
        ("retro", runtime_setting_key("retro")),
    ]
}

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
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
    let rows: Vec<(String, Option<String>)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|(key, value)| Setting { key, value })
        .collect())
}

pub async fn get_model_settings(pool: &SqlitePool) -> Result<ModelSettings, AppError> {
    let provider_settings = get_provider_settings(pool).await?;
    let provider_by_agent = [
        ("plan", provider_settings.plan.as_str()),
        ("prd", provider_settings.prd.as_str()),
        ("execute", provider_settings.execute.as_str()),
        ("risk", provider_settings.risk.as_str()),
        ("review", provider_settings.review.as_str()),
        ("review-fixer", provider_settings.review_fixer.as_str()),
        ("session", provider_settings.session.as_str()),
        ("qa", provider_settings.qa.as_str()),
        ("retro", provider_settings.retro.as_str()),
    ];
    let mut defaults_by_provider = HashMap::new();
    let mut models_by_agent = HashMap::new();

    for (agent_type, provider_id) in provider_by_agent {
        if !defaults_by_provider.contains_key(provider_id) {
            let default_model = provider_default_model(provider_id)
                .await
                .unwrap_or_else(|| "opus".to_string());
            defaults_by_provider.insert(provider_id.to_string(), default_model);
        }
        if let Some(default_model) = defaults_by_provider.get(provider_id) {
            models_by_agent.insert(agent_type, default_model.clone());
        }
    }

    for (agent_type, db_key) in MODEL_KEYS {
        if let Some(model) = get_setting(pool, db_key).await? {
            models_by_agent.insert(*agent_type, model);
        }
    }

    Ok(ModelSettings {
        plan: models_by_agent.remove("plan").unwrap_or_default(),
        prd: models_by_agent.remove("prd").unwrap_or_default(),
        execute: models_by_agent.remove("execute").unwrap_or_default(),
        risk: models_by_agent.remove("risk").unwrap_or_default(),
        review: models_by_agent.remove("review").unwrap_or_default(),
        review_fixer: models_by_agent.remove("review-fixer").unwrap_or_default(),
        session: models_by_agent.remove("session").unwrap_or_default(),
        qa: models_by_agent.remove("qa").unwrap_or_default(),
        retro: models_by_agent.remove("retro").unwrap_or_default(),
    })
}

pub async fn set_model_setting(
    pool: &SqlitePool,
    agent_type: &str,
    model_id: &str,
) -> Result<(), AppError> {
    if !validate_agent_type(agent_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid model type: {}",
            agent_type
        )));
    }
    let db_key = format!("model_{}", agent_type);
    set_setting(pool, &db_key, model_id).await
}

pub async fn get_provider_settings(pool: &SqlitePool) -> Result<AgentProviderSettings, AppError> {
    let mut settings = default_provider_settings();

    for (agent_type, db_key) in provider_keys() {
        let provider = get_setting(pool, &db_key)
            .await?
            .unwrap_or_else(|| crate::domain::agents::runtime::DEFAULT_PROVIDER.to_string());
        match agent_type {
            "plan" => settings.plan = provider,
            "prd" => settings.prd = provider,
            "execute" => settings.execute = provider,
            "risk" => settings.risk = provider,
            "review" => settings.review = provider,
            "review-fixer" => settings.review_fixer = provider,
            "session" => settings.session = provider,
            "qa" => settings.qa = provider,
            "retro" => settings.retro = provider,
            _ => {}
        }
    }

    Ok(settings)
}

pub async fn set_provider_setting(
    pool: &SqlitePool,
    agent_type: &str,
    provider_id: &str,
) -> Result<(), AppError> {
    if !validate_agent_type(agent_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid provider type: {}",
            agent_type
        )));
    }

    let db_key = runtime_setting_key(agent_type);
    set_setting(pool, &db_key, provider_id).await
}

pub async fn get_prompt_history(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

pub async fn add_prompt_entry(
    pool: &SqlitePool,
    project_id: i64,
    content: &str,
) -> Result<bool, AppError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE prompt_history (\
                id INTEGER PRIMARY KEY AUTOINCREMENT, \
                project_id INTEGER NOT NULL, \
                content TEXT NOT NULL, \
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP\
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn test_get_setting_found() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO settings (key, value) VALUES ('theme', 'dark')")
            .execute(&pool)
            .await
            .unwrap();

        let result = get_setting(&pool, "theme").await.unwrap();
        assert_eq!(result, Some("dark".to_string()));
    }

    #[tokio::test]
    async fn test_get_setting_not_found() {
        let pool = setup_test_db().await;
        let result = get_setting(&pool, "nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_set_setting_insert_and_update() {
        let pool = setup_test_db().await;

        set_setting(&pool, "theme", "light").await.unwrap();
        let result = get_setting(&pool, "theme").await.unwrap();
        assert_eq!(result, Some("light".to_string()));

        set_setting(&pool, "theme", "dark").await.unwrap();
        let result = get_setting(&pool, "theme").await.unwrap();
        assert_eq!(result, Some("dark".to_string()));
    }

    #[tokio::test]
    async fn test_list_settings() {
        let pool = setup_test_db().await;
        sqlx::query("INSERT INTO settings (key, value) VALUES ('a', '1'), ('b', '2'), ('c', '3')")
            .execute(&pool)
            .await
            .unwrap();

        let settings = list_settings(&pool).await.unwrap();
        assert_eq!(settings.len(), 3);
        let keys: Vec<&str> = settings.iter().map(|s| s.key.as_str()).collect();
        assert!(keys.contains(&"a"));
        assert!(keys.contains(&"b"));
        assert!(keys.contains(&"c"));
    }

    #[tokio::test]
    async fn test_get_model_settings_defaults() {
        let pool = setup_test_db().await;
        let settings = get_model_settings(&pool).await.unwrap();
        // All nine agent types share whatever the adapter reports as its
        // default (live CLI value if warmed, else `FALLBACK_MODEL`).
        let expected = &settings.plan;
        assert!(!expected.is_empty());
        assert_eq!(&settings.prd, expected);
        assert_eq!(&settings.execute, expected);
        assert_eq!(&settings.risk, expected);
        assert_eq!(&settings.review, expected);
        assert_eq!(&settings.review_fixer, expected);
        assert_eq!(&settings.session, expected);
        assert_eq!(&settings.qa, expected);
        assert_eq!(&settings.retro, expected);
    }

    #[tokio::test]
    async fn test_get_model_settings_follow_workspace_provider_defaults() {
        let pool = setup_test_db().await;
        set_setting(&pool, "agent_runtime_plan", "opencode")
            .await
            .unwrap();

        let settings = get_model_settings(&pool).await.unwrap();
        assert_eq!(settings.plan, "default/default");
        assert!(!settings.prd.is_empty());
    }

    #[tokio::test]
    async fn test_set_and_get_model_setting() {
        let pool = setup_test_db().await;

        set_model_setting(&pool, "plan", "claude-sonnet-3-5")
            .await
            .unwrap();
        let settings = get_model_settings(&pool).await.unwrap();

        assert_eq!(settings.plan, "claude-sonnet-3-5");
        // The other eight keep the adapter default.
        assert_ne!(settings.prd, "claude-sonnet-3-5");
        assert_eq!(&settings.prd, &settings.execute);
    }

    #[tokio::test]
    async fn test_add_prompt_entry_basic() {
        let pool = setup_test_db().await;

        let inserted = add_prompt_entry(&pool, 1, "hello world").await.unwrap();
        assert!(inserted);

        let history = get_prompt_history(&pool, 1).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0], "hello world");
    }

    #[tokio::test]
    async fn test_add_prompt_entry_deduplication() {
        let pool = setup_test_db().await;

        let first = add_prompt_entry(&pool, 1, "duplicate prompt")
            .await
            .unwrap();
        assert!(first);

        let second = add_prompt_entry(&pool, 1, "duplicate prompt")
            .await
            .unwrap();
        assert!(!second); // skipped

        let history = get_prompt_history(&pool, 1).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0], "duplicate prompt");
    }

    #[tokio::test]
    async fn test_add_prompt_entry_trim_to_100() {
        let pool = setup_test_db().await;

        for i in 0..101 {
            let content = format!("prompt {}", i);
            add_prompt_entry(&pool, 1, &content).await.unwrap();
        }

        let history = get_prompt_history(&pool, 1).await.unwrap();
        assert_eq!(history.len(), 100);
    }
}
