//! MCP stdio server for subprocess mode.
//!
//! When launched with `cadence-service mcp-serve --agent-type plan --feature-id 42`,
//! this module creates an McpContext, builds the appropriate agent server, and
//! serves it over stdin/stdout using the rmcp stdio transport.
//!
//! Note: approval gates (show_plan, show_prd) are handled by the engine's
//! `canUseTool` bridge in the parent process, NOT in this subprocess. By the
//! time the tool executes here, the user has already approved.

use rmcp::ServiceExt;
use tokio::sync::oneshot;
use tracing::info;

use super::context::McpContext;
use super::servers::McpServer;
use crate::shared::db;

/// Run an MCP server over stdin/stdout.
pub async fn run_mcp_stdio(
    db_path: &str,
    agent_type_str: &str,
    feature_id: i64,
) -> anyhow::Result<()> {
    let agent_type: super::servers::AgentType = agent_type_str
        .parse()
        .map_err(|e: String| anyhow::anyhow!(e))?;

    info!(
        agent_type = agent_type_str,
        feature_id, "starting MCP stdio server"
    );

    let write_pool = db::create_write_pool(db_path).await?;
    let read_pool = db::create_read_pool(db_path).await?;

    let (done_tx, done_rx) = oneshot::channel();
    let ctx = McpContext::new(read_pool, write_pool, feature_id, done_tx);

    let server = super::servers::create_mcp_server(agent_type, ctx);
    let stdio = rmcp::transport::io::stdio();

    match server {
        McpServer::Plan(s) => { s.serve(stdio).await?; }
        McpServer::Prd(s) => { s.serve(stdio).await?; }
        McpServer::Execute(s) => { s.serve(stdio).await?; }
        McpServer::Qa(s) => { s.serve(stdio).await?; }
        McpServer::Review(s) => { s.serve(stdio).await?; }
        McpServer::Risk(s) => { s.serve(stdio).await?; }
        McpServer::Retro(s) => { s.serve(stdio).await?; }
        McpServer::Session(s) => { s.serve(stdio).await?; }
    }

    // Wait for the agent to signal completion
    let _ = done_rx.await;

    info!("MCP stdio server shutting down");
    Ok(())
}
