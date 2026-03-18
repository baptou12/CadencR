use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct MarkAgentDoneTool {
    pub ctx: Arc<McpContext>,
}

impl MarkAgentDoneTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, summary: Option<String>) -> Result<String, String> {
        let mut guard = self.ctx.done_sender.lock().await;
        if let Some(sender) = guard.take() {
            let _ = sender.send(summary.clone());
            Ok(summary.unwrap_or_else(|| "Agent done.".to_string()))
        } else {
            Err("Agent done signal already sent".to_string())
        }
    }
}
