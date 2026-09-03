use super::super::audit::{elapsed_ms, record_tool_audit, result_size_bytes, ToolAudit};
use super::super::scope::SessionScope;
use super::SendMessageResponse;
use crate::app_state::AppState;
use crate::domain::mcp::send_message_tool::SendMessageTool;
use crate::error::AppError;

pub(super) async fn audit_send_message(
    state: &AppState,
    source: &SessionScope,
    target: &SessionScope,
    tool: SendMessageTool,
    response: &SendMessageResponse,
    started_at: std::time::Instant,
) -> Result<(), AppError> {
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: tool.server_name(),
            tool_name: tool.tool_name(),
            source_session_id: Some(source.session_id),
            source_feature_id: Some(source.feature_id),
            source_project_id: Some(source.project_id),
            target_session_id: Some(target.session_id),
            target_feature_id: Some(target.feature_id),
            target_project_id: Some(target.project_id),
            status: "ok",
            result_size_bytes: result_size_bytes(response),
            latency_ms: elapsed_ms(started_at),
            error: None,
            previous_value: None,
        },
    )
    .await
}

pub(super) async fn audit_send_message_error(
    state: &AppState,
    source: &SessionScope,
    target: &SessionScope,
    tool: SendMessageTool,
    error: &str,
    started_at: std::time::Instant,
) -> Result<(), AppError> {
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: tool.server_name(),
            tool_name: tool.tool_name(),
            source_session_id: Some(source.session_id),
            source_feature_id: Some(source.feature_id),
            source_project_id: Some(source.project_id),
            target_session_id: Some(target.session_id),
            target_feature_id: Some(target.feature_id),
            target_project_id: Some(target.project_id),
            status: "error",
            result_size_bytes: 0,
            latency_ms: elapsed_ms(started_at),
            error: Some(error),
            previous_value: None,
        },
    )
    .await
}
