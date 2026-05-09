//! ACP `initialize` + `session/new`/`session/load` handshake.
//!
//! Returns a `NegotiatedSession` describing the live session id, the model
//! string the agent claims to be using (when available), advertised modes,
//! configured MCP servers, and any context-window hint we could recover.
//!
//! ACP version drift is handled defensively: `session/load` is gated behind
//! the agent's `loadSession` capability, and a `MethodNotFound` (or any RPC
//! error) on `session/load` falls back to a fresh `session/new`. We never
//! crash the spawn; instead we degrade and log.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::domain::agents::acp::runtime::mcp::build_stdio_mcp_payload;
use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeMcpServerConfig, RuntimeMcpServerStatus, RuntimeSpawnConfig,
};

const PROTOCOL_VERSION: u64 = 1;
const INIT_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_SETUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub struct NegotiatedSession {
    pub session_id: String,
    pub model: Option<String>,
    pub mcp_servers: Vec<RuntimeMcpServerStatus>,
    pub context_window: Option<u64>,
    /// `currentModeId` reported by the agent in `session/new`, when it
    /// advertises one. `None` if the agent omits modes from the response.
    pub current_mode: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct AgentCapabilities {
    pub load_session: bool,
}

/// Run the full handshake. Returns the `NegotiatedSession` or a
/// `RuntimeError` if any step fails fatally (initialize timed out / agent
/// hung up). Soft failures (resume not supported) are logged and the loop
/// falls back to a fresh session.
///
/// `context_window` is provider-resolved: the caller (an adapter) maps the
/// model id → window using its provider catalog before invoking us.
pub async fn negotiate_session(
    client: &AcpClient,
    config: &RuntimeSpawnConfig,
    context_window: Option<u64>,
) -> Result<NegotiatedSession, RuntimeError> {
    let init_result = client
        .request_with_timeout("initialize", initialize_params(client), INIT_TIMEOUT)
        .await
        .map_err(|e| RuntimeError::new(format!("ACP initialize failed: {e}")))?;
    let capabilities = parse_agent_capabilities(&init_result);

    let model_id = config.model.clone();
    let mcp_servers = build_stdio_mcp_payload(config.mcp_servers.as_ref());
    let mcp_statuses = mcp_status_list(config.mcp_servers.as_ref());

    // ACP sessions are bound to the subprocess lifetime: a session id created
    // by one ACP subprocess is unknown to the next. We always spawn a fresh
    // subprocess per Cadencr session, so resume can never succeed today.
    // `session/load` for unknown ids has been observed to hang silently rather
    // than error fast, so we skip it unconditionally and start fresh.
    if config.resume_session_id.is_some() {
        tracing::debug!(
            advertised_load_session = capabilities.load_session,
            "ignoring resume_session_id on ACP — sessions are subprocess-scoped"
        );
    }
    let (session_id, current_mode) = start_new_session(client, &config.cwd, &mcp_servers).await?;

    Ok(NegotiatedSession {
        session_id,
        model: model_id,
        mcp_servers: mcp_statuses,
        context_window,
        current_mode,
    })
}

fn initialize_params(client: &AcpClient) -> Value {
    let info = client.client_info();
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "clientCapabilities": {
            "fs": {
                "readTextFile": true,
                "writeTextFile": true,
            },
            "terminal": true,
        },
        "clientInfo": {
            "name": info.name,
            "title": info.title,
            "version": info.version,
        }
    })
}

