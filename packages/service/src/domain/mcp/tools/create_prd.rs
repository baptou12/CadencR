use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct CreatePrdTool {
    pub ctx: Arc<McpContext>,
}

impl CreatePrdTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, prd: &str) -> Result<String, String> {
        sqlx::query("UPDATE features SET prd = ? WHERE id = ?")
            .bind(prd)
            .bind(self.ctx.feature_id)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to create PRD: {e}"))?;

        Ok("PRD created".to_string())
    }
}
