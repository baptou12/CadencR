use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Provider identifier. Stable wire value used by runtime provider settings
/// and by imported `agent_sessions` provenance.
pub const PROVIDER_CLAUDE_CODE: &str = crate::domain::agents::claude_code::PROVIDER_ID;
pub const PROVIDER_CODEX_CLI: &str = crate::domain::agents::codex::PROVIDER_ID;
pub const PROVIDER_OPENCODE: &str = crate::domain::agents::opencode::PROVIDER_ID;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportProvider {
    ClaudeCode,
    CodexCli,
    Opencode,
}

impl ImportProvider {
    pub fn from_id(provider: &str) -> Option<Self> {
        match provider {
            PROVIDER_CLAUDE_CODE => Some(Self::ClaudeCode),
            PROVIDER_CODEX_CLI => Some(Self::CodexCli),
            PROVIDER_OPENCODE => Some(Self::Opencode),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => PROVIDER_CLAUDE_CODE,
            Self::CodexCli => PROVIDER_CODEX_CLI,
            Self::Opencode => PROVIDER_OPENCODE,
        }
    }
}

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
