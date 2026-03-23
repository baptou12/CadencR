use sqlx::SqlitePool;

use crate::error::AppError;

/// Resolve the working directory for a terminal given feature_id and project_id.
/// Prefers the feature's worktree path if set, otherwise falls back to the project path.
pub async fn resolve_cwd(
    pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
) -> Result<String, AppError> {
    // Check for worktree path first
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

    // Fall back to project path
    let row: Option<(String,)> = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

    row.map(|(path,)| path)
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id} not found")))
}
