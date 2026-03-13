use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use utoipa::OpenApi;

use crate::app_state::AppState;
use crate::domain::git::models;
use crate::domain::git::routes;

#[derive(OpenApi)]
#[openapi(
    info(title = "Cadence Service API", version = "0.1.0"),
    paths(
        health,
        openapi_spec,
        routes::get_branch_handler,
        routes::get_stats_handler,
        routes::get_diff_handler,
        routes::get_changed_files_handler,
        routes::get_file_content_handler,
        routes::get_file_content_batch_handler,
        routes::get_commit_log_handler,
        routes::get_file_blob_shas_handler,
        routes::list_files_handler,
        routes::get_worktree_info_handler,
        routes::create_worktree_handler,
        routes::remove_worktree_handler,
        routes::delete_worktree_handler,
        routes::retry_worktree_setup_handler,
        routes::list_project_worktrees_handler,
        routes::remove_orphan_worktree_handler,
        routes::get_original_branch_handler,
        routes::check_merge_conflicts_handler,
        routes::merge_feature_branch_handler,
        routes::delete_feature_branch_handler,
    ),
    components(schemas(
        HealthResponse,
        models::BranchResponse,
        models::GitStats,
        models::DiffResponse,
        models::ChangedFile,
        models::FileContent,
        models::FileContentBatchItem,
        models::CommitLogEntry,
        models::CommitLogResponse,
        models::FileBlobSha,
        models::WorktreeInfo,
        models::ProjectWorktreeInfo,
        models::MergeConflictResult,
        models::MergeResult,
        models::OriginalBranchResponse,
        models::SuccessResponse,
        models::CreateWorktreeResponse,
        models::GetBranchParams,
        models::GetStatsParams,
        models::GetDiffParams,
        models::GetChangedFilesParams,
        models::GetFileContentParams,
        models::GetFileContentBatchBody,
        models::GetCommitLogParams,
        models::GetFileBlobShasParams,
        models::ListFilesParams,
        models::WorktreeInfoParams,
        models::CreateWorktreeBody,
        models::RemoveWorktreeParams,
        models::DeleteWorktreeParams,
        models::RetryWorktreeBody,
        models::ListProjectWorktreesParams,
        models::RemoveOrphanWorktreeBody,
        models::GetOriginalBranchParams,
        models::CheckMergeConflictsParams,
        models::MergeFeatureBranchBody,
        models::DeleteFeatureBranchParams,
    )),
)]
struct ApiDoc;

#[derive(Serialize, utoipa::ToSchema)]
struct HealthResponse {
    status: String,
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses((status = 200, description = "Service is healthy", body = HealthResponse))
)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

#[utoipa::path(
    get,
    path = "/api/openapi.json",
    responses((status = 200, description = "OpenAPI specification"))
)]
async fn openapi_spec() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/openapi.json", get(openapi_spec))
}
