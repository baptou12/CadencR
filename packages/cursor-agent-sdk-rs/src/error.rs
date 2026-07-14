use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SdkError {
    #[error("Cursor Agent CLI not found; searched {} location(s)", searched.len())]
    CliNotFound { searched: Vec<PathBuf> },
    #[error("Cursor Agent CLI process failed: {0}")]
    Process(String),
    #[error("Cursor Agent CLI operation timed out: {0}")]
    Timeout(&'static str),
    #[error("io failed: {0}")]
    Io(#[from] std::io::Error),
}