fn parse_agent_capabilities(init_response: &Value) -> AgentCapabilities {
    let load_session = init_response
        .get("agentCapabilities")
        .and_then(|caps| caps.get("loadSession"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    AgentCapabilities { load_session }
}

async fn start_new_session(
    client: &AcpClient,
    cwd: &Path,
    mcp_servers: &Value,
) -> Result<(String, Option<String>), RuntimeError> {
    let result = client
        .request_with_timeout(
            "session/new",
            json!({
                "cwd": cwd.to_string_lossy(),
                "mcpServers": mcp_servers,
            }),
            SESSION_SETUP_TIMEOUT,
        )
        .await
        .map_err(|e| RuntimeError::new(format!("ACP session/new failed: {e}")))?;
    let session_id = extract_session_id(&result, "")?;
    Ok((session_id, extract_current_mode(&result)))
}

/// Extract `modes.currentModeId` from a `session/new` response, or `None`
/// when the agent omits it.
fn extract_current_mode(value: &Value) -> Option<String> {
    value
        .get("modes")
        .and_then(|m| m.get("currentModeId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn extract_session_id(value: &Value, fallback: &str) -> Result<String, RuntimeError> {
    if let Some(session_id) = value
        .get("sessionId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    {
        return Ok(session_id);
    }
    if !fallback.is_empty() {
        return Ok(fallback.to_string());
    }
    Err(RuntimeError::new(
        "ACP session response missing sessionId; refusing to continue with an empty id",
    ))
}

/// Synthesise an MCP server status list for the init event.
///
/// ACP `session/new` accepts an MCP server catalog but does not prove that
/// every configured server has spawned and passed a health check. Reporting
/// `connected` here would make the spec status field a lie, so keep the
/// status explicitly unknown until a future health probe can replace it with
/// an observed state.
fn mcp_status_list(
    servers: Option<&HashMap<String, RuntimeMcpServerConfig>>,
) -> Vec<RuntimeMcpServerStatus> {
    servers
        .map(|m| {
            m.keys()
                .map(|name| RuntimeMcpServerStatus {
                    name: name.clone(),
                    status: "unknown".to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        extract_current_mode, extract_session_id, mcp_status_list, parse_agent_capabilities,
        AgentCapabilities,
    };
    use crate::domain::agents::adapter::RuntimeMcpServerConfig;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn parse_capabilities_recognises_load_session_flag() {
        let caps = parse_agent_capabilities(&json!({
            "agentCapabilities": { "loadSession": true }
        }));
        assert!(caps.load_session);
    }

    #[test]
    fn parse_capabilities_defaults_load_session_false() {
        let caps = parse_agent_capabilities(&json!({}));
        assert!(!caps.load_session);
    }

    #[test]
    fn extract_session_id_uses_response_field_first() {
        assert_eq!(
            extract_session_id(&json!({ "sessionId": "abc" }), "fallback").unwrap(),
            "abc"
        );
    }

    #[test]
    fn extract_session_id_uses_resume_fallback_for_load_only() {
        assert_eq!(
            extract_session_id(&json!({}), "old-session").unwrap(),
            "old-session"
        );
    }

    #[test]
    fn extract_session_id_rejects_missing_id_when_no_resume_fallback() {
        let error = extract_session_id(&json!({}), "").expect_err("missing new session id fails");
        assert!(error.to_string().contains("missing sessionId"));
    }

    #[test]
    fn mcp_status_list_marks_servers_unknown_until_health_probe_exists() {
        let mut servers = HashMap::new();
        servers.insert(
            "tools".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "x".to_string(),
                args: None,
                env: None,
            },
        );
        let statuses = mcp_status_list(Some(&servers));
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].name, "tools");
        assert_eq!(statuses[0].status, "unknown");
    }

    #[test]
    fn agent_capabilities_default_is_none() {
        let caps = AgentCapabilities::default();
        assert!(!caps.load_session);
    }

    #[test]
    fn extract_current_mode_reads_modes_namespace() {
        let mode = extract_current_mode(&json!({
            "sessionId": "s-1",
            "modes": { "currentModeId": "plan" }
        }));
        assert_eq!(mode.as_deref(), Some("plan"));
    }

    #[test]
    fn extract_current_mode_returns_none_when_absent() {
        let mode = extract_current_mode(&json!({ "sessionId": "s-1" }));
        assert!(mode.is_none());
    }
}
