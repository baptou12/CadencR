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
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileContentBatchItem {
    pub file_path: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
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
pub struct CreateWorktreeResponse {
    pub worktree_path: String,
    pub branch: String,
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
        let resp = BranchResponse { branch: Some("main".into()) };
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
        let stats = GitStats { files_changed: 3, insertions: 10, deletions: 5 };
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
        };
        let json = serde_json::to_string(&cf).unwrap();
        assert!(!json.contains("old_file"), "None should be skipped");

        let cf_rename = ChangedFile {
            file: "new.rs".into(),
            status: "R".into(),
            old_file: Some("old.rs".into()),
            additions: 0,
            deletions: 0,
        };
        let json = serde_json::to_string(&cf_rename).unwrap();
        assert!(json.contains("old_file"));
        let back: ChangedFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.old_file, Some("old.rs".into()));
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
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("file_path"));
        assert!(json.contains("src/lib.rs"));
        let back: FileContentBatchItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file_path, "src/lib.rs");
        assert_eq!(back.old_content, Some("old".into()));
        assert_eq!(back.new_content, None);
    }

    #[test]
    fn test_success_response_skips_none_error() {
        let resp = SuccessResponse { success: true, error: None };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(!json.contains("error"));

        let resp = SuccessResponse { success: false, error: Some("oops".into()) };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("oops"));
    }
}
