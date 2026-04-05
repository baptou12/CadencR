use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{WorkflowArtifact, DEFAULT_ARTIFACT_TYPE};

/// Format a list of phase artifacts into a single string.
/// Without `slug_prefix`: single default → just content; multiple → type headers.
/// With `slug_prefix`: single default → `## {prefix}\n\n{content}`; multiple → `## {prefix} / {type}` headers.
pub fn format_artifacts(artifacts: &[WorkflowArtifact], slug_prefix: Option<&str>) -> Option<String> {
    if artifacts.is_empty() {
        return None;
    }
    if artifacts.len() == 1 && artifacts[0].artifact_type == DEFAULT_ARTIFACT_TYPE {
        return Some(match slug_prefix {
            Some(prefix) => format!("## {prefix}\n\n{}", artifacts[0].content),
            None => artifacts[0].content.clone(),
        });
    }
    let parts: Vec<String> = artifacts.iter().map(|a| {
        let header = match slug_prefix {
            Some(prefix) => format!("{prefix} / {}", a.artifact_type),
            None => a.artifact_type.clone(),
        };
        format!("## {header}\n\n{}", a.content)
    }).collect();
    Some(parts.join("\n\n---\n\n"))
}

pub async fn get_artifact(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
) -> Result<Option<WorkflowArtifact>, AppError> {
    sqlx::query_as::<_, WorkflowArtifact>(
        "SELECT id, feature_id, phase_slug, artifact_type, content, agent_session_id, created_at, updated_at \
         FROM workflow_artifacts WHERE feature_id = ? AND phase_slug = ? AND artifact_type = 'default'"
    )
    .bind(feature_id)
    .bind(phase_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))
}

pub async fn get_typed_artifact(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
    artifact_type: &str,
) -> Result<Option<WorkflowArtifact>, AppError> {
    sqlx::query_as::<_, WorkflowArtifact>(
        "SELECT id, feature_id, phase_slug, artifact_type, content, agent_session_id, created_at, updated_at \
         FROM workflow_artifacts WHERE feature_id = ? AND phase_slug = ? AND artifact_type = ?"
    )
    .bind(feature_id)
    .bind(phase_slug)
    .bind(artifact_type)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))
}

pub async fn get_phase_artifacts(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
) -> Result<Vec<WorkflowArtifact>, AppError> {
    sqlx::query_as::<_, WorkflowArtifact>(
        "SELECT id, feature_id, phase_slug, artifact_type, content, agent_session_id, created_at, updated_at \
         FROM workflow_artifacts WHERE feature_id = ? AND phase_slug = ? ORDER BY artifact_type"
    )
    .bind(feature_id)
    .bind(phase_slug)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))
}

pub async fn get_artifacts_for_feature(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<WorkflowArtifact>, AppError> {
    sqlx::query_as::<_, WorkflowArtifact>(
        "SELECT id, feature_id, phase_slug, artifact_type, content, agent_session_id, created_at, updated_at \
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
    artifact_type: &str,
    content: &str,
    agent_session_id: Option<i64>,
) -> Result<WorkflowArtifact, AppError> {
    sqlx::query(
        "INSERT INTO workflow_artifacts (feature_id, phase_slug, artifact_type, content, agent_session_id) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(feature_id, phase_slug, artifact_type) DO UPDATE SET \
         content = excluded.content, agent_session_id = excluded.agent_session_id, \
         updated_at = datetime('now')"
    )
    .bind(feature_id)
    .bind(phase_slug)
    .bind(artifact_type)
    .bind(content)
    .bind(agent_session_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    get_typed_artifact(pool, feature_id, phase_slug, artifact_type)
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
