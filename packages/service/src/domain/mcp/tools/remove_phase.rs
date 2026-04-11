use std::sync::Arc;

use super::helpers::verify_phase_ownership;
use crate::domain::mcp::McpContext;

pub struct RemovePhaseTool {
    pub ctx: Arc<McpContext>,
}

impl RemovePhaseTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, phase_id: i64) -> Result<String, String> {
        verify_phase_ownership(&self.ctx.read_pool, phase_id, self.ctx.feature_id).await?;

        let status: String = sqlx::query_scalar("SELECT status FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_one(&self.ctx.read_pool)
            .await
            .map_err(|_| format!("Phase {phase_id} not found"))?;

        if status != "draft" {
            return Err("Can only remove draft phases".to_string());
        }

        sqlx::query("DELETE FROM phases WHERE id = ?")
            .bind(phase_id)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to remove phase: {e}"))?;

        Ok(format!("Phase {phase_id} removed"))
    }
}
