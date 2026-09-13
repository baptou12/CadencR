use std::path::Path;

use axum::http::StatusCode;
use sqlx::SqlitePool;

use crate::error::AppError;

const PROJECT_OWNERSHIP_CONFLICT: &str = "PROVIDER_PROJECT_OWNERSHIP_CONFLICT";

pub(super) async fn ensure_provider_identity_path(
    pool: &SqlitePool,
    provider_id: &str,
    expected_directory: Option<&Path>,
) -> Result<(), AppError> {
    let existing_path: Option<String> = sqlx::query_scalar(
        "SELECT path FROM projects \
         WHERE authoring_target = 'provider' AND plugin_id = ?",
    )
    .bind(provider_id)
    .fetch_optional(pool)
    .await?;
    let Some(existing_path) = existing_path else {
        return Ok(());
    };
    if expected_directory.is_some_and(|directory| directory == Path::new(&existing_path)) {
        return Ok(());
    }
    Err(AppError::coded(
        StatusCode::CONFLICT,
        PROJECT_OWNERSHIP_CONFLICT,
        format!(
            "provider identity {provider_id:?} already belongs to project path {existing_path:?}"
        ),
    ))
}

pub(super) async fn existing_owned_project_id(
    pool: &SqlitePool,
    cwd: &str,
    provider_id: &str,
) -> Result<Option<i64>, AppError> {
    let marker: Option<(i64, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, authoring_target, plugin_id FROM projects WHERE path = ? AND kind = 'user'",
    )
    .bind(cwd)
    .fetch_optional(pool)
    .await?;
    match marker {
        None => Ok(None),
        Some((id, None, None)) => Ok(Some(id)),
        Some((id, Some(target), Some(id_provider)))
            if target == "provider" && id_provider == provider_id =>
        {
            Ok(Some(id))
        }
        Some((_id, target, plugin_id)) => {
            Err(project_ownership_conflict(provider_id, target, plugin_id))
        }
    }
}

pub(super) fn project_ownership_conflict(
    provider_id: &str,
    target: Option<String>,
    plugin_id: Option<String>,
) -> AppError {
    AppError::coded(
        StatusCode::CONFLICT,
        PROJECT_OWNERSHIP_CONFLICT,
        format!(
            "provider workspace {provider_id:?} belongs to authoring target {target:?} with plugin id {plugin_id:?}"
        ),
    )
}
