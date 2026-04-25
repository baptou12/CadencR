use axum::extract::{Json, Path, Query, State};
use axum::routing::{get, post, put};
use axum::Router;
use serde::Deserialize;

use super::models::{
    CreateCustomActionRequest, CustomAction, CustomActionRun, CustomActionSchedule,
    CustomActionVariable, RunResponse, Scope, SetCustomActionScheduleRequest,
    SetCustomActionVariableRequest, SuccessResponse, TriggeredBy, UpdateCustomActionRequest,
};
use super::repository;
use super::runner;
use super::service;
use crate::app_state::AppState;
use crate::error::AppError;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ListActionsQuery {
    pub project_id: i64,
    /// Optional feature id to embed `last_run` summaries on each action.
    pub feature_id: Option<i64>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct FeatureIdQuery {
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct FeatureIdAndLimitQuery {
    pub feature_id: i64,
    pub limit: Option<i64>,
}

// ---------------------------------------------------------------------------
// Action CRUD
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/api/custom-actions", params(ListActionsQuery), responses((status = 200, body = Vec<CustomAction>)))]
pub async fn list_actions_handler(
    State(state): State<AppState>,
    Query(q): Query<ListActionsQuery>,
) -> Result<Json<Vec<CustomAction>>, AppError> {
    Ok(Json(
        repository::list_for_project(&state.read_pool, q.project_id, q.feature_id).await?,
    ))
}

#[utoipa::path(post, path = "/api/custom-actions", request_body = CreateCustomActionRequest, responses((status = 200, body = CustomAction)))]
pub async fn create_action_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateCustomActionRequest>,
) -> Result<Json<CustomAction>, AppError> {
    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if body.command.trim().is_empty() {
        return Err(AppError::BadRequest("command is required".into()));
    }
    service::validate_scope(body.scope, body.project_id)?;
    service::validate_icon(body.icon_data.as_deref())?;
    let id = repository::insert(
        &state.write_pool,
        &body.name,
        &body.command,
        body.icon_data.as_deref(),
        body.scope,
        body.project_id,
    )
    .await?;
    let row = repository::get(&state.read_pool, id)
        .await?
        .ok_or_else(|| AppError::Internal("inserted action vanished".into()))?;
    Ok(Json(row))
}

#[utoipa::path(put, path = "/api/custom-actions/{id}", params(("id" = i64, Path,)), request_body = UpdateCustomActionRequest, responses((status = 200, body = CustomAction)))]
pub async fn update_action_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateCustomActionRequest>,
) -> Result<Json<CustomAction>, AppError> {
    let existing = repository::get(&state.read_pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Custom action {id} not found")))?;
    let next_scope = body.scope.unwrap_or(existing.scope);
    // When scope flips to global, force-clear project_id; otherwise honour the
    // explicit project_id if the caller sent one, else leave it alone.
    let next_project_id = match next_scope {
        Scope::Global => None,
        Scope::Project => body.project_id.or(existing.project_id),
    };
    service::validate_scope(next_scope, next_project_id)?;
    service::validate_icon(body.icon_data.as_deref())?;

    repository::update(
        &state.write_pool,
        id,
        body.name.as_deref(),
        body.command.as_deref(),
        body.icon_data
            .as_ref()
            .map(|s| if s.is_empty() { None } else { Some(s.as_str()) }),
        body.scope,
        match (body.scope, body.project_id) {
            (Some(Scope::Global), _) => Some(None),
            (_, Some(pid)) => Some(Some(pid)),
            _ => None,
        },
        body.position,
    )
    .await?;

    let row = repository::get(&state.read_pool, id)
        .await?
        .ok_or_else(|| AppError::Internal("updated action vanished".into()))?;
    Ok(Json(row))
}

#[utoipa::path(delete, path = "/api/custom-actions/{id}", params(("id" = i64, Path,)), responses((status = 200, body = SuccessResponse)))]
pub async fn delete_action_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<SuccessResponse>, AppError> {
    repository::delete(&state.write_pool, id).await?;
    state.custom_action_scheduler.stop_for_action(id).await;
    Ok(Json(SuccessResponse { success: true }))
}

#[utoipa::path(get, path = "/api/custom-actions/{id}/variables", params(("id" = i64, Path,), FeatureIdQuery), responses((status = 200, body = Vec<CustomActionVariable>)))]
pub async fn list_variables_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<FeatureIdQuery>,
) -> Result<Json<Vec<CustomActionVariable>>, AppError> {
    Ok(Json(
        repository::list_variables(&state.read_pool, id, q.feature_id).await?,
    ))
}

