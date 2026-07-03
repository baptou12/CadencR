use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFileRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub file_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateFileResponse {
    pub path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateFolderRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub dir_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateFolderResponse {
    pub path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RenamePathRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub old_path: String,
    pub new_name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RenamePathResponse {
    pub new_path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MovePathRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub old_path: String,
    /// Target directory, relative to the project root. Use `""` or `"."` to
    /// move the entry to the project root.
    pub new_parent_path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MovePathResponse {
    pub new_path: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TrashPathRequest {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
    pub path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TrashPathResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct EditorRootParams {
    pub project_id: i64,
    #[serde(default)]
    pub feature_id: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EditorRootResponse {
    /// Absolute filesystem path of the editor root (project or feature
    /// worktree). Used by the frontend to build absolute paths for native
    /// shell operations such as "Reveal in Finder".
    pub root: String,
}
