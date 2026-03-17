use std::sync::Arc;

use crate::domain::mcp::McpContext;
use super::helpers::verify_plan_ownership;

pub struct FinalizePlanTool {
    pub ctx: Arc<McpContext>,
}

impl FinalizePlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id).await?;

        let mut tx = self.ctx.write_pool.begin().await
            .map_err(|e| format!("Failed to begin transaction: {e}"))?;

        sqlx::query("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'")
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update phases: {e}"))?;

        sqlx::query("UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?")
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update plan: {e}"))?;

        sqlx::query("UPDATE features SET status = 'planned' WHERE id = (SELECT feature_id FROM plans WHERE id = ?)")
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update feature: {e}"))?;

        tx.commit().await
            .map_err(|e| format!("Failed to commit transaction: {e}"))?;

        Ok("Plan finalized. All draft phases set to pending.".to_string())
    }
}
