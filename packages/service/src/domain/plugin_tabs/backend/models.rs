//! Wire shapes of `backend.request` and the backend status the host shows.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// `POST /api/plugin-tabs/self/backend`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PluginBackendRequest {
    /// The backend's own method name, 1–128 characters.
    pub method: String,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub params: serde_json::Value,
    /// 1 ms – 120 s; 30 s when omitted.
    pub timeout_ms: Option<u64>,
}

/// The backend's answer: exactly one of `result` and `error`. A backend
/// error is the backend's own (`{code, message}`), passed through as is;
/// failures of the relay itself are ordinary `{error, code}` HTTP errors.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginBackendResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PluginBackendCallError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginBackendCallError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginTabBackendState {
    Running,
    /// Stopped by Cadencr (tab closed, turned off, permissions changed) or
    /// exited on its own with status 0.
    Stopped,
    /// Exited with a failure status or a signal Cadencr did not send.
    Crashed,
}

/// One tab's backend in one conversation, as the Activity dialog shows it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PluginTabBackendStatus {
    pub state: PluginTabBackendState,
    pub pid: Option<u32>,
    /// RFC 3339, of the current or last run.
    pub started_at: Option<String>,
    pub exited_at: Option<String>,
    pub exit_code: Option<i32>,
    /// Why the last run ended, in words.
    pub exit_reason: Option<String>,
    /// How many times it was started since Cadencr launched.
    pub starts: u32,
    /// The last lines it wrote to stderr (its log), oldest first.
    pub stderr_tail: Vec<String>,
}
