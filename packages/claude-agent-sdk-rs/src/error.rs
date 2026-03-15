use thiserror::Error;

/// All errors that can occur in the Claude Agent SDK.
#[derive(Debug, Error)]
pub enum SdkError {
    /// The `claude` binary was not found in PATH or at the specified path.
    #[error("claude CLI not found in PATH or at specified path")]
    CliNotFound,

    /// Failed to spawn the child process.
    #[error("failed to spawn child process: {0}")]
    SpawnFailed(#[from] std::io::Error),

    /// Received a malformed JSON line from the CLI's stdout.
    /// The raw line is included for debugging.
    #[error("protocol error: malformed JSON line `{line}`: {source}")]
    ProtocolError {
        line: String,
        source: serde_json::Error,
    },

    /// The CLI exited with a non-zero exit code.
    #[error("CLI process exited with code {code:?}: {stderr}")]
    ProcessExit {
        code: Option<i32>,
        stderr: String,
    },

    /// An operation timed out.
    #[error("operation timed out")]
    Timeout,

    /// A generic I/O error occurred during stdin/stdout operations (distinct from SpawnFailed).
    #[error("I/O error: {0}")]
    IoError(std::io::Error),

    /// Failed to serialize a message for writing to stdin.
    #[error("serialization error: {0}")]
    SerializationError(serde_json::Error),

    /// Attempted to write to stdin after it was closed.
    #[error("stdin is closed")]
    InputClosed,

    /// The operation was cancelled via a CancellationToken.
    #[error("operation was cancelled")]
    Cancelled,
}
