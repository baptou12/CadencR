use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct MarkAgentDoneTool;

impl MarkAgentDoneTool {
    pub fn new(_ctx: Arc<McpContext>) -> Self {
        Self
    }

    pub async fn call(&self, summary: Option<String>) -> Result<String, String> {
        Ok(summary.unwrap_or_else(|| "Agent done.".to_string()))
    }
}
