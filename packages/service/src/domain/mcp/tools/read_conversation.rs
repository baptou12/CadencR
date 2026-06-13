#![allow(dead_code)]

// Disabled in `cadencr-browser`; reserved for the future `cadencr-workspace`
// MCP server.

use std::sync::Arc;

use crate::domain::mcp::McpContext;

pub struct ReadConversationTool {
    pub ctx: Arc<McpContext>,
}

#[derive(sqlx::FromRow)]
struct MessageRow {
    role: String,
    content: Option<String>,
    tool_name: Option<String>,
}

impl ReadConversationTool {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    pub async fn call(
        &self,
        session_id: i64,
        offset: Option<i64>,
        limit: Option<i64>,
    ) -> Result<String, String> {
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);

        let rows: Vec<MessageRow> = sqlx::query_as(
            "SELECT role, content, tool_name FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
        )
        .bind(session_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.ctx.read_pool)
        .await
        .map_err(|e| format!("Failed to read conversation: {e}"))?;

        if rows.is_empty() {
            return Ok("No messages found.".to_string());
        }

        let mut out = String::new();
        for m in &rows {
            let tool_suffix = match &m.tool_name {
                Some(name) => format!(" [tool: {name}]"),
                None => String::new(),
            };
            let content = m.content.as_deref().unwrap_or("");
            out.push_str(&format!("**{}**{tool_suffix}: {content}\n\n", m.role));
        }

        Ok(out)
    }
}
