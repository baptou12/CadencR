use super::models::{AgentProviderSettings, ModelSettings, Setting};
use super::repository;
use crate::error::AppError;
use sqlx::SqlitePool;

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    repository::get_setting(pool, key).await
}

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), AppError> {
    repository::set_setting(pool, key, value).await
}

pub async fn list_settings(pool: &SqlitePool) -> Result<Vec<Setting>, AppError> {
    repository::list_settings(pool).await
}

pub async fn get_model_settings(pool: &SqlitePool) -> Result<ModelSettings, AppError> {
    repository::get_model_settings(pool).await
}

pub async fn set_model_setting(
    pool: &SqlitePool,
    agent_type: &str,
    model_id: &str,
) -> Result<(), AppError> {
    repository::set_model_setting(pool, agent_type, model_id).await
}

pub async fn get_provider_settings(pool: &SqlitePool) -> Result<AgentProviderSettings, AppError> {
    repository::get_provider_settings(pool).await
}

pub async fn set_provider_setting(
    pool: &SqlitePool,
    agent_type: &str,
    provider_id: &str,
) -> Result<(), AppError> {
    repository::set_provider_setting(pool, agent_type, provider_id).await
}
