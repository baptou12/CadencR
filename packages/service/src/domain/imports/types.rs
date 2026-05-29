use serde::{Deserialize, Serialize};

/// Maximum number of characters we keep in a derived provider-import title.
pub const DERIVED_TITLE_MAX_CHARS: usize = 80;

/// A neutralized message ready to be inserted into `agent_messages`.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedMessage {
    pub role: String,
    pub content: String,
    pub message_type: String,
    pub tool_name: Option<String>,
    pub tool_use_id: Option<String>,
    pub model: Option<String>,
    pub created_at: Option<String>,
}

/// A whole imported conversation. Provider-specific parsers produce this
/// shape; shared persistence turns it into Cadencr rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedConversation {
    pub source_session_id: String,
    pub title: String,
    pub model: Option<String>,
    /// First message timestamp; used for the imported `agent_sessions.started_at`.
    pub started_at: Option<String>,
    /// Last message timestamp; doubles as `ended_at` and the picker's
    /// "most recent activity" sort key.
    pub modified_at: Option<String>,
    #[serde(skip)]
    pub messages: Vec<ImportedMessage>,
}

pub fn truncate_title(text: &str) -> String {
    let single_line: String = text.lines().next().unwrap_or("").trim().chars().collect();
    if single_line.chars().count() <= DERIVED_TITLE_MAX_CHARS {
        return single_line;
    }
    let prefix: String = single_line
        .chars()
        .take(DERIVED_TITLE_MAX_CHARS - 1)
        .collect();
    format!("{prefix}…")
}
