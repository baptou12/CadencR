use std::sync::Arc;

use super::helpers::verify_plan_ownership;
use crate::domain::mcp::McpContext;

pub struct FinalizePhases {
    pub ctx: Arc<McpContext>,
}

impl FinalizePhases {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id).await?;

        sqlx::query("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'")
            .bind(plan_id)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to finalize phases: {e}"))?;

        Ok("Phases finalized. All draft phases set to pending.".to_string())
    }
}
