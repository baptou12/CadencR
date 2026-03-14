use sqlx::SqlitePool;
use crate::error::AppError;
use super::models::{Project, ProjectSetting, ProjectModelSettings};
use super::repository;

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, AppError> {
    repository::list_projects(pool).await
}

pub async fn create_project(pool: &SqlitePool, name: &str, path: &str) -> Result<Project, AppError> {
    repository::create_project(pool, name, path).await
}

pub async fn delete_project(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    repository::delete_project(pool, id).await
}

pub async fn get_project_settings(pool: &SqlitePool, project_id: i64) -> Result<Vec<ProjectSetting>, AppError> {
    repository::get_project_settings(pool, project_id).await
}

pub async fn set_project_setting(pool: &SqlitePool, project_id: i64, key: &str, value: &str) -> Result<(), AppError> {
    repository::set_project_setting(pool, project_id, key, value).await
}

pub async fn get_project_model_settings(pool: &SqlitePool, project_id: i64) -> Result<ProjectModelSettings, AppError> {
    repository::get_project_model_settings(pool, project_id).await
}

pub async fn set_project_model_setting(pool: &SqlitePool, project_id: i64, model_type: &str, model: &str) -> Result<(), AppError> {
    repository::set_project_model_setting(pool, project_id, model_type, model).await
}
