use serde_json::Value;

/// Token reserve used by the Codex CLI when displaying context-window usage.
///
/// Codex app-server reports raw totals and the model context window, while the
/// CLI subtracts this baseline before computing the displayed percentage.
pub const CONTEXT_USAGE_BASELINE_TOKENS: u64 = 12_000;

#[derive(Debug, Clone)]
pub enum AppServerEvent {
    Notification {
        method: String,
        params: Value,
    },
    ServerRequest {
        id: Value,
        method: String,
        params: Value,
    },
    ProcessExited,
}

#[derive(Debug, Clone)]
pub struct CodexModel {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub supported_efforts: Vec<String>,
    pub default_effort: Option<String>,
    pub context_window: Option<u64>,
    pub is_default: bool,
}

#[derive(Debug, Clone)]
pub struct ThreadHandle {
    pub id: String,
}

#[derive(Debug, Clone)]
pub struct TurnHandle {
    pub id: String,
    pub status: Option<String>,
}
