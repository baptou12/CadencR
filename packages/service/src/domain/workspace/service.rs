use sqlx::SqlitePool;
use crate::error::AppError;
use super::models::{Setting, ModelSettings};
use super::repository;

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

pub async fn set_model_setting(pool: &SqlitePool, agent_type: &str, model_id: &str) -> Result<(), AppError> {
    repository::set_model_setting(pool, agent_type, model_id).await
}

pub async fn get_prompt_history(pool: &SqlitePool, project_id: i64) -> Result<Vec<String>, AppError> {
    repository::get_prompt_history(pool, project_id).await
}

pub async fn add_prompt_entry(pool: &SqlitePool, project_id: i64, content: &str) -> Result<bool, AppError> {
    repository::add_prompt_entry(pool, project_id, content).await
}
