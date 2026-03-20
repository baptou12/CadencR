use std::sync::Arc;

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::read_prd::ReadPrdTool;

/// Show the PRD to the user for approval.
///
/// The actual approval blocking is handled by `canUseTool` in the engine's
/// `WorkflowPermissionBridge` — when it detects a `show_prd` tool call,
/// it emits a `prd_ready` WS event and blocks until the user approves.
/// By the time this tool executes, the PRD has already been approved.
pub struct ShowPrdTool {
    pub ctx: Arc<McpContext>,
}

impl ShowPrdTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self) -> Result<String, String> {
        // Read and return the PRD — approval already handled by canUseTool
        let read_prd = ReadPrdTool::new(Arc::clone(&self.ctx));
        let prd_content = read_prd.call().await?;
        Ok(format!("PRD approved.\n\n{prd_content}"))
    }
}
