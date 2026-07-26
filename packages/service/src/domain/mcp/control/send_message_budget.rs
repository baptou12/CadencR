use super::super::scope::SessionScope;
use crate::app_state::AppState;
use crate::domain::mcp::send_message_tool::SendMessageTool;
use crate::error::AppError;

const MAX_SEND_MESSAGES_PER_SOURCE_PER_HOUR: i64 = 20;

pub(super) async fn ensure_send_budget(
    state: &AppState,
    source: &SessionScope,
    tool: SendMessageTool,
) -> Result<(), AppError> {
    let recent_send_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mcp_tool_audit_log
         WHERE tool_name IN (?, ?)
           AND source_session_id = ?
           AND status = 'ok'
           AND created_at >= datetime('now', '-1 hour')",
    )
    .bind(SendMessageTool::Project.tool_name())
    .bind(SendMessageTool::Workspace.tool_name())
    .bind(source.session_id)
    .fetch_one(&state.write_pool)
    .await?;
    if recent_send_count >= MAX_SEND_MESSAGES_PER_SOURCE_PER_HOUR {
        return Err(AppError::BadRequest(format!(
            "{} hourly limit exceeded for source session {}",
            tool.tool_name(),
            source.session_id
        )));
    }
    Ok(())
}
