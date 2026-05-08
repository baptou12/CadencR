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

use crate::domain::agents::acp::{AcpClient, AcpError};
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeMcpServerConfig, RuntimeMcpServerStatus, RuntimeSpawnConfig,
};

const PROTOCOL_VERSION: u64 = 1;
const INIT_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_SETUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub(super) struct NegotiatedSession {
    pub session_id: String,
    pub model: Option<String>,
    pub mcp_servers: Vec<RuntimeMcpServerStatus>,
    pub context_window: Option<u64>,
    pub agent_capabilities: AgentCapabilities,
}

#[derive(Debug, Default, Clone)]
pub(super) struct AgentCapabilities {
    pub load_session: bool,
}

/// Run the full handshake. Returns the `NegotiatedSession` or a
/// `RuntimeError` if any step fails fatally (initialize timed out / agent
/// hung up). Soft failures (resume not supported) are logged and the loop
/// falls back to a fresh session.
pub(super) async fn negotiate_session(
    client: &AcpClient,
    config: &RuntimeSpawnConfig,
) -> Result<NegotiatedSession, RuntimeError> {
    let init_result = client
        .request_with_timeout("initialize", initialize_params(client), INIT_TIMEOUT)
        .await
        .map_err(|e| RuntimeError::new(format!("ACP initialize failed: {e}")))?;
    let capabilities = parse_agent_capabilities(&init_result);

    let model_id = config.model.clone();
    let mcp_servers = build_mcp_payload(config.mcp_servers.as_ref());
    let mcp_statuses = mcp_status_list(config.mcp_servers.as_ref());

    // OpenCode-ACP sessions are bound to the subprocess lifetime: a session
    // id created by one `opencode acp` instance is unknown to the next.
    // We always spawn a fresh subprocess per Cadencr session, so resume can
    // never succeed against this agent today. `session/load` for unknown
    // ids has been observed to hang silently rather than error fast, so
    // we skip it unconditionally and start fresh. `resume_session_id` is
    // logged for diagnostics. When OpenCode (or another ACP provider)
    // adds durable cross-spawn sessions we'll honour `loadSession` here
    // again.
    if config.resume_session_id.is_some() {
        tracing::debug!(
            advertised_load_session = capabilities.load_session,
            "ignoring resume_session_id on ACP — sessions are subprocess-scoped"
        );
    }
    let session_id = start_new_session(client, &config.cwd, &mcp_servers).await?;

    // Mirror the HTTP path: derive the context window from the provider
    // catalog so the FE budget indicator works on ACP too.
    let context_window = match model_id.as_deref() {
        Some(model) => {
            crate::domain::agents::providers::opencode::context_window_for_model(model).await
        }
        None => None,
    };

    Ok(NegotiatedSession {
        session_id,
        model: model_id,
        mcp_servers: mcp_statuses,
        context_window,
        agent_capabilities: capabilities,
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

async fn try_load_session(
    client: &AcpClient,
    session_id: &str,
    cwd: &Path,
    mcp_servers: &Value,
    capabilities: &AgentCapabilities,
) -> Result<String, AcpError> {
    if !capabilities.load_session {
        return Err(AcpError::Rpc {
            code: -32601,
            message: "agent does not advertise loadSession capability".to_string(),
        });
    }
    let result = client
        .request_with_timeout(
            "session/load",
            json!({
                "sessionId": session_id,
                "cwd": cwd.to_string_lossy(),
                "mcpServers": mcp_servers,
            }),
            SESSION_SETUP_TIMEOUT,
        )
        .await?;
    extract_session_id(&result, session_id).map_err(|error| AcpError::Protocol(error.to_string()))
}

async fn start_new_session(
    client: &AcpClient,
    cwd: &Path,
    mcp_servers: &Value,
) -> Result<String, RuntimeError> {
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
    extract_session_id(&result, "")
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

/// Build the `mcpServers` array passed to `session/new` / `session/load`.
///
/// Today `RuntimeMcpServerConfig` only has a `Stdio` variant, so every
/// server we know about translates 1:1 onto ACP. When new variants are
/// added (HTTP/SSE, etc.) the match arm should explicitly emit a warning
/// — `RuntimeMcpServerConfig` is non-exhaustive on purpose so the
/// compiler will force this revisit.
fn build_mcp_payload(servers: Option<&HashMap<String, RuntimeMcpServerConfig>>) -> Value {
    let Some(servers) = servers else {
        return Value::Array(Vec::new());
    };
    let mut payload = Vec::new();
    for (name, config) in servers {
        match config {
            RuntimeMcpServerConfig::Stdio { command, args, env } => {
                let mut entry = json!({
                    "name": name,
                    "command": command,
                });
                if let Some(args) = args {
                    entry["args"] = json!(args);
                }
                if let Some(env) = env {
                    entry["env"] = json!(env);
                }
                payload.push(entry);
            }
        }
    }
    Value::Array(payload)
}

/// Synthesise an MCP server status list for the init event. ACP doesn't
/// expose health info, so we mark every configured server as `connected`
/// optimistically — bad servers will surface as tool-call failures later.
fn mcp_status_list(
    servers: Option<&HashMap<String, RuntimeMcpServerConfig>>,
) -> Vec<RuntimeMcpServerStatus> {
    servers
        .map(|m| {
            m.keys()
                .map(|name| RuntimeMcpServerStatus {
                    name: name.clone(),
                    status: "connected".to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        build_mcp_payload, extract_session_id, mcp_status_list, parse_agent_capabilities,
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
    fn build_mcp_payload_emits_stdio_entries() {
        let mut servers = HashMap::new();
        servers.insert(
            "fs".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "/usr/local/bin/mcp-fs".to_string(),
                args: Some(vec!["--mode".into(), "ro".into()]),
                env: None,
            },
        );
        let payload = build_mcp_payload(Some(&servers));
        let entry = &payload.as_array().unwrap()[0];
        assert_eq!(entry["name"], "fs");
        assert_eq!(entry["command"], "/usr/local/bin/mcp-fs");
        assert_eq!(entry["args"], json!(["--mode", "ro"]));
    }

    #[test]
    fn build_mcp_payload_handles_none() {
        assert!(build_mcp_payload(None).as_array().unwrap().is_empty());
    }

    #[test]
    fn mcp_status_list_marks_all_as_connected() {
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
        assert_eq!(statuses[0].status, "connected");
    }

    #[test]
    fn agent_capabilities_default_is_none() {
        let caps = AgentCapabilities::default();
        assert!(!caps.load_session);
    }
}
