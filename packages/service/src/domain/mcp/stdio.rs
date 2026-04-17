//! MCP stdio server for subprocess mode: `cadence-service mcp-serve --agent-type plan`.

use rmcp::ServiceExt;
use tracing::info;

use super::context::McpContext;
use super::servers::McpServer;
use crate::shared::db;

pub async fn run_mcp_stdio(db_path: &str, agent_type_str: &str) -> anyhow::Result<()> {
    let agent_type: super::servers::AgentType = agent_type_str
        .parse()
        .map_err(|e: String| anyhow::anyhow!(e))?;

    info!(agent_type = agent_type_str, "starting MCP stdio server");

    let write_pool = db::create_write_pool(db_path).await?;
    let read_pool = db::create_read_pool(db_path).await?;
    let ctx = McpContext::new(read_pool, write_pool);

    let server = super::servers::create_mcp_server(agent_type, ctx);
    let stdio = rmcp::transport::io::stdio();

    // `waiting()` keeps the server alive after the handshake until stdin closes.
    let quit_reason = match server {
        McpServer::Composable(s) => s.serve(stdio).await?.waiting().await,
        McpServer::Plan(s) => s.serve(stdio).await?.waiting().await,
        McpServer::Session(s) => s.serve(stdio).await?.waiting().await,
    };

    info!(?quit_reason, "MCP stdio server shutting down");
    Ok(())
}
