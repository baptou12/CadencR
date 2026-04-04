use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{
    CreateWorkflowDefinition, CreateWorkflowPhase, WorkflowArtifact,
    WorkflowDefinition, WorkflowPhase,
};
use super::{artifact_repository, repository};

pub async fn list_definitions(pool: &SqlitePool) -> Result<Vec<WorkflowDefinition>, AppError> {
    repository::list_workflow_definitions(pool).await
}

pub async fn get_definition(pool: &SqlitePool, id: i64) -> Result<WorkflowDefinition, AppError> {
    repository::get_workflow_definition(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Workflow definition not found".into()))
}

pub async fn create_definition(
    pool: &SqlitePool,
    input: CreateWorkflowDefinition,
) -> Result<WorkflowDefinition, AppError> {
    if input.phases.is_empty() {
        return Err(AppError::BadRequest("A workflow must have at least 1 phase".into()));
    }
    repository::create_workflow_definition(pool, input).await
}

pub async fn update_definition(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    id: i64,
    name: &str,
    description: Option<&str>,
) -> Result<WorkflowDefinition, AppError> {
    let def = get_definition(read_pool, id).await?;
    if def.is_preset {
        return Err(AppError::Conflict("Cannot modify a preset workflow definition".into()));
    }
    repository::update_workflow_definition(write_pool, id, name, description).await
}

pub async fn delete_definition(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    id: i64,
) -> Result<(), AppError> {
    let def = get_definition(read_pool, id).await?;
    if def.is_preset {
        return Err(AppError::Conflict("Cannot delete a preset workflow definition".into()));
    }
    repository::delete_workflow_definition(write_pool, id).await
}

pub async fn fork_definition(
    pool: &SqlitePool,
    source_id: i64,
    new_name: &str,
    new_slug: &str,
) -> Result<WorkflowDefinition, AppError> {
    repository::fork_workflow_definition(pool, source_id, new_name, new_slug).await
}

pub async fn add_phase(
    pool: &SqlitePool,
    definition_id: i64,
    phase: &CreateWorkflowPhase,
) -> Result<WorkflowPhase, AppError> {
    let def = get_definition(pool, definition_id).await?;
    if def.is_preset {
        return Err(AppError::Conflict("Cannot modify phases of a preset workflow definition".into()));
    }
    repository::create_workflow_phase(pool, definition_id, phase).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_phase(
    pool: &SqlitePool,
    phase_id: i64,
    name: Option<&str>,
    gate_type: Option<&str>,
    system_prompt_template: Option<&str>,
    command_prompt_template: Option<&str>,
    artifact_template: Option<&str>,
    input_phase_slugs: Option<&Vec<String>>,
    model_override: Option<&str>,
) -> Result<WorkflowPhase, AppError> {
    let definition_id = repository::get_phase_definition_id(pool, phase_id).await?;
    let def = get_definition(pool, definition_id).await?;
    if def.is_preset {
        return Err(AppError::Conflict("Cannot modify phases of a preset workflow definition".into()));
    }
    repository::update_workflow_phase(
        pool, phase_id, name, gate_type, system_prompt_template,
        command_prompt_template, artifact_template, input_phase_slugs, model_override,
    ).await
}

pub async fn delete_phase(pool: &SqlitePool, phase_id: i64) -> Result<(), AppError> {
    let definition_id = repository::get_phase_definition_id(pool, phase_id).await?;
    let def = get_definition(pool, definition_id).await?;
    if def.is_preset {
        return Err(AppError::Conflict("Cannot modify phases of a preset workflow definition".into()));
    }
    repository::delete_workflow_phase(pool, phase_id).await
}

pub async fn reorder_phases(
    pool: &SqlitePool,
    definition_id: i64,
    phase_ids: &[i64],
) -> Result<(), AppError> {
    let def = get_definition(pool, definition_id).await?;
    if def.is_preset {
        return Err(AppError::Conflict("Cannot modify phases of a preset workflow definition".into()));
    }
    repository::reorder_phases(pool, definition_id, phase_ids).await
}

pub async fn list_artifacts(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<WorkflowArtifact>, AppError> {
    artifact_repository::get_artifacts_for_feature(pool, feature_id).await
}

pub async fn get_artifact(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
) -> Result<WorkflowArtifact, AppError> {
    artifact_repository::get_artifact(pool, feature_id, phase_slug)
        .await?
        .ok_or_else(|| AppError::NotFound("Artifact not found".into()))
}

pub async fn update_artifact(
    pool: &SqlitePool,
    feature_id: i64,
    phase_slug: &str,
    content: &str,
) -> Result<WorkflowArtifact, AppError> {
    artifact_repository::upsert_artifact(pool, feature_id, phase_slug, content, None).await
}
