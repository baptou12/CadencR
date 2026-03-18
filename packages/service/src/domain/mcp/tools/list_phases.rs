use std::sync::Arc;

use crate::domain::mcp::McpContext;
use super::helpers::verify_plan_ownership;

pub struct ListPhasesTool {
    pub ctx: Arc<McpContext>,
}

#[derive(sqlx::FromRow)]
struct PhaseRow {
    id: i64,
    step_number: i64,
    title: String,
    status: String,
    phase_type: Option<String>,
    complexity: Option<String>,
    depends_on: Option<String>,
}

impl ListPhasesTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, plan_id: i64) -> Result<String, String> {
        verify_plan_ownership(&self.ctx.read_pool, plan_id, self.ctx.feature_id).await?;

        let phases: Vec<PhaseRow> = sqlx::query_as(
            "SELECT id, step_number, title, status, phase_type, complexity, depends_on FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch phases: {e}"))?;

        let mut out = String::from("| ID | Step | Title | Status | Type | Complexity | Dependencies |\n|-----|------|-------|--------|------|------------|---------------|\n");
        for p in &phases {
            let deps = p.depends_on.as_ref()
                .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                .map(|d| d.join(", "))
                .unwrap_or_else(|| "-".to_string());
            out.push_str(&format!(
                "| {} | {} | {} | {} | {} | {} | {} |\n",
                p.id,
                p.step_number,
                p.title,
                p.status,
                p.phase_type.as_deref().unwrap_or("-"),
                p.complexity.as_deref().unwrap_or("-"),
                deps,
            ));
        }

        Ok(out)
    }
}
