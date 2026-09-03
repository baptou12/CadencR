use super::super::audit::{elapsed_ms, record_tool_audit, ToolAudit};
use super::super::scope::SessionScope;
use crate::app_state::AppState;
use crate::error::AppError;

/// One schedule write, as the audit log sees it.
pub(super) struct ScheduleAuditEvent<'a> {
    pub tool_name: &'a str,
    pub status: &'a str,
    pub result_size_bytes: i64,
    pub error: Option<&'a str>,
    /// The schedule as it was before this write, as an undo payload. `None` on
    /// create and on run, which have nothing to restore.
    pub previous_value: Option<serde_json::Value>,
    pub started_at: std::time::Instant,
}

pub(super) async fn record_schedule_audit(
    state: &AppState,
    source: &SessionScope,
    event: ScheduleAuditEvent<'_>,
) -> Result<(), AppError> {
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: "cadencr-project",
            tool_name: event.tool_name,
            source_session_id: Some(source.session_id),
            source_feature_id: Some(source.feature_id),
            source_project_id: Some(source.project_id),
            // A schedule is not a session, and every schedule an agent can
            // reach fires inside its own project — so the project is the only
            // target coordinate there is.
            target_session_id: None,
            target_feature_id: None,
            target_project_id: Some(source.project_id),
            status: event.status,
            result_size_bytes: event.result_size_bytes,
            latency_ms: elapsed_ms(event.started_at),
            error: event.error,
            previous_value: event.previous_value,
        },
    )
    .await
}
