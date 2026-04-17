use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct ReadPrdTool {
    pub ctx: Arc<McpContext>,
}

impl ReadPrdTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self) -> Result<String, String> {
        let row: (Option<String>,) = sqlx::query_as("SELECT prd FROM features WHERE id = ?")
            .bind(self.ctx.feature_id())
            .fetch_one(&self.ctx.read_pool)
            .await
            .map_err(|e| format!("Feature not found: {e}"))?;

        match row.0 {
            Some(prd) if !prd.is_empty() => Ok(prd),
            _ => Err("No PRD found for this feature".to_string()),
        }
    }
}
