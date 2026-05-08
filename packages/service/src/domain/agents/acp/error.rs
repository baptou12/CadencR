use std::fmt::{Display, Formatter};

/// Errors emitted by the generic ACP stdio JSON-RPC transport.
///
/// Provider-neutral by design: this layer doesn't know about OpenCode (or any
/// other ACP provider). Adapters convert these into `RuntimeError` for the
/// `AgentRuntimeSession` channel.
#[derive(Debug)]
pub enum AcpError {
    Io(std::io::Error),
    Json(serde_json::Error),
    /// Per-RPC timeout. Carries a static label of the method that timed out so
    /// the host can surface a helpful error ("session/prompt timed out").
    Timeout(&'static str),
    /// Framing or parse error in the JSON-RPC stream — oversized line, invalid
    /// UTF-8, malformed frame envelope. Always surfaced; never swallowed.
    Protocol(String),
    /// JSON-RPC error object returned by the agent for a request we sent.
    Rpc {
        code: i64,
        message: String,
    },
    /// The ACP subprocess exited (cleanly or by signal). Pending requests are
    /// drained with this error so callers see a definitive failure rather than
    /// hanging forever.
    ProcessExited,
    /// The oneshot channel waiting for a response was closed before a response
    /// arrived (typically because the reader task dropped the sender).
    ResponseClosed,
    /// Failed to spawn the subprocess (binary missing, pipes etc.). Distinct
    /// from generic IO so adapters can render an actionable message.
    Spawn(String),
}

impl Display for AcpError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "io error: {error}"),
            Self::Json(error) => write!(f, "json error: {error}"),
            Self::Timeout(label) => write!(f, "ACP request timed out: {label}"),
            Self::Protocol(message) => write!(f, "ACP protocol error: {message}"),
            Self::Rpc { code, message } => write!(f, "ACP returned error {code}: {message}"),
            Self::ProcessExited => f.write_str("ACP process exited"),
            Self::ResponseClosed => f.write_str("ACP response channel closed"),
            Self::Spawn(message) => write!(f, "failed to spawn ACP subprocess: {message}"),
        }
    }
}

impl std::error::Error for AcpError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AcpError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for AcpError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}
