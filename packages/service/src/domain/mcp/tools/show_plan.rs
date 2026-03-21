use std::sync::Arc;

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::read_plan::ReadPlanTool;

/// Show the plan to the user for approval.
///
/// The actual approval blocking is handled by `canUseTool` in the engine's
/// `WorkflowPermissionBridge` — when it detects a `show_plan` tool call,
/// it emits a `plan_ready` WS event and blocks until the user approves.
/// By the time this tool executes, the plan has already been approved.
pub struct ShowPlanTool {
    pub ctx: Arc<McpContext>,
}

impl ShowPlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        // Read and return the plan — approval already handled by canUseTool
        let read_plan = ReadPlanTool::new(Arc::clone(&self.ctx));
        let plan_content = read_plan.call(plan_id).await?;
        Ok(format!("Plan approved.\n\n{plan_content}"))
    }
}
