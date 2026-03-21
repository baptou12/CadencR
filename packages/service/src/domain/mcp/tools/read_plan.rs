use std::sync::Arc;

use crate::domain::mcp::McpContext;
use super::helpers::verify_plan_ownership;

pub struct ReadPlanTool {
    pub ctx: Arc<McpContext>,
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct PlanRow {
    id: i64,
    feature_id: i64,
    title: String,
    status: String,
    summary: Option<String>,
    context: Option<String>,
    clarifications: Option<String>,
    completion_conditions: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(sqlx::FromRow)]
#[allow(dead_code)]
struct PhaseRow {
    id: i64,
    step_number: i64,
    title: String,
    status: String,
    phase_type: Option<String>,
    complexity: Option<i64>,
}

impl ReadPlanTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id).await?;

        let plan: PlanRow = sqlx::query_as(
            "SELECT id, feature_id, title, status, summary, context, clarifications, completion_conditions, created_at, updated_at FROM plans WHERE id = ?"
        )
        .bind(plan_id)
        .fetch_one(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Plan not found: {e}"))?;

        let phases: Vec<PhaseRow> = sqlx::query_as(
            "SELECT id, step_number, title, status, phase_type, complexity FROM phases WHERE plan_id = ? ORDER BY step_number, order_index"
        )
        .bind(plan_id)
        .fetch_all(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch phases: {e}"))?;

        let mut out = format!("# Plan: {}\nStatus: {}\n", plan.title, plan.status);

        if let Some(ref s) = plan.summary {
            out.push_str(&format!("\n## Summary\n{s}\n"));
        }
        if let Some(ref s) = plan.context {
            out.push_str(&format!("\n## Context\n{s}\n"));
        }
        if let Some(ref s) = plan.clarifications {
            out.push_str(&format!("\n## Clarifications\n{s}\n"));
        }
        if let Some(ref s) = plan.completion_conditions {
            out.push_str(&format!("\n## Completion Conditions\n{s}\n"));
        }

        out.push_str("\n## Phases\n| Step | Title | Type | Complexity | Status |\n|------|-------|------|------------|--------|\n");
        for p in &phases {
            out.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                p.step_number,
                p.title,
                p.phase_type.as_deref().unwrap_or("-"),
                p.complexity.map(|c| c.to_string()).as_deref().unwrap_or("-"),
                p.status,
            ));
        }

        Ok(out)
    }
}
