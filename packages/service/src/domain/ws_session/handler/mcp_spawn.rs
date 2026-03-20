//! Utility for attaching MCP servers to CLI subprocess spawns.
//!
//! When spawning a Claude CLI subprocess via `claude_agent_sdk_rs::query()`,
//! an MCP server can be attached by providing an `McpServerConfig` in the
//! `Options::mcp_servers` field. The CLI will then spawn our MCP server as a
//! stdio subprocess and connect to it automatically.

use std::collections::HashMap;
use std::env;

use claude_agent_sdk_rs::mcp::McpServerConfig;
use tracing::info;

use crate::domain::mcp::servers::{mcp_server_name, AgentType};

/// Build the `mcp_servers` config map for attaching an MCP server to a CLI spawn.
///
/// The config tells the Claude CLI to spawn our service binary in MCP stdio mode,
/// which will serve the appropriate agent tools over stdin/stdout.
///
/// # Arguments
/// * `agent_type` - The type of MCP agent server to attach
/// * `feature_id` - The feature ID to pass to the MCP server for context
///
/// # Returns
/// A `HashMap<String, McpServerConfig>` suitable for `Options::mcp_servers`.
pub fn build_mcp_server_config(
    agent_type: AgentType,
    feature_id: i64,
) -> HashMap<String, McpServerConfig> {
    let server_name = mcp_server_name(agent_type);

    // Resolve the path to the cadence-service binary.
    // In development this is the running binary; in production it will be
    // the installed binary path.
    let binary_path = env::current_exe()
        .unwrap_or_else(|_| "cadence-service".into())
        .to_string_lossy()
        .to_string();

    // Pass DB path via environment so the MCP subprocess can access the same database
    // for reading/writing plans, phases, PRDs, etc.
    let mut env_vars = HashMap::new();
    if let Ok(db_path) = env::var("CADENCE_DB_PATH") {
        env_vars.insert("CADENCE_DB_PATH".to_string(), db_path);
    }

    // Build CLI args. Always pass --db-path explicitly so the subprocess
    // doesn't rely solely on inheriting the environment variable.
    let mut mcp_args = vec![
        "mcp-serve".to_string(),
        "--agent-type".to_string(),
        format!("{:?}", agent_type).to_lowercase(),
        "--feature-id".to_string(),
        feature_id.to_string(),
    ];
    if let Ok(db_path) = env::var("CADENCE_DB_PATH") {
        mcp_args.insert(0, db_path);
        mcp_args.insert(0, "--db-path".to_string());
    }

    info!(
        server_name,
        binary_path,
        ?mcp_args,
        feature_id,
        "built MCP server config for agent spawn"
    );

    let config = McpServerConfig::Stdio {
        command: binary_path,
        args: Some(mcp_args),
        env: if env_vars.is_empty() {
            None
        } else {
            Some(env_vars)
        },
    };

    let mut servers = HashMap::new();
    servers.insert(server_name.to_string(), config);
    servers
}
