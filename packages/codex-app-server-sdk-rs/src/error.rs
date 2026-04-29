use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SdkError {
    #[error("codex CLI not found; searched {} location(s)", searched.len())]
    CliNotFound { searched: Vec<PathBuf> },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("request timed out: {0}")]
    Timeout(&'static str),
    #[error("app-server protocol error: {0}")]
    Protocol(String),
    #[error("app-server returned error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("app-server process exited")]
    ProcessExited,
    #[error("response channel closed")]
    ResponseClosed,
}
