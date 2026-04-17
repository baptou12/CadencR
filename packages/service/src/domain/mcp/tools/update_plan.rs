use std::sync::Arc;

use sqlx::sqlite::SqliteArguments;
use sqlx::Arguments;

use super::helpers::verify_plan_ownership;
use crate::domain::mcp::McpContext;

pub struct UpdatePlanTool {
    pub ctx: Arc<McpContext>,
}

impl UpdatePlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(
        &self,
        plan_id: i64,
        title: Option<String>,
        summary: Option<String>,
        context: Option<String>,
        clarifications: Option<String>,
        completion_conditions: Option<String>,
    ) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id()).await?;

        let mut sets = Vec::new();
        let mut args = SqliteArguments::default();

        if let Some(v) = &title {
            sets.push("title = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = &summary {
            sets.push("summary = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = &context {
            sets.push("context = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = &clarifications {
            sets.push("clarifications = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = &completion_conditions {
            sets.push("completion_conditions = ?");
            args.add(v).unwrap();
        }

        if sets.is_empty() {
            return Err("At least one field must be provided to update".to_string());
        }

        sets.push("updated_at = datetime('now')");
        args.add(plan_id).unwrap();

        let sql = format!("UPDATE plans SET {} WHERE id = ?", sets.join(", "));
        sqlx::query_with(&sql, args)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to update plan: {e}"))?;

        Ok("Plan updated".to_string())
    }
}
