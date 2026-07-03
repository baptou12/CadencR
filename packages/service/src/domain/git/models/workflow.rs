use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ---------------------------------------------------------------------------
// Branches / status / compare-url / target-branch (Git workflow overhaul)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct ListBranchesParams {
    pub project_id: i64,
}

/// One row per branch known to the project repo. Local + remote-tracking
/// entries are merged: an `origin/foo` that has a matching local `foo` shows
/// once with `is_local = true`. `attached_*` are populated from the worktree
/// registry so the UI can warn when reusing a branch already in use.
#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct BranchInfo {
    pub name: String,
    pub is_local: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attached_worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attached_feature_id: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetGitStatusParams {
    pub feature_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetCompareUrlParams {
    pub feature_id: i64,
}

/// Response for `GET /api/git/compare-url`. `available = false` lets the
/// frontend disable the action without inspecting the host. `label` is always
/// present so the UI has copy to render.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CompareUrlResponse {
    pub url: String,
    pub label: String,
    pub available: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTargetBranchBody {
    pub target_branch: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CheckoutBody {
    pub project_id: i64,
    pub branch: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CheckoutValidateBody {
    pub project_id: i64,
    pub branch: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CommitBody {
    pub feature_id: i64,
    pub message: String,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PushBody {
    pub feature_id: i64,
}

/// User-typed bytes for an interactive `git push` prompt. The backend
/// appends a `\n` if the caller didn't, since every prompt we care about
/// (passphrase, `yes/no`, HTTPS password) reads a line.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PushInputBody {
    pub feature_id: i64,
    pub text: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetUncommittedFilesParams {
    pub feature_id: i64,
}
