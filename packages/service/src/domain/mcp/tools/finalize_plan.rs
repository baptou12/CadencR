use std::sync::Arc;

use super::helpers::verify_plan_ownership;
use crate::domain::mcp::McpContext;

pub struct FinalizePlanTool {
    pub ctx: Arc<McpContext>,
}

impl FinalizePlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id()).await?;

        let mut tx = self
            .ctx
            .write_pool
            .begin()
            .await
            .map_err(|e| format!("Failed to begin transaction: {e}"))?;

        sqlx::query("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'")
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update phases: {e}"))?;

        sqlx::query(
            "UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?",
        )
        .bind(plan_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to update plan: {e}"))?;

        sqlx::query("UPDATE features SET status = 'planned' WHERE id = (SELECT feature_id FROM plans WHERE id = ?)")
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Failed to update feature: {e}"))?;

        tx.commit()
            .await
            .map_err(|e| format!("Failed to commit transaction: {e}"))?;

        // Populate the workflow queue after plan finalization
        let feature_id = self.ctx.feature_id();
        let workflow_type = crate::domain::features::models::WorkflowType::FeatureBuild;
        let strategy = crate::domain::workflow::strategies::get_strategy(&workflow_type)
            .map_err(|e| format!("Strategy error: {e}"))?;
        match strategy
            .populate_queue(
                &self.ctx.write_pool,
                &self.ctx.read_pool,
                feature_id,
                Some(plan_id),
            )
            .await
        {
            Ok(items) => {
                tracing::info!(
                    feature_id,
                    plan_id,
                    count = items.len(),
                    "Workflow queue populated"
                );
            }
            Err(e) => {
                tracing::error!(
                    feature_id,
                    plan_id,
                    error = %e,
                    "Failed to populate workflow queue"
                );
            }
        }

        Ok("Plan finalized. All draft phases set to pending.".to_string())
    }
}
