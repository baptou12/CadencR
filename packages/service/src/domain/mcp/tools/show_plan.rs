use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::oneshot;

use crate::domain::mcp::context::{ApprovalResult, McpContext};
use crate::domain::mcp::tools::read_plan::ReadPlanTool;

pub struct ShowPlanTool {
    pub ctx: Arc<McpContext>,
}

impl ShowPlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        // First, read and render the plan
        let read_plan = ReadPlanTool::new(Arc::clone(&self.ctx));
        let _plan_content = read_plan.call(plan_id).await?;

        // Create a unique approval request ID
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let request_id = format!("plan-approval-{plan_id}-{ts}");

        // Create oneshot channel and store sender
        let (tx, rx) = oneshot::channel::<ApprovalResult>();
        self.ctx.pending_approvals.insert(request_id.clone(), tx);

        // Block until approval arrives
        let result = rx.await.map_err(|_| "Approval channel closed".to_string())?;

        if result.approved {
            Ok("Plan approved".to_string())
        } else {
            let feedback = result.feedback.unwrap_or_default();
            Err(format!("Plan rejected. Feedback: {feedback}"))
        }
    }
}
