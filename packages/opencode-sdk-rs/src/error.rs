use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SdkError {
    #[error("opencode CLI not found; searched {} location(s)", searched.len())]
    CliNotFound { searched: Vec<PathBuf> },

    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("http status {status}: {body}")]
    HttpStatus { status: u16, body: String },

    #[error("json decode failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("io failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("failed to spawn opencode server: {0}")]
    Spawn(String),

    #[error("operation timed out: {0}")]
    Timeout(String),

    #[error("protocol error: {0}")]
    Protocol(String),
}
