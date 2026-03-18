use std::sync::Arc;
use std::time::Duration;

use tokio::sync::oneshot;

use crate::domain::mcp::context::{ApprovalResult, McpContext};
use crate::domain::mcp::tools::read_plan::ReadPlanTool;

/// Guard that removes an entry from `pending_approvals` on drop,
/// ensuring cleanup if the future is cancelled (e.g. client disconnect).
struct ApprovalGuard {
    ctx: Arc<McpContext>,
    request_id: String,
}

impl Drop for ApprovalGuard {
    fn drop(&mut self) {
        self.ctx.pending_approvals.remove(&self.request_id);
    }
}

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

        // Standardized approval request ID format: plan-approval-{feature_id}
        // Uses feature_id (not plan_id) so workflow handlers can resolve by convention.
        let feature_id = self.ctx.feature_id;
        let request_id = format!("plan-approval-{feature_id}");

        // Create oneshot channel and store sender
        let (tx, rx) = oneshot::channel::<ApprovalResult>();
        self.ctx.pending_approvals.insert(request_id.clone(), tx);

        // Guard ensures cleanup on drop (cancellation/disconnect)
        let _guard = ApprovalGuard {
            ctx: Arc::clone(&self.ctx),
            request_id: request_id.clone(),
        };

        // Block until approval arrives, with 30-minute timeout
        let result = match tokio::time::timeout(Duration::from_secs(1800), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => return Err("Approval channel closed".to_string()),
            Err(_) => {
                return Err("Approval timed out after 30 minutes".to_string());
            }
        };

        if result.approved {
            Ok("Plan approved".to_string())
        } else {
            let feedback = result.feedback.unwrap_or_default();
            Err(format!("Plan rejected. Feedback: {feedback}"))
        }
    }
}
