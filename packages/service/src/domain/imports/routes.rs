use axum::extract::{Json, Path, State};
use axum::routing::{get, post};
use axum::Router;
use uuid::Uuid;

use crate::app_state::AppState;
use crate::error::AppError;

use super::models::{
    ImportJobState, ImportJobStatus, ImportProvider, ListImportConversationsResponse, SkipReason,
    SkippedRecord, StartImportRequest, StartImportResponse,
};
use super::service::{self, ImportOutcome};

#[utoipa::path(
    get,
    path = "/api/projects/{id}/imports/claude-code/conversations",
    params(("id" = i64, Path,)),
    responses((status = 200, body = ListImportConversationsResponse))
)]
pub async fn list_claude_code_conversations_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<ListImportConversationsResponse>, AppError> {
    let conversations =
        service::list_provider_conversations(&state.read_pool, id, ImportProvider::ClaudeCode)
            .await?;
    Ok(Json(ListImportConversationsResponse { conversations }))
}

#[utoipa::path(
    get,
    path = "/api/projects/{id}/imports/{provider}/conversations",
    params(("id" = i64, Path,), ("provider" = String, Path,)),
    responses((status = 200, body = ListImportConversationsResponse))
)]
pub async fn list_provider_conversations_handler(
    State(state): State<AppState>,
    Path((id, provider)): Path<(i64, String)>,
) -> Result<Json<ListImportConversationsResponse>, AppError> {
    let provider = service::parse_import_provider(&provider)?;
    let conversations =
        service::list_provider_conversations(&state.read_pool, id, provider).await?;
    Ok(Json(ListImportConversationsResponse { conversations }))
}

#[utoipa::path(
    post,
    path = "/api/projects/{id}/imports/claude-code",
    params(("id" = i64, Path,)),
    request_body = StartImportRequest,
    responses((status = 200, body = StartImportResponse))
)]
pub async fn start_claude_code_import_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<StartImportRequest>,
) -> Result<Json<StartImportResponse>, AppError> {
    start_import_job(state, id, ImportProvider::ClaudeCode, body).await
}

#[utoipa::path(
    post,
    path = "/api/projects/{id}/imports/{provider}",
    params(("id" = i64, Path,), ("provider" = String, Path,)),
    request_body = StartImportRequest,
    responses((status = 200, body = StartImportResponse))
)]
pub async fn start_provider_import_handler(
    State(state): State<AppState>,
    Path((id, provider)): Path<(i64, String)>,
    Json(body): Json<StartImportRequest>,
) -> Result<Json<StartImportResponse>, AppError> {
    let provider = service::parse_import_provider(&provider)?;
    start_import_job(state, id, provider, body).await
}

async fn start_import_job(
    state: AppState,
    id: i64,
    provider: ImportProvider,
    body: StartImportRequest,
) -> Result<Json<StartImportResponse>, AppError> {
    if body.session_ids.is_empty() {
        return Err(AppError::BadRequest("session_ids must be non-empty".into()));
    }
    let job_id = Uuid::new_v4().to_string();
    let total = body.session_ids.len() as u32;
    state.import_jobs.insert_running(job_id.clone(), total);

    let project_path = service::project_path(&state.read_pool, id).await?;
    let write_pool = state.write_pool.clone();
    let jobs = state.import_jobs.clone();
    let session_ids = body.session_ids;
    let worker_job_id = job_id.clone();
    let worker_provider = provider;

    tokio::spawn(async move {
        for session_id in session_ids {
            let outcome = service::import_provider_session_by_id(
                &write_pool,
                id,
                worker_provider,
                &project_path,
                &session_id,
            )
            .await;
            jobs.update(&worker_job_id, |state| {
                state.completed += 1;
                match outcome {
                    Ok(ImportOutcome::Imported(rec)) => state.imported.push(rec),
                    Ok(ImportOutcome::Skipped(rec)) => state.skipped.push(rec),
                    Err(err) => {
                        tracing::error!(
                            source_session_id = %session_id,
                            error = %err,
                            "import session failed"
                        );
                        state.skipped.push(SkippedRecord {
                            source_session_id: session_id.clone(),
                            reason: SkipReason::DbError,
                        });
                    }
                }
            });
        }
        jobs.update(&worker_job_id, |state| {
            state.status = ImportJobStatus::Done;
        });
        tracing::info!(job_id = %worker_job_id, provider = %worker_provider.as_str(), "import job complete");
    });

    Ok(Json(StartImportResponse { job_id }))
}

#[utoipa::path(
    get,
    path = "/api/imports/jobs/{job_id}",
    params(("job_id" = String, Path,)),
    responses(
        (status = 200, body = ImportJobState),
        (status = 404, description = "Job not found")
    )
)]
pub async fn get_import_job_handler(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<ImportJobState>, AppError> {
    state
        .import_jobs
        .get(&job_id)
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("import job {job_id} not found")))
}

pub fn imports_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/projects/{id}/imports/claude-code/conversations",
            get(list_claude_code_conversations_handler),
        )
        .route(
            "/api/projects/{id}/imports/{provider}/conversations",
            get(list_provider_conversations_handler),
        )
        .route(
            "/api/projects/{id}/imports/claude-code",
            post(start_claude_code_import_handler),
        )
        .route(
            "/api/projects/{id}/imports/{provider}",
            post(start_provider_import_handler),
        )
        .route("/api/imports/jobs/{job_id}", get(get_import_job_handler))
}
