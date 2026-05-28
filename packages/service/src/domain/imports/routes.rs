use axum::extract::{Json, Path, State};
use axum::routing::{get, post};
use axum::Router;
use uuid::Uuid;

use crate::app_state::AppState;
use crate::error::AppError;

use super::models::{
    ImportJobState, ImportJobStatus, ListImportConversationsResponse, SkipReason, SkippedRecord,
    StartImportRequest, StartImportResponse, PROVIDER_CLAUDE_CODE,
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
    let conversations = service::list_claude_code_conversations(&state.read_pool, id).await?;
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

    tokio::spawn(async move {
        for session_id in session_ids {
            let outcome =
                service::import_session_by_id(&write_pool, id, &project_path, &session_id).await;
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
        tracing::info!(job_id = %worker_job_id, provider = PROVIDER_CLAUDE_CODE, "import job complete");
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
            "/api/projects/{id}/imports/claude-code",
            post(start_claude_code_import_handler),
        )
        .route("/api/imports/jobs/{job_id}", get(get_import_job_handler))
}
