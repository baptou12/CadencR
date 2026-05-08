use serde_json::Value;

/// Identification block included in `initialize` requests so agents can log
/// who called them. Matches the Codex SDK shape; used here verbatim because
/// ACP `initialize` accepts an open `clientInfo` object.
#[derive(Debug, Clone)]
pub struct AcpClientInfo {
    pub name: String,
    pub title: String,
    pub version: String,
}

impl Default for AcpClientInfo {
    fn default() -> Self {
        Self {
            name: "cadencr".into(),
            title: "Cadencr".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        }
    }
}

/// Events fanned out by the ACP transport to subscribers.
///
/// Provider-neutral. Adapters subscribe via `AcpClient::subscribe()` and
/// translate these into `RuntimeEvent`s.
#[derive(Debug, Clone)]
pub enum AcpEvent {
    /// One-way notification from the agent (no `id`). Examples: `session/update`,
    /// `current_mode_update`. Adapters route on `method`.
    Notification { method: String, params: Value },
    /// A request initiated *by the agent* that we (the client) must answer.
    /// Used for `session/request_permission`, `fs/*`, `terminal/*`. The
    /// adapter handles `method`, then calls `respond_server_request(id, ...)`
    /// or `reject_server_request(id, ...)`.
    ServerRequest {
        id: Value,
        method: String,
        params: Value,
    },
    /// The subprocess exited. Sent at most once (idempotent via `exit_sent`
    /// AtomicBool in the reader). Pending requests are drained with
    /// `AcpError::ProcessExited` immediately before this fires.
    ProcessExited {
        status: Option<i32>,
        signal: Option<i32>,
    },
}
