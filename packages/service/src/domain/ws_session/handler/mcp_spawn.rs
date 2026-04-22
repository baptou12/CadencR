//! Build the `mcp_servers` config map for subprocess spawns.
//!
//! Invariant: one subprocess per (agent-type, feature). Do not revert to
//! sharing across features — feature-id pinning is what blocks a prompt-
//! injected agent from operating on another feature's data.

use std::collections::HashMap;
use std::env;

use tracing::info;

use crate::domain::agents::adapter::RuntimeMcpServerConfig;
use crate::domain::mcp::servers::{mcp_server_name, AgentType};

pub fn build_mcp_server_config(
    agent_type: AgentType,
    feature_id: i64,
) -> HashMap<String, RuntimeMcpServerConfig> {
    let server_name = mcp_server_name(agent_type);
    let binary_path = env::current_exe()
        .unwrap_or_else(|_| "cadence-service".into())
        .to_string_lossy()
        .to_string();

    let db_path = env::var("CADENCE_DB_PATH").ok();
    let env_vars = db_path
        .as_ref()
        .map(|path| HashMap::from([("CADENCE_DB_PATH".to_string(), path.clone())]));

    // Always pass --db-path explicitly so the subprocess doesn't rely solely
    // on inheriting the environment variable.
    let mut mcp_args = Vec::new();
    if let Some(ref path) = db_path {
        mcp_args.push("--db-path".to_string());
        mcp_args.push(path.clone());
    }
    mcp_args.push("mcp-serve".to_string());
    mcp_args.push("--agent-type".to_string());
    mcp_args.push(format!("{agent_type:?}").to_lowercase());
    mcp_args.push("--feature-id".to_string());
    mcp_args.push(feature_id.to_string());

    info!(
        server_name,
        binary_path,
        feature_id,
        ?mcp_args,
        "built MCP server config"
    );

    let config = RuntimeMcpServerConfig::Stdio {
        command: binary_path,
        args: Some(mcp_args),
        env: env_vars,
    };

    HashMap::from([(server_name, config)])
}
