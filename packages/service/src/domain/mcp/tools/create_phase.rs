use std::sync::Arc;

use crate::domain::mcp::McpContext;
use super::helpers::verify_plan_ownership;

pub struct CreatePhaseTool {
    pub ctx: Arc<McpContext>,
}

impl CreatePhaseTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(
        &self,
        plan_id: i64,
        step_number: i64,
        title: String,
        prompt: String,
        complexity: Option<i8>,
        commit_message: Option<String>,
        phase_type: Option<String>,
        depends_on: Option<Vec<String>>,
    ) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id).await?;

        let max_idx: Option<i64> = sqlx::query_scalar(
            "SELECT MAX(order_index) FROM phases WHERE plan_id = ?",
        )
        .bind(plan_id)
        .fetch_one(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Failed to query phases: {e}"))?;

        let order_index = max_idx.map(|v| v + 1).unwrap_or(0);
        let complexity = complexity.unwrap_or(3) as i64;
        let phase_type = phase_type.unwrap_or_else(|| "value".to_string());
        let depends_on_json = depends_on.map(|d| serde_json::to_string(&d).unwrap_or_else(|_| "[]".to_string()));

        let id: i64 = sqlx::query_scalar(
            "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type, depends_on) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(plan_id)
        .bind(step_number)
        .bind(&title)
        .bind(complexity)
        .bind(&commit_message)
        .bind(&prompt)
        .bind(order_index)
        .bind(&phase_type)
        .bind(&depends_on_json)
        .fetch_one(&self.ctx.write_pool)
        .await
        .map_err(|e| format!("Failed to create phase: {e}"))?;

        Ok(format!(
            "Phase created with id={id}, title=\"{title}\", step={step_number}"
        ))
    }
}
