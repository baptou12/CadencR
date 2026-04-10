use axum::extract::{Json, Query, State};
use axum::routing::{delete, get, post};
use axum::Router;

use crate::app_state::AppState;
use crate::domain::git::models::*;
use crate::domain::git::service;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/api/git/branch", params(("project_id" = i64, Query,)), responses((status = 200, body = BranchResponse)))]
pub async fn get_branch_handler(State(state): State<AppState>, Query(params): Query<GetBranchParams>) -> Result<Json<BranchResponse>, AppError> {
    Ok(Json(service::get_branch(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/stats", params(("feature_id" = i64, Query,), ("mode" = Option<String>, Query,), ("target_branch" = Option<String>, Query,)), responses((status = 200, body = GitStats)))]
pub async fn get_stats_handler(State(state): State<AppState>, Query(params): Query<GetStatsParams>) -> Result<Json<GitStats>, AppError> {
    Ok(Json(service::get_stats(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/diff", params(("feature_id" = i64, Query,), ("mode" = String, Query,), ("commit_sha" = Option<String>, Query,), ("target_branch" = Option<String>, Query,)), responses((status = 200, body = DiffResponse)))]
pub async fn get_diff_handler(State(state): State<AppState>, Query(params): Query<GetDiffParams>) -> Result<Json<DiffResponse>, AppError> {
    Ok(Json(service::get_diff(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/changed-files", params(("feature_id" = i64, Query,), ("mode" = String, Query,), ("target_branch" = Option<String>, Query,)), responses((status = 200, body = Vec<ChangedFile>)))]
pub async fn get_changed_files_handler(State(state): State<AppState>, Query(params): Query<GetChangedFilesParams>) -> Result<Json<Vec<ChangedFile>>, AppError> {
    Ok(Json(service::get_changed_files(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/file-content", params(("feature_id" = i64, Query,), ("file_path" = String, Query,), ("mode" = String, Query,), ("commit_sha" = Option<String>, Query,), ("target_branch" = Option<String>, Query,)), responses((status = 200, body = FileContent)))]
pub async fn get_file_content_handler(State(state): State<AppState>, Query(params): Query<GetFileContentParams>) -> Result<Json<FileContent>, AppError> {
    Ok(Json(service::get_file_content(&state, params).await?))
}

#[utoipa::path(post, path = "/api/git/file-content-batch", request_body = GetFileContentBatchBody, responses((status = 200, body = Vec<FileContentBatchItem>)))]
pub async fn get_file_content_batch_handler(State(state): State<AppState>, Json(body): Json<GetFileContentBatchBody>) -> Result<Json<Vec<FileContentBatchItem>>, AppError> {
    Ok(Json(service::get_file_content_batch(&state, body).await?))
}

#[utoipa::path(get, path = "/api/git/commit-log", params(("feature_id" = i64, Query,), ("limit" = Option<i64>, Query,)), responses((status = 200, body = CommitLogResponse)))]
pub async fn get_commit_log_handler(State(state): State<AppState>, Query(params): Query<GetCommitLogParams>) -> Result<Json<CommitLogResponse>, AppError> {
    Ok(Json(service::get_commit_log(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/file-blob-shas", params(("feature_id" = i64, Query,)), responses((status = 200, body = Vec<FileBlobSha>)))]
pub async fn get_file_blob_shas_handler(State(state): State<AppState>, Query(params): Query<GetFileBlobShasParams>) -> Result<Json<Vec<FileBlobSha>>, AppError> {
    Ok(Json(service::get_file_blob_shas(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/files", params(("feature_id" = i64, Query,)), responses((status = 200, body = Vec<String>)))]
pub async fn list_files_handler(State(state): State<AppState>, Query(params): Query<ListFilesParams>) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(service::list_files(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/worktree/info", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = Option<WorktreeInfo>)))]
pub async fn get_worktree_info_handler(State(state): State<AppState>, Query(params): Query<WorktreeInfoParams>) -> Result<Json<Option<WorktreeInfo>>, AppError> {
    Ok(Json(service::get_worktree_info(&state, params).await?))
}

#[utoipa::path(post, path = "/api/git/worktree", request_body = CreateWorktreeBody, responses((status = 200, body = CreateWorktreeResponse)))]
pub async fn create_worktree_handler(State(state): State<AppState>, Json(body): Json<CreateWorktreeBody>) -> Result<Json<CreateWorktreeResponse>, AppError> {
    Ok(Json(service::create_worktree(&state, body).await?))
}

#[utoipa::path(delete, path = "/api/git/worktree", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = SuccessResponse)))]
pub async fn remove_worktree_handler(State(state): State<AppState>, Query(params): Query<RemoveWorktreeParams>) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(service::remove_worktree(&state, params).await?))
}

#[utoipa::path(delete, path = "/api/git/worktree/safe", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = SuccessResponse)))]
pub async fn delete_worktree_handler(State(state): State<AppState>, Query(params): Query<DeleteWorktreeParams>) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(service::delete_worktree(&state, params).await?))
}

#[utoipa::path(post, path = "/api/git/worktree/retry", request_body = RetryWorktreeBody, responses((status = 200, body = SuccessResponse)))]
pub async fn retry_worktree_setup_handler(State(state): State<AppState>, Json(body): Json<RetryWorktreeBody>) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(service::retry_worktree_setup(&state, body).await?))
}

#[utoipa::path(get, path = "/api/git/worktrees", params(("project_id" = i64, Query,)), responses((status = 200, body = Vec<ProjectWorktreeInfo>)))]
pub async fn list_project_worktrees_handler(State(state): State<AppState>, Query(params): Query<ListProjectWorktreesParams>) -> Result<Json<Vec<ProjectWorktreeInfo>>, AppError> {
    Ok(Json(service::list_project_worktrees(&state, params).await?))
}

#[utoipa::path(delete, path = "/api/git/worktree/orphan", request_body = RemoveOrphanWorktreeBody, responses((status = 200, body = SuccessResponse)))]
pub async fn remove_orphan_worktree_handler(State(state): State<AppState>, Json(body): Json<RemoveOrphanWorktreeBody>) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(service::remove_orphan_worktree(&state, body).await?))
}

#[utoipa::path(get, path = "/api/git/original-branch", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = OriginalBranchResponse)))]
pub async fn get_original_branch_handler(State(state): State<AppState>, Query(params): Query<GetOriginalBranchParams>) -> Result<Json<OriginalBranchResponse>, AppError> {
    Ok(Json(service::get_original_branch(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/merge-conflicts", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = MergeConflictResult)))]
pub async fn check_merge_conflicts_handler(State(state): State<AppState>, Query(params): Query<CheckMergeConflictsParams>) -> Result<Json<MergeConflictResult>, AppError> {
    Ok(Json(service::check_merge_conflicts(&state, params).await?))
}

#[utoipa::path(post, path = "/api/git/merge", request_body = MergeFeatureBranchBody, responses((status = 200, body = MergeResult)))]
pub async fn merge_feature_branch_handler(State(state): State<AppState>, Json(body): Json<MergeFeatureBranchBody>) -> Result<Json<MergeResult>, AppError> {
    Ok(Json(service::merge_feature_branch(&state, body).await?))
}

#[utoipa::path(delete, path = "/api/git/branch", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = SuccessResponse)))]
pub async fn delete_feature_branch_handler(State(state): State<AppState>, Query(params): Query<DeleteFeatureBranchParams>) -> Result<Json<SuccessResponse>, AppError> {
    Ok(Json(service::delete_feature_branch(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/has-uncommitted-changes", params(("project_id" = i64, Query,), ("feature_id" = i64, Query,)), responses((status = 200, body = HasUncommittedChangesResponse)))]
pub async fn has_uncommitted_changes_handler(State(state): State<AppState>, Query(params): Query<HasUncommittedChangesParams>) -> Result<Json<HasUncommittedChangesResponse>, AppError> {
    Ok(Json(service::has_uncommitted_changes(&state, params).await?))
}

#[utoipa::path(get, path = "/api/git/blame", params(("project_path" = String, Query,), ("file_path" = String, Query,)), responses((status = 200, body = BlameResponse)))]
pub async fn get_blame_handler(Query(params): Query<GetBlameParams>) -> Result<Json<BlameResponse>, AppError> {
    Ok(Json(service::get_blame(params).await?))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn git_router() -> Router<AppState> {
    Router::new()
        .route("/api/git/branch", get(get_branch_handler).delete(delete_feature_branch_handler))
        .route("/api/git/stats", get(get_stats_handler))
        .route("/api/git/diff", get(get_diff_handler))
        .route("/api/git/changed-files", get(get_changed_files_handler))
        .route("/api/git/file-content", get(get_file_content_handler))
        .route("/api/git/file-content-batch", post(get_file_content_batch_handler))
        .route("/api/git/commit-log", get(get_commit_log_handler))
        .route("/api/git/file-blob-shas", get(get_file_blob_shas_handler))
        .route("/api/git/files", get(list_files_handler))
        .route("/api/git/worktree/info", get(get_worktree_info_handler))
        .route("/api/git/worktree", post(create_worktree_handler).delete(remove_worktree_handler))
        .route("/api/git/worktree/safe", delete(delete_worktree_handler))
        .route("/api/git/worktree/retry", post(retry_worktree_setup_handler))
        .route("/api/git/worktrees", get(list_project_worktrees_handler))
        .route("/api/git/worktree/orphan", delete(remove_orphan_worktree_handler))
        .route("/api/git/original-branch", get(get_original_branch_handler))
        .route("/api/git/merge-conflicts", get(check_merge_conflicts_handler))
        .route("/api/git/merge", post(merge_feature_branch_handler))
        .route("/api/git/has-uncommitted-changes", get(has_uncommitted_changes_handler))
        .route("/api/git/blame", get(get_blame_handler))
}
