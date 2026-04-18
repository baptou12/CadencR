//! MCP stdio server entry point. Each subprocess is pinned to a single
//! `feature_id` via task-local scope; tool dispatchers read from that scope
//! instead of trusting agent-supplied arguments.

use rmcp::ServiceExt;
use tracing::info;

use super::context::{McpContext, CURRENT_FEATURE_ID};
use super::servers::McpServer;
use crate::shared::db;

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
    let ctx = McpContext::new(read_pool, write_pool);

    let server = super::servers::create_mcp_server(agent_type, ctx);
    let stdio = rmcp::transport::io::stdio();

    let quit_reason = CURRENT_FEATURE_ID
        .scope(feature_id, async move {
            match server {
                McpServer::Composable(s) => {
                    anyhow::Ok(s.serve(stdio).await?.waiting().await)
                }
                McpServer::Plan(s) => anyhow::Ok(s.serve(stdio).await?.waiting().await),
                McpServer::Session(s) => anyhow::Ok(s.serve(stdio).await?.waiting().await),
            }
        })
        .await?;

    info!(?quit_reason, "MCP stdio server shutting down");
    Ok(())
}
