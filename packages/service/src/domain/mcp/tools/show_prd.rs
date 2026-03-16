use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::oneshot;

use crate::domain::mcp::context::{ApprovalResult, McpContext};
use crate::domain::mcp::tools::read_prd::ReadPrdTool;

pub struct ShowPrdTool {
    pub ctx: Arc<McpContext>,
}

impl ShowPrdTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self) -> Result<String, String> {
        // Read the PRD first
        let read_prd = ReadPrdTool::new(Arc::clone(&self.ctx));
        let _prd_content = read_prd.call().await?;

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let request_id = format!("prd-approval-{}-{ts}", self.ctx.feature_id);

        let (tx, rx) = oneshot::channel::<ApprovalResult>();
        self.ctx.pending_approvals.insert(request_id.clone(), tx);

        let result = rx.await.map_err(|_| "Approval channel closed".to_string())?;

        if result.approved {
            Ok("PRD approved".to_string())
        } else {
            let feedback = result.feedback.unwrap_or_default();
            Err(format!("PRD rejected. Feedback: {feedback}"))
        }
    }
}
