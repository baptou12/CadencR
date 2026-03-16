use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct MarkPhaseDoneTool {
    pub ctx: Arc<McpContext>,
}

impl MarkPhaseDoneTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(
        &self,
        phase_id: i64,
        implementation_notes: Option<String>,
        deviations: Option<String>,
    ) -> Result<String, String> {
        sqlx::query("UPDATE phases SET status = 'done', implementation_notes = ?, deviations = ? WHERE id = ?")
            .bind(&implementation_notes)
            .bind(&deviations)
            .bind(phase_id)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to mark phase done: {e}"))?;

        Ok(format!("Phase {phase_id} marked as done"))
    }
}
