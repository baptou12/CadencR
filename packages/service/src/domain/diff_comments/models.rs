use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct DiffComment {
    pub id: i64,
    pub feature_id: i64,
    pub file_path: String,
    pub line_number: i64,
    pub side: String,
    pub content: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDiffCommentRequest {
    pub feature_id: i64,
    pub file_path: String,
    pub line_number: i64,
    pub side: String,
    pub content: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDiffCommentRequest {
    pub content: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdatedResponse {
    pub updated: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeletedResponse {
    pub deleted: u64,
}

// Diff viewed models

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct DiffViewedFile {
    pub id: i64,
    pub feature_id: i64,
    pub file_path: String,
    pub blob_sha: String,
    pub viewed_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MarkViewedRequest {
    pub feature_id: i64,
    pub file_path: String,
    pub blob_sha: String,
}
