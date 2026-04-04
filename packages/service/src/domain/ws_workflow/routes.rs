use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::app_state::AppState;
use crate::error::AppError;
use super::models::{CreateWorkflowPhase, GateType};
use super::service;

// --- Request DTOs ---

#[derive(Debug, Deserialize)]
pub struct CreateDefinitionRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub phases: Vec<CreatePhaseRequest>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDefinitionRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ForkDefinitionRequest {
    pub new_name: String,
    pub new_slug: String,
}

#[derive(Debug, Deserialize)]
pub struct CreatePhaseRequest {
    pub name: String,
    pub slug: String,
    pub order_index: i32,
    pub gate_type: GateType,
    #[serde(default)]
    pub system_prompt_template: String,
    #[serde(default)]
    pub command_prompt_template: String,
    #[serde(default)]
    pub artifact_template: String,
    #[serde(default)]
    pub input_phase_slugs: Vec<String>,
    #[serde(default)]
    pub model_override: String,
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
}

fn default_agent_type() -> String {
    "workflow".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdatePhaseRequest {
    pub name: Option<String>,
    #[allow(dead_code)]
    pub slug: Option<String>,
    pub gate_type: Option<String>,
    pub system_prompt_template: Option<String>,
    pub command_prompt_template: Option<String>,
    pub artifact_template: Option<String>,
    pub input_phase_slugs: Option<Vec<String>>,
    pub model_override: Option<String>,
    pub agent_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderPhasesRequest {
    pub phase_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateArtifactRequest {
    pub content: String,
}

impl From<CreatePhaseRequest> for CreateWorkflowPhase {
    fn from(r: CreatePhaseRequest) -> Self {
        CreateWorkflowPhase {
            name: r.name,
            slug: r.slug,
            order_index: r.order_index,
            gate_type: r.gate_type,
            system_prompt_template: r.system_prompt_template,
            command_prompt_template: r.command_prompt_template,
            artifact_template: r.artifact_template,
            input_phase_slugs: r.input_phase_slugs,
            model_override: r.model_override,
            agent_type: r.agent_type,
        }
    }
}

// --- Definition handlers ---

async fn list_definitions(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(service::list_definitions(&state.read_pool).await?))
}

async fn get_definition(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(service::get_definition(&state.read_pool, id).await?))
}

async fn create_definition(
    State(state): State<AppState>,
    Json(body): Json<CreateDefinitionRequest>,
) -> Result<impl IntoResponse, AppError> {
    let input = super::models::CreateWorkflowDefinition {
        name: body.name,
        slug: body.slug,
        description: body.description,
        is_preset: false,
        phases: body.phases.into_iter().map(Into::into).collect(),
    };
    let def = service::create_definition(&state.write_pool, input).await?;
    Ok((StatusCode::CREATED, Json(def)))
}

async fn update_definition(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateDefinitionRequest>,
) -> Result<impl IntoResponse, AppError> {
    let def = service::update_definition(
        &state.read_pool, &state.write_pool, id,
        &body.name, body.description.as_deref(),
    ).await?;
    Ok(Json(def))
}

async fn delete_definition(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    service::delete_definition(&state.read_pool, &state.write_pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn fork_definition(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<ForkDefinitionRequest>,
) -> Result<impl IntoResponse, AppError> {
    let def = service::fork_definition(
        &state.write_pool, id, &body.new_name, &body.new_slug,
    ).await?;
    Ok((StatusCode::CREATED, Json(def)))
}

// --- Phase handlers ---

async fn add_phase(
    State(state): State<AppState>,
    Path(definition_id): Path<i64>,
    Json(body): Json<CreatePhaseRequest>,
) -> Result<impl IntoResponse, AppError> {
    let phase: CreateWorkflowPhase = body.into();
    let result = service::add_phase(&state.write_pool, definition_id, &phase).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

async fn update_phase(
    State(state): State<AppState>,
    Path((_definition_id, phase_id)): Path<(i64, i64)>,
    Json(body): Json<UpdatePhaseRequest>,
) -> Result<impl IntoResponse, AppError> {
    let result = service::update_phase(
        &state.write_pool, phase_id,
        body.name.as_deref(),
        body.gate_type.as_deref(),
        body.system_prompt_template.as_deref(),
        body.command_prompt_template.as_deref(),
        body.artifact_template.as_deref(),
        body.input_phase_slugs.as_ref(),
        body.model_override.as_deref(),
        body.agent_type.as_deref(),
    ).await?;
    Ok(Json(result))
}

async fn delete_phase(
    State(state): State<AppState>,
    Path((_definition_id, phase_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, AppError> {
    service::delete_phase(&state.write_pool, phase_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn reorder_phases(
    State(state): State<AppState>,
    Path(definition_id): Path<i64>,
    Json(body): Json<ReorderPhasesRequest>,
) -> Result<impl IntoResponse, AppError> {
    service::reorder_phases(&state.write_pool, definition_id, &body.phase_ids).await?;
    Ok(StatusCode::NO_CONTENT)
}

// --- Artifact handlers ---

async fn list_artifacts(
    State(state): State<AppState>,
    Path(feature_id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(service::list_artifacts(&state.read_pool, feature_id).await?))
}

async fn get_artifact(
    State(state): State<AppState>,
    Path((feature_id, phase_slug)): Path<(i64, String)>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(service::get_artifact(&state.read_pool, feature_id, &phase_slug).await?))
}

async fn update_artifact(
    State(state): State<AppState>,
    Path((feature_id, phase_slug)): Path<(i64, String)>,
    Json(body): Json<UpdateArtifactRequest>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(service::update_artifact(&state.write_pool, feature_id, &phase_slug, &body.content).await?))
}

// --- Router ---

pub fn ws_workflow_router() -> Router<AppState> {
    Router::new()
        // Workflow definitions
        .route("/api/workflow-definitions", get(list_definitions).post(create_definition))
        .route("/api/workflow-definitions/{id}", get(get_definition).put(update_definition).delete(delete_definition))
        .route("/api/workflow-definitions/{id}/fork", post(fork_definition))
        // Phases
        .route("/api/workflow-definitions/{id}/phases", post(add_phase))
        .route("/api/workflow-definitions/{id}/phases/reorder", put(reorder_phases))
        .route("/api/workflow-definitions/{id}/phases/{phase_id}", put(update_phase).delete(delete_phase))
        // Artifacts
        .route("/api/features/{feature_id}/artifacts", get(list_artifacts))
        .route("/api/features/{feature_id}/artifacts/{phase_slug}", get(get_artifact).put(update_artifact))
}
