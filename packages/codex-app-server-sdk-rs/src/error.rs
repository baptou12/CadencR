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

impl SdkError {
    pub fn is_no_active_turn_to_steer(&self) -> bool {
        matches!(
            self,
            Self::Rpc { message, .. } if message == "no active turn to steer"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::SdkError;

    #[test]
    fn detects_no_active_turn_to_steer_rpc_error() {
        let error = SdkError::Rpc {
            code: -32600,
            message: "no active turn to steer".to_string(),
        };

        assert!(error.is_no_active_turn_to_steer());
    }

    #[test]
    fn ignores_unrelated_rpc_errors() {
        let error = SdkError::Rpc {
            code: -32600,
            message: "invalid input".to_string(),
        };

        assert!(!error.is_no_active_turn_to_steer());
    }
}
