use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Provider identifier. Stable wire value used in both the
/// `features.source_provider` column and the runtime `agent_sessions`
/// row written by the importer.
pub const PROVIDER_CLAUDE_CODE: &str = "claude_code";

/// One row in the "select conversations to import" picker.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportConversationSummary {
    pub source_session_id: String,
    pub title: String,
    pub message_count: u32,
    pub modified_at: Option<String>,
    /// True if Cadencr already has a feature for this `source_session_id`
    /// under this project. The frontend pre-checks + disables those rows
    /// and the backend re-checks at import time.
    pub already_imported: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListImportConversationsResponse {
    pub conversations: Vec<ImportConversationSummary>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct StartImportRequest {
    pub session_ids: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StartImportResponse {
    pub job_id: String,
}

/// Two-state lifecycle. Per-session failures are surfaced via `skipped` so a
/// single bad file can't fail the whole job; a `Failed` job-level state can
/// be added when there's a code path that actually emits it.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ImportJobStatus {
    Running,
    Done,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ImportedRecord {
    pub source_session_id: String,
    pub feature_id: i64,
}

/// Reason a single session wasn't imported. Typed so the frontend can switch
/// on it and so typos can't drift between the importer and the docs.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    AlreadyImported,
    Empty,
    NotFound,
    ParseError,
    DbError,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SkippedRecord {
    pub source_session_id: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ImportJobState {
    pub job_id: String,
    pub status: ImportJobStatus,
    pub total: u32,
    pub completed: u32,
    pub imported: Vec<ImportedRecord>,
    pub skipped: Vec<SkippedRecord>,
}
