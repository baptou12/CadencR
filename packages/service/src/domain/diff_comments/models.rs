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
    /// Blob SHA of the file at the time the comment was created. The frontend
    /// compares this to the current blob SHA so it can auto-delete pending
    /// comments whose underlying file has since changed. Optional for legacy
    /// rows created before this column existed.
    #[serde(default)]
    pub original_blob_sha: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDiffCommentRequest {
    pub feature_id: i64,
    pub file_path: String,
    pub line_number: i64,
    pub side: String,
    pub content: String,
    /// Blob SHA of the file at submission time. Used by the frontend's
    /// stale-comment auto-cleanup. Optional so older clients still work.
    #[serde(default)]
    pub original_blob_sha: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_comment_serde_roundtrip() {
        let comment = DiffComment {
            id: 1,
            feature_id: 42,
            file_path: "src/main.rs".to_string(),
            line_number: 10,
            side: "RIGHT".to_string(),
            content: "Test comment".to_string(),
            status: "pending".to_string(),
            created_at: "2024-01-01T00:00:00".to_string(),
            original_blob_sha: Some("abc123".to_string()),
        };
        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"feature_id\":42"));
        assert!(json.contains("\"file_path\":\"src/main.rs\""));
        assert!(json.contains("\"status\":\"pending\""));
        assert!(json.contains("\"original_blob_sha\":\"abc123\""));
    }

    #[test]
    fn test_diff_comment_serde_null_blob_sha() {
        let comment = DiffComment {
            id: 1,
            feature_id: 42,
            file_path: "src/main.rs".to_string(),
            line_number: 10,
            side: "RIGHT".to_string(),
            content: "Test comment".to_string(),
            status: "pending".to_string(),
            created_at: "2024-01-01T00:00:00".to_string(),
            original_blob_sha: None,
        };
        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"original_blob_sha\":null"));
    }

    #[test]
    fn test_diff_viewed_file_serde_roundtrip() {
        let viewed = DiffViewedFile {
            id: 1,
            feature_id: 10,
            file_path: "src/lib.rs".to_string(),
            blob_sha: "abc123".to_string(),
            viewed_at: "2024-01-01T00:00:00".to_string(),
        };
        let json = serde_json::to_string(&viewed).unwrap();
        assert!(json.contains("\"feature_id\":10"));
        assert!(json.contains("\"blob_sha\":\"abc123\""));
    }

    #[test]
    fn test_create_diff_comment_request_deserialize() {
        let json = r#"{"feature_id":5,"file_path":"src/foo.rs","line_number":20,"side":"LEFT","content":"A comment"}"#;
        let req: CreateDiffCommentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.feature_id, 5);
        assert_eq!(req.file_path, "src/foo.rs");
        assert_eq!(req.line_number, 20);
        assert_eq!(req.side, "LEFT");
        assert_eq!(req.content, "A comment");
        assert_eq!(req.original_blob_sha, None);
    }

    #[test]
    fn test_create_diff_comment_request_with_blob_sha() {
        let json = r#"{"feature_id":5,"file_path":"src/foo.rs","line_number":20,"side":"LEFT","content":"A comment","original_blob_sha":"deadbeef"}"#;
        let req: CreateDiffCommentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.original_blob_sha.as_deref(), Some("deadbeef"));
    }

    #[test]
    fn test_update_diff_comment_request_deserialize() {
        let json = r#"{"content":"Updated content"}"#;
        let req: UpdateDiffCommentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.content, "Updated content");
    }

    #[test]
    fn test_mark_viewed_request_deserialize() {
        let json = r#"{"feature_id":7,"file_path":"src/bar.rs","blob_sha":"deadbeef"}"#;
        let req: MarkViewedRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.feature_id, 7);
        assert_eq!(req.file_path, "src/bar.rs");
        assert_eq!(req.blob_sha, "deadbeef");
    }
}
