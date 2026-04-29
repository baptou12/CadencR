use std::path::PathBuf;

use super::models::{Project, ProjectModelSettings, ProjectProviderSettings, ProjectSetting};
use super::repository;
use crate::error::AppError;
use crate::shared::slug::slugify;
use sqlx::SqlitePool;

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, AppError> {
    repository::list_projects(pool).await
}

/// Resolve a project id to its on-disk canonical root. Returns
/// `AppError::NotFound` if the id is unknown and `AppError::BadRequest` if the
/// stored path can no longer be canonicalized (project was moved or removed).
pub async fn resolve_project_root(pool: &SqlitePool, project_id: i64) -> Result<PathBuf, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    let (path,) =
        row.ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    std::fs::canonicalize(&path)
        .map_err(|e| AppError::BadRequest(format!("cannot resolve project {project_id} root: {e}")))
}

/// Resolve the on-disk root a feature's editor should operate against. If the
/// feature has a live worktree (its `worktree_path` setting points to an
/// existing directory) we return the canonical worktree path; otherwise we
/// fall back to the project's root. `project_id` must match the feature's
/// owning project — we don't cross-check here because both come from the
/// authenticated request.
pub async fn resolve_feature_editor_root(
    pool: &SqlitePool,
    project_id: i64,
    feature_id: Option<i64>,
) -> Result<PathBuf, AppError> {
    if let Some(fid) = feature_id {
        if let Some(path) =
            crate::domain::workflow::worktree::get_setting(pool, fid, "worktree_path").await
        {
            if std::path::Path::new(&path).is_dir() {
                return std::fs::canonicalize(&path).map_err(|e| {
                    AppError::BadRequest(format!("cannot resolve feature {fid} worktree root: {e}"))
                });
            }
        }
    }
    resolve_project_root(pool, project_id).await
}

pub async fn create_project(
    pool: &SqlitePool,
    name: &str,
    path: &str,
) -> Result<Project, AppError> {
    let (clean_name, canonical_path) = validate_new_project(name, path)?;
    repository::create_project(pool, &clean_name, &canonical_path).await
}

/// Reject names with path-y shapes (`..`, `/`, leading `.`) and canonicalize
/// the on-disk path, confirming it is an existing directory. Returns the
/// trimmed name + canonical path string to persist.
fn validate_new_project(name: &str, path: &str) -> Result<(String, String), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "project name must not be empty".into(),
        ));
    }
    if trimmed.starts_with('.') {
        return Err(AppError::BadRequest(
            "project name must not start with '.'".into(),
        ));
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains('\0')
    {
        return Err(AppError::BadRequest(
            "project name must not contain path separators or '..'".into(),
        ));
    }
    // Slug must round-trip: ensures the name is something the worktree layer
    // can safely place on disk without further escaping.
    if slugify(trimmed).is_empty() {
        return Err(AppError::BadRequest(
            "project name must contain alphanumeric characters".into(),
        ));
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|e| AppError::BadRequest(format!("invalid project path: {e}")))?;
    let meta = std::fs::metadata(&canonical)
        .map_err(|e| AppError::BadRequest(format!("cannot stat project path: {e}")))?;
    if !meta.is_dir() {
        return Err(AppError::BadRequest(
            "project path must be an existing directory".into(),
        ));
    }

    Ok((
        trimmed.to_string(),
        canonical.to_string_lossy().into_owned(),
    ))
}

pub async fn delete_project(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    repository::delete_project(pool, id).await
}

pub async fn get_project_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<Vec<ProjectSetting>, AppError> {
    repository::get_project_settings(pool, project_id).await
}

pub async fn set_project_setting(
    pool: &SqlitePool,
    project_id: i64,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    repository::set_project_setting(pool, project_id, key, value).await
}

pub async fn get_project_model_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<ProjectModelSettings, AppError> {
    repository::get_project_model_settings(pool, project_id).await
}

pub async fn set_project_model_setting(
    pool: &SqlitePool,
    project_id: i64,
    model_type: &str,
    model: &str,
) -> Result<(), AppError> {
    repository::set_project_model_setting(pool, project_id, model_type, model).await
}

pub async fn get_project_provider_settings(
    pool: &SqlitePool,
    project_id: i64,
) -> Result<ProjectProviderSettings, AppError> {
    repository::get_project_provider_settings(pool, project_id).await
}

pub async fn set_project_provider_setting(
    pool: &SqlitePool,
    project_id: i64,
    provider_type: &str,
    provider: &str,
) -> Result<(), AppError> {
    repository::set_project_provider_setting(pool, project_id, provider_type, provider).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_parent_dir_name() {
        let err = validate_new_project("../evil", "/").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn validate_rejects_slash_in_name() {
        let err = validate_new_project("a/b", "/").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn validate_rejects_leading_dot() {
        let err = validate_new_project(".hidden", "/").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn validate_rejects_empty_name() {
        let err = validate_new_project("   ", "/").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn validate_rejects_non_alphanumeric_name() {
        let err = validate_new_project("!!!", "/").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn validate_rejects_missing_path() {
        let err = validate_new_project("ok", "/nonexistent/xxx/yyy").unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn validate_rejects_file_path() {
        let dir = std::env::temp_dir();
        let file = dir.join("cadencr-project-validate-test-file");
        std::fs::write(&file, b"x").unwrap();
        let err = validate_new_project("ok", file.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn validate_canonicalizes_dir() {
        let dir = std::env::temp_dir();
        let (name, canonical) = validate_new_project("  okay  ", dir.to_str().unwrap()).unwrap();
        assert_eq!(name, "okay");
        assert!(!canonical.is_empty());
        let canonical_tmp = std::fs::canonicalize(&dir).unwrap();
        assert_eq!(canonical, canonical_tmp.to_string_lossy().into_owned());
    }
}
