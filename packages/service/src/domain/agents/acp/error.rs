use std::fmt::{Display, Formatter};

/// Errors emitted by the generic ACP stdio JSON-RPC transport.
///
/// Provider-neutral by design: this layer doesn't know about OpenCode (or any
/// other ACP provider). Adapters convert these into `RuntimeError` for the
/// `AgentRuntimeSession` channel.
#[derive(Debug)]
pub enum AcpError {
    Io(std::io::Error),
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
    /// Failed to spawn the subprocess (binary missing, pipes etc.). Distinct
    /// from generic IO so adapters can render an actionable message.
    Spawn(String),
}

impl Display for AcpError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "io error: {error}"),
            Self::Timeout(label) => write!(f, "ACP request timed out: {label}"),
            Self::Protocol(message) => write!(f, "ACP protocol error: {message}"),
            Self::Rpc { code, message } => write!(f, "ACP returned error {code}: {message}"),
            Self::Spawn(message) => write!(f, "failed to spawn ACP subprocess: {message}"),
        }
    }
}

impl std::error::Error for AcpError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AcpError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl AcpError {
    pub(crate) fn from_acp(value: agent_client_protocol::Error) -> Self {
        Self::Rpc {
            code: i32::from(value.code) as i64,
            message: value.message,
        }
    }
}
