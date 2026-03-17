use std::sync::Arc;

use sqlx::sqlite::SqliteArguments;
use sqlx::Arguments;

use crate::domain::mcp::McpContext;
use super::helpers::verify_phase_ownership;

pub struct UpdatePhaseTool {
    pub ctx: Arc<McpContext>,
}

impl UpdatePhaseTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn call(
        &self,
        phase_id: i64,
        title: Option<String>,
        step_number: Option<i64>,
        complexity: Option<i8>,
        commit_message: Option<String>,
        prompt: Option<String>,
        phase_type: Option<String>,
    ) -> Result<String, String> {
        verify_phase_ownership(&self.ctx.read_pool, phase_id, self.ctx.feature_id).await?;

        // Verify phase exists and is draft
        let status: String = sqlx::query_scalar("SELECT status FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_one(&self.ctx.read_pool)
            .await
            .map_err(|_| format!("Phase {phase_id} not found"))?;

        if status != "draft" {
            return Err("Can only update draft phases".to_string());
        }

        let mut sets = Vec::new();
        let mut args = SqliteArguments::default();

        if let Some(v) = &title {
            sets.push("title = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = step_number {
            sets.push("step_number = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = complexity {
            sets.push("complexity = ?");
            args.add(v as i64).unwrap();
        }
        if let Some(v) = &commit_message {
            sets.push("commit_message = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = &prompt {
            sets.push("prompt = ?");
            args.add(v).unwrap();
        }
        if let Some(v) = &phase_type {
            sets.push("phase_type = ?");
            args.add(v).unwrap();
        }

        if sets.is_empty() {
            return Err("At least one field must be provided to update".to_string());
        }

        args.add(phase_id).unwrap();

        let sql = format!("UPDATE phases SET {} WHERE id = ?", sets.join(", "));
        sqlx::query_with(&sql, args)
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to update phase: {e}"))?;

        Ok(format!("Phase {phase_id} updated"))
    }
}
