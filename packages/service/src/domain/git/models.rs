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
    /// `true` when the file has staged changes (i.e. shows up in
    /// `git diff --cached`). Always `false` in branch-comparison mode.
    /// The frontend uses this to render a "staged" badge next to the file.
    #[serde(default)]
    pub is_staged: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileContent {
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    /// Byte size of the file at the old ref (0 if absent).
    pub old_size: u64,
    /// Byte size of the file at the new ref / working tree (0 if absent).
    pub new_size: u64,
    /// True if either side appears to be a binary blob.
    pub is_binary: bool,
    /// True if the file is too large to render automatically. When true the
    /// frontend shows a placeholder and the content fields may be `None` in
    /// batch responses (the single-file endpoint always returns content).
    pub is_large: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileContentBatchItem {
    pub file_path: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub old_size: u64,
    pub new_size: u64,
    pub is_binary: bool,
    pub is_large: bool,
}

impl From<FileContentBatchItem> for FileContent {
    fn from(item: FileContentBatchItem) -> Self {
        Self {
            old_content: item.old_content,
            new_content: item.new_content,
            old_size: item.old_size,
            new_size: item.new_size,
            is_binary: item.is_binary,
            is_large: item.is_large,
        }
    }
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

/// Per-feature worktree metadata sourced from `feature_settings`.
/// Includes features whose worktree directory has been deleted; callers can
/// check `live` to know whether the directory still exists on disk.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FeatureWorktreeInfo {
    pub feature_id: i64,
    pub worktree_path: String,
    pub worktree_branch: Option<String>,
    pub is_default_branch: bool,
    pub is_main_worktree: bool,
    pub live: bool,
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
    /// Set when the merge failed because of a content conflict. Lists the
    /// files git reported as conflicted so the UI can show them verbatim
    /// instead of an opaque "merge failed" string. `None` when the failure
    /// was something else (dirty target worktree, fast-forward refused, …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_files: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct OriginalBranchResponse {
    pub original_branch: String,
    pub worktree_branch: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HasUncommittedChangesResponse {
    pub has_changes: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = GitSuccessResponse)]
pub struct SuccessResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateWorktreeResponse {
    pub worktree_path: String,
    pub branch: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BranchDeleteCheckResponse {
    pub branch: String,
    pub current_branch: Option<String>,
    pub target_branch: String,
    pub default_branch: String,
    pub is_default_branch: bool,
    pub merged: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct GetBlameParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BlameLine {
    pub line: u32,
    pub author: String,
    pub date: String,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BlameResponse {
    pub lines: Vec<BlameLine>,
}

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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

fn default_worktree_mode() -> String {
    "worktree".to_string()
}

fn default_commit_limit() -> i64 {
    20
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_branch_response_serde_roundtrip() {
        let resp = BranchResponse {
            branch: Some("main".into()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: BranchResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back.branch, Some("main".into()));

        let resp_none = BranchResponse { branch: None };
        let json = serde_json::to_string(&resp_none).unwrap();
        let back: BranchResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back.branch, None);
        assert!(json.contains("null"));
    }

    #[test]
    fn test_git_stats_serde_roundtrip() {
        let stats = GitStats {
            files_changed: 3,
            insertions: 10,
            deletions: 5,
        };
        let json = serde_json::to_string(&stats).unwrap();
        let back: GitStats = serde_json::from_str(&json).unwrap();
        assert_eq!(back.files_changed, 3);
        assert_eq!(back.insertions, 10);
        assert_eq!(back.deletions, 5);
    }

    #[test]
    fn test_changed_file_serde_with_optional_old_file() {
        let cf = ChangedFile {
            file: "src/main.rs".into(),
            status: "M".into(),
            old_file: None,
            additions: 5,
            deletions: 3,
            is_staged: false,
        };
        let json = serde_json::to_string(&cf).unwrap();
        assert!(!json.contains("old_file"), "None should be skipped");
        assert!(json.contains("\"is_staged\":false"));

        let cf_rename = ChangedFile {
            file: "new.rs".into(),
            status: "R".into(),
            old_file: Some("old.rs".into()),
            additions: 0,
            deletions: 0,
            is_staged: true,
        };
        let json = serde_json::to_string(&cf_rename).unwrap();
        assert!(json.contains("old_file"));
        assert!(json.contains("\"is_staged\":true"));
        let back: ChangedFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.old_file, Some("old.rs".into()));
        assert!(back.is_staged);

        // Backwards compat: payloads from older API versions without
        // `is_staged` should still deserialize and default to `false`.
        let legacy = "{\"file\":\"x\",\"status\":\"M\",\"additions\":0,\"deletions\":0}";
        let back: ChangedFile = serde_json::from_str(legacy).unwrap();
        assert!(!back.is_staged);
    }

    #[test]
    fn test_commit_log_entry_serde_roundtrip() {
        let entry = CommitLogEntry {
            sha: "abc123".into(),
            short_sha: "abc".into(),
            message: "fix bug".into(),
            body: "details".into(),
            author: "dev".into(),
            date: "2024-01-01".into(),
            is_pushed: true,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let back: CommitLogEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.sha, "abc123");
        assert!(back.is_pushed);
    }

    #[test]
    fn test_worktree_info_serde_roundtrip() {
        let wt = WorktreeInfo {
            path: "/tmp/wt".into(),
            branch: "feature/test".into(),
            head: "deadbeef".into(),
            is_bare: false,
        };
        let json = serde_json::to_string(&wt).unwrap();
        let back: WorktreeInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.path, "/tmp/wt");
        assert!(!back.is_bare);
    }

    #[test]
    fn test_merge_conflict_result_serde_roundtrip() {
        let mc = MergeConflictResult {
            has_conflicts: true,
            conflict_files: vec!["a.rs".into(), "b.rs".into()],
        };
        let json = serde_json::to_string(&mc).unwrap();
        let back: MergeConflictResult = serde_json::from_str(&json).unwrap();
        assert!(back.has_conflicts);
        assert_eq!(back.conflict_files.len(), 2);
    }

    #[test]
    fn test_file_content_batch_item_has_file_path() {
        let item = FileContentBatchItem {
            file_path: "src/lib.rs".into(),
            old_content: Some("old".into()),
            new_content: None,
            old_size: 3,
            new_size: 0,
            is_binary: false,
            is_large: false,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("file_path"));
        assert!(json.contains("src/lib.rs"));
        assert!(json.contains("\"old_size\":3"));
        assert!(json.contains("\"is_binary\":false"));
        assert!(json.contains("\"is_large\":false"));
        let back: FileContentBatchItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file_path, "src/lib.rs");
        assert_eq!(back.old_content, Some("old".into()));
        assert_eq!(back.new_content, None);
        assert_eq!(back.old_size, 3);
        assert_eq!(back.new_size, 0);
        assert!(!back.is_binary);
        assert!(!back.is_large);
    }

    #[test]
    fn test_file_content_serde_roundtrip_with_metadata() {
        let fc = FileContent {
            old_content: None,
            new_content: None,
            old_size: 1_000_000,
            new_size: 2_000_000,
            is_binary: false,
            is_large: true,
        };
        let json = serde_json::to_string(&fc).unwrap();
        let back: FileContent = serde_json::from_str(&json).unwrap();
        assert!(back.is_large);
        assert_eq!(back.new_size, 2_000_000);
        assert!(back.old_content.is_none());
    }

    #[test]
    fn file_content_from_batch_item_drops_path_and_keeps_metadata() {
        let item = FileContentBatchItem {
            file_path: "src/big.rs".into(),
            old_content: None,
            new_content: Some("hi".into()),
            old_size: 0,
            new_size: 2,
            is_binary: false,
            is_large: true,
        };
        let fc: FileContent = item.into();
        assert_eq!(fc.new_content.as_deref(), Some("hi"));
        assert_eq!(fc.new_size, 2);
        assert!(fc.is_large);
    }

    #[test]
    fn test_success_response_skips_none_error() {
        let resp = SuccessResponse {
            success: true,
            error: None,
            blocked_reason: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(!json.contains("error"));

        let resp = SuccessResponse {
            success: false,
            error: Some("oops".into()),
            blocked_reason: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("oops"));
    }
}
