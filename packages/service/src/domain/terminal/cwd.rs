use sqlx::SqlitePool;

use crate::error::AppError;

/// Resolve the working directory for a terminal given feature_id and project_id.
/// Prefers the feature's worktree path if set, otherwise falls back to the project path.
/// Session features (type = 'ws-session') skip the worktree lookup and use the project path directly.
pub async fn resolve_cwd(
    pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
) -> Result<String, AppError> {
    // Check feature type — sessions use project path directly
    let feature_type: Option<(String,)> = sqlx::query_as("SELECT type FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(pool)
        .await?;

    let is_session = feature_type.as_ref().map_or(false, |(t,)| t == "ws-session");

    if !is_session {
        // Check for worktree path
        let worktree: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .bind(feature_id)
        .fetch_optional(pool)
        .await?;

        if let Some((path,)) = worktree {
            if std::path::Path::new(&path).exists() {
                return Ok(path);
            }
        }
    }

    // Fall back to project path
    let row: Option<(String,)> = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

    row.map(|(path,)| path)
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id} not found")))
}
