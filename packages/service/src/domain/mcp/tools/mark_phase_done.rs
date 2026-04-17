use std::sync::Arc;

use super::helpers::verify_phase_ownership;
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
        verify_phase_ownership(&self.ctx.read_pool, phase_id, self.ctx.feature_id()).await?;

        sqlx::query("UPDATE phases SET status = 'done', implementation_notes = ?, deviations = ? WHERE id = ?")
            .bind(&implementation_notes)
            .bind(&deviations)
            .bind(phase_id)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to mark phase done: {e}"))?;

        // Workflow-layer completion detection watches the tool-use stream — see
        // stream_reader::live_refresh::is_completion_tool.
        Ok(format!("Phase {phase_id} marked as done"))
    }
}
