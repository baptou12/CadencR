use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct ReadPhaseTool {
    pub ctx: Arc<McpContext>,
}

#[derive(sqlx::FromRow)]
struct PhaseRow {
    id: i64,
    plan_id: i64,
    step_number: i64,
    title: String,
    status: String,
    complexity: Option<String>,
    commit_message: Option<String>,
    prompt: Option<String>,
    order_index: i64,
    implementation_notes: Option<String>,
    deviations: Option<String>,
    phase_type: Option<String>,
}

impl ReadPhaseTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, phase_id: i64) -> Result<String, String> {
        let p: PhaseRow = sqlx::query_as(
            "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE id = ?",
        )
        .bind(phase_id)
        .fetch_one(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Phase not found: {e}"))?;

        let mut out = format!(
            "# Phase: {}\n\n- **ID**: {}\n- **Plan ID**: {}\n- **Step**: {}\n- **Status**: {}\n- **Type**: {}\n- **Complexity**: {}\n- **Order Index**: {}\n",
            p.title,
            p.id,
            p.plan_id,
            p.step_number,
            p.status,
            p.phase_type.as_deref().unwrap_or("-"),
            p.complexity.as_deref().unwrap_or("-"),
            p.order_index,
        );

        if let Some(ref s) = p.commit_message {
            out.push_str(&format!("\n## Commit Message\n{s}\n"));
        }
        if let Some(ref s) = p.prompt {
            out.push_str(&format!("\n## Prompt\n{s}\n"));
        }
        if let Some(ref s) = p.implementation_notes {
            out.push_str(&format!("\n## Implementation Notes\n{s}\n"));
        }
        if let Some(ref s) = p.deviations {
            out.push_str(&format!("\n## Deviations\n{s}\n"));
        }

        Ok(out)
    }
}
