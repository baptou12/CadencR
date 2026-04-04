use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::WorkflowArtifact;

pub async fn get_artifact(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
) -> Result<Option<WorkflowArtifact>, AppError> {
    sqlx::query_as::<_, WorkflowArtifact>(
        "SELECT id, feature_id, phase_slug, content, agent_session_id, created_at, updated_at \
         FROM workflow_artifacts WHERE feature_id = ? AND phase_slug = ?"
    )
    .bind(feature_id)
    .bind(phase_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))
}

pub async fn get_artifacts_for_feature(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<WorkflowArtifact>, AppError> {
    sqlx::query_as::<_, WorkflowArtifact>(
        "SELECT id, feature_id, phase_slug, content, agent_session_id, created_at, updated_at \
         FROM workflow_artifacts WHERE feature_id = ? ORDER BY created_at"
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))
}

pub async fn upsert_artifact(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
    content: &str,
    agent_session_id: Option<i64>,
) -> Result<WorkflowArtifact, AppError> {
    sqlx::query(
        "INSERT INTO workflow_artifacts (feature_id, phase_slug, content, agent_session_id) \
         VALUES (?, ?, ?, ?) \
         ON CONFLICT(feature_id, phase_slug) DO UPDATE SET \
         content = excluded.content, agent_session_id = excluded.agent_session_id, \
         updated_at = datetime('now')"
    )
    .bind(feature_id)
    .bind(phase_slug)
    .bind(content)
    .bind(agent_session_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    get_artifact(pool, feature_id, phase_slug)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to read back upserted artifact".into()))
}

pub async fn get_feature_workflow_definition_id(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Option<i64>, AppError> {
    let row = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT workflow_definition_id FROM features WHERE id = ?"
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(row.and_then(|r| r.0))
}
