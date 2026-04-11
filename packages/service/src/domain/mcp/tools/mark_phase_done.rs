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
        verify_phase_ownership(&self.ctx.read_pool, phase_id, self.ctx.feature_id).await?;

        sqlx::query("UPDATE phases SET status = 'done', implementation_notes = ?, deviations = ? WHERE id = ?")
            .bind(&implementation_notes)
            .bind(&deviations)
            .bind(phase_id)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to mark phase done: {e}"))?;

        // Signal the done channel so the workflow engine knows this item completed
        let mut guard = self.ctx.done_sender.lock().await;
        if let Some(sender) = guard.take() {
            let _ = sender.send(Some(format!("Phase {phase_id} done")));
        }

        Ok(format!("Phase {phase_id} marked as done"))
    }
}
