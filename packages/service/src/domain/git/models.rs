use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetBranchParams {
    pub project_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetStatsParams {
    pub feature_id: i64,
    #[serde(default = "default_worktree_mode")]
    pub mode: String,
    pub target_branch: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetDiffParams {
    pub feature_id: i64,
    pub mode: String,
    pub commit_sha: Option<String>,
    pub target_branch: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetChangedFilesParams {
    pub feature_id: i64,
    pub mode: String,
    pub target_branch: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetFileContentParams {
    pub feature_id: i64,
    pub file_path: String,
    pub mode: String,
    pub commit_sha: Option<String>,
    pub target_branch: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetFileContentBatchBody {
    pub feature_id: i64,
    pub file_paths: Vec<String>,
    pub mode: String,
    pub commit_sha: Option<String>,
    pub target_branch: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetCommitLogParams {
    pub feature_id: i64,
    #[serde(default = "default_commit_limit")]
    pub limit: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetFileBlobShasParams {
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListFilesParams {
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct WorktreeInfoParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateWorktreeBody {
    pub project_id: i64,
    pub feature_id: i64,
    pub feature_title: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RemoveWorktreeParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteWorktreeParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RetryWorktreeBody {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListProjectWorktreesParams {
    pub project_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RemoveOrphanWorktreeBody {
    pub project_id: i64,
    pub worktree_path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetOriginalBranchParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CheckMergeConflictsParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeFeatureBranchBody {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteFeatureBranchParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct HasUncommittedChangesParams {
    pub project_id: i64,
    pub feature_id: i64,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BranchResponse {
    pub branch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitStats {
    pub files_changed: i32,
    pub insertions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DiffResponse {
    pub diff: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct ChangedFile {
    pub file: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_file: Option<String>,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileContent {
    pub old_content: String,
    pub new_content: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileContentBatchItem {
    pub old_content: String,
    pub new_content: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommitLogEntry {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub body: String,
    pub author: String,
    pub date: String,
    pub is_pushed: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CommitLogResponse {
    pub commits: Vec<CommitLogEntry>,
    pub is_on_base_branch: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileBlobSha {
    pub file_path: String,
    pub sha: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_bare: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ProjectWorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub feature_id: Option<i64>,
    pub feature_title: Option<String>,
    pub feature_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MergeConflictResult {
    pub has_conflicts: bool,
    pub conflict_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MergeResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct OriginalBranchResponse {
    pub original_branch: String,
    pub worktree_branch: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SuccessResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HasUncommittedChangesResponse {
    pub has_changes: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateWorktreeResponse {
    pub worktree_path: String,
    pub branch: String,
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

#[derive(Debug, sqlx::FromRow)]
pub struct FeatureRow {
    pub id: i64,
    pub project_id: i64,
    pub status: String,
}

#[derive(Debug)]
pub struct WorktreePaths {
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_original_branch: Option<String>,
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

fn default_worktree_mode() -> String {
    "worktree".to_string()
}

fn default_commit_limit() -> i64 {
    20
}
