use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct EditPrdTool {
    pub ctx: Arc<McpContext>,
}

impl EditPrdTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(&self, old_string: &str, new_string: &str) -> Result<String, String> {
        let row: (Option<String>,) = sqlx::query_as("SELECT prd FROM features WHERE id = ?")
            .bind(self.ctx.feature_id())
            .fetch_one(&self.ctx.read_pool)
            .await
            .map_err(|e| format!("Feature not found: {e}"))?;

        let prd = row
            .0
            .ok_or_else(|| "No PRD found for this feature".to_string())?;

        if !prd.contains(old_string) {
            return Err("old_string not found in PRD".to_string());
        }

        let updated = prd.replacen(old_string, new_string, 1);

        sqlx::query("UPDATE features SET prd = ? WHERE id = ?")
            .bind(&updated)
            .bind(self.ctx.feature_id())
            .execute(&self.ctx.write_pool)
            .await
            .map_err(|e| format!("Failed to update PRD: {e}"))?;

        Ok("PRD updated".to_string())
    }
}
