use serde::Deserialize;
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
    pub commit_sha: Option<String>,
    pub target_branch: Option<String>,
}

/// Per-file unified diff. Mirrors `GetDiffParams` but scoped to a single
/// `file_path`, so the diff pane can fetch each file's patch lazily instead of
/// downloading + parsing the whole working-tree diff as one blob.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GetFileDiffParams {
    pub feature_id: i64,
    pub file_path: String,
    /// Pre-rename path for a rename/copy entry, so the diff can be scoped to
    /// both paths and git's rename detection fires instead of reporting a
    /// whole-file addition.
    pub old_file_path: Option<String>,
    pub mode: String,
    pub commit_sha: Option<String>,
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
#[serde(rename_all = "lowercase")]
pub enum DiffImageSide {
    Old,
    New,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetDiffImageParams {
    pub feature_id: i64,
    pub file_path: String,
    pub old_file_path: Option<String>,
    pub side: DiffImageSide,
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
pub struct GetCommitGraphParams {
    pub feature_id: i64,
    #[serde(default)]
    pub skip: i64,
    #[serde(default = "default_graph_limit")]
    pub limit: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetCommitUrlParams {
    pub feature_id: i64,
    pub sha: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetBlameParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub file_path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetFileBlobShasParams {
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListStashesParams {
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
    #[serde(default)]
    pub force: bool,
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
pub struct ListFeatureWorktreesParams {
    pub project_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RemoveOrphanWorktreeBody {
    pub project_id: i64,
    pub worktree_path: String,
    #[serde(default)]
    pub force: bool,
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
pub struct DeleteFeatureBranchParams {
    pub project_id: i64,
    pub feature_id: i64,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct BranchDeleteCheckParams {
    pub project_id: i64,
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[allow(dead_code)]
pub struct HasUncommittedChangesParams {
    pub project_id: i64,
    pub feature_id: i64,
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

fn default_graph_limit() -> i64 {
    50
}
