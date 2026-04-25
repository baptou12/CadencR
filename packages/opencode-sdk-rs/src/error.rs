use thiserror::Error;

#[derive(Debug, Error)]
pub enum SdkError {
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

impl From<reqwest_eventsource::Error> for SdkError {
    fn from(value: reqwest_eventsource::Error) -> Self {
        SdkError::Protocol(value.to_string())
    }
}