#[utoipa::path(put, path = "/api/custom-actions/{id}/variables", params(("id" = i64, Path,), FeatureIdQuery), request_body = SetCustomActionVariableRequest, responses((status = 200, body = SuccessResponse)))]
pub async fn set_variable_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<FeatureIdQuery>,
    Json(body): Json<SetCustomActionVariableRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    if body.var_name.trim().is_empty() {
        return Err(AppError::BadRequest("var_name is required".into()));
    }
    repository::upsert_variable(
        &state.write_pool,
        id,
        q.feature_id,
        &body.var_name,
        &body.value,
    )
    .await?;
    Ok(Json(SuccessResponse { success: true }))
}

// ---------------------------------------------------------------------------
// Run + history
// ---------------------------------------------------------------------------

#[utoipa::path(post, path = "/api/custom-actions/{id}/run", params(("id" = i64, Path,), FeatureIdQuery), responses((status = 200, body = RunResponse)))]
pub async fn run_action_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<FeatureIdQuery>,
) -> Result<Json<RunResponse>, AppError> {
    let outcome = runner::execute(&state, id, q.feature_id, TriggeredBy::Manual).await?;
    Ok(Json(RunResponse {
        run_id: outcome.run_id,
        exit_code: outcome.exit_code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        ended_at: Some(outcome.ended_at),
    }))
}

#[utoipa::path(get, path = "/api/custom-actions/{id}/runs", params(("id" = i64, Path,), FeatureIdAndLimitQuery), responses((status = 200, body = Vec<CustomActionRun>)))]
pub async fn list_runs_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<FeatureIdAndLimitQuery>,
) -> Result<Json<Vec<CustomActionRun>>, AppError> {
    let limit = q.limit.unwrap_or(20).clamp(1, 200);
    Ok(Json(
        repository::list_runs(&state.read_pool, id, q.feature_id, limit).await?,
    ))
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/api/custom-actions/{id}/schedule", params(("id" = i64, Path,), FeatureIdQuery), responses((status = 200, body = Option<CustomActionSchedule>)))]
pub async fn get_schedule_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<FeatureIdQuery>,
) -> Result<Json<Option<CustomActionSchedule>>, AppError> {
    Ok(Json(
        repository::get_schedule(&state.read_pool, id, q.feature_id).await?,
    ))
}

#[utoipa::path(put, path = "/api/custom-actions/{id}/schedule", params(("id" = i64, Path,), FeatureIdQuery), request_body = SetCustomActionScheduleRequest, responses((status = 200, body = SuccessResponse)))]
pub async fn set_schedule_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<FeatureIdQuery>,
    Json(body): Json<SetCustomActionScheduleRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    match (body.interval_seconds, body.enabled.unwrap_or(true)) {
        (None, _) | (_, false) => {
            repository::delete_schedule(&state.write_pool, id, q.feature_id).await?;
        }
        (Some(secs), true) => {
            if secs < 5 {
                return Err(AppError::BadRequest("interval_seconds must be >= 5".into()));
            }
            repository::upsert_schedule(&state.write_pool, id, q.feature_id, secs, true).await?;
        }
    }
    state
        .custom_action_scheduler
        .apply_change(&state, id, q.feature_id)
        .await?;
    Ok(Json(SuccessResponse { success: true }))
}

pub fn custom_actions_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/custom-actions",
            get(list_actions_handler).post(create_action_handler),
        )
        .route(
            "/api/custom-actions/{id}",
            put(update_action_handler).delete(delete_action_handler),
        )
        .route(
            "/api/custom-actions/{id}/variables",
            get(list_variables_handler).put(set_variable_handler),
        )
        .route("/api/custom-actions/{id}/run", post(run_action_handler))
        .route("/api/custom-actions/{id}/runs", get(list_runs_handler))
        .route(
            "/api/custom-actions/{id}/schedule",
            get(get_schedule_handler).put(set_schedule_handler),
        )
}
