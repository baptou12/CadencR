//! `project_stop_session` and its workspace twin `workspace_stop_session`:
//! gracefully interrupt another session's current turn. Interrupt-only — the
//! target keeps its runtime and stays resumable through
//! `project_send_session_message` / `workspace_send_session_message`.

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use super::audit::{elapsed_ms, record_tool_audit, result_size_bytes, ToolAudit};
use super::scope::{resolve_session_scope, SessionScope};
use super::steward::ensure_workspace_write_authority;
use crate::app_state::AppState;
use crate::domain::mcp::write_scope::WriteScope;
use crate::domain::ws_session::handler::{interrupt_session, InterruptOutcome};
use crate::error::AppError;

/// The target had no running turn. Not an error: a watchdog racing a turn end
/// is the normal case.
const SESSION_NOT_RUNNING: &str = "SESSION_NOT_RUNNING";

#[derive(Debug, Deserialize)]
pub(super) struct StopSessionRequest {
    source_session_id: i64,
    target_session_id: i64,
}

#[derive(Debug, Serialize)]
pub(super) struct StopSessionResponse {
    stopped: bool,
    #[serde(rename = "targetSessionId")]
    target_session_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

pub(super) async fn project_stop_session_handler(
    State(state): State<AppState>,
    Json(body): Json<StopSessionRequest>,
) -> Result<Json<StopSessionResponse>, AppError> {
    handle_stop_session(state, body, WriteScope::Project).await
}

/// One interrupt path for both scopes. Workspace scope trades the same-project
/// restriction on the target for the Steward grant on the source; both refusals
/// land in the audit log the same way.
pub(super) async fn handle_stop_session(
    state: AppState,
    body: StopSessionRequest,
    scope: WriteScope,
) -> Result<Json<StopSessionResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let source = resolve_session_scope(&state.write_pool, body.source_session_id).await?;
    let target = resolve_session_scope(&state.write_pool, body.target_session_id).await?;

    match stop_session(&state, &source, &target, scope).await {
        Ok(response) => {
            audit_stop_session(&state, &source, &target, &response, started_at, scope).await?;
            Ok(Json(response))
        }
        Err(error) => {
            audit_stop_session_error(
                &state,
                &source,
                &target,
                &error.to_string(),
                started_at,
                scope,
            )
            .await?;
            Err(error)
        }
    }
}

async fn stop_session(
    state: &AppState,
    source: &SessionScope,
    target: &SessionScope,
    scope: WriteScope,
) -> Result<StopSessionResponse, AppError> {
    if source.session_id == target.session_id {
        return Err(AppError::coded(
            StatusCode::BAD_REQUEST,
            "CANNOT_STOP_SELF",
            "a session cannot interrupt its own running turn",
        ));
    }
    if scope.allows_cross_project() {
        ensure_workspace_write_authority(&state.read_pool, source.feature_id).await?;
    } else if source.project_id != target.project_id {
        return Err(AppError::BadRequest(
            "target session does not belong to current project".to_string(),
        ));
    }

    // No connection of our own owns the target, so pass the map holding
    // MCP-started turns; anything driven by a WebSocket resolves through the
    // global owner registry instead.
    let outcome = interrupt_session(state, &state.mcp_control_sessions, target.session_id)
        .await
        .map_err(|error| AppError::coded(StatusCode::CONFLICT, "INTERRUPT_FAILED", error))?;
    let stopped = matches!(
        outcome,
        InterruptOutcome::Interrupted | InterruptOutcome::ShellRunCancelled
    );
    Ok(StopSessionResponse {
        stopped,
        target_session_id: target.session_id,
        reason: (!stopped).then_some(SESSION_NOT_RUNNING),
    })
}

async fn audit_stop_session(
    state: &AppState,
    source: &SessionScope,
    target: &SessionScope,
    response: &StopSessionResponse,
    started_at: std::time::Instant,
    scope: WriteScope,
) -> Result<(), AppError> {
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: scope.server_name(),
            tool_name: scope.stop_session_tool(),
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
            // Only a turn that was actually running can be restarted, so that
            // is the one case with something to undo.
            previous_value: response
                .stopped
                .then(|| serde_json::json!({ "status": "running" })),
        },
    )
    .await
}

async fn audit_stop_session_error(
    state: &AppState,
    source: &SessionScope,
    target: &SessionScope,
    error: &str,
    started_at: std::time::Instant,
    scope: WriteScope,
) -> Result<(), AppError> {
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: scope.server_name(),
            tool_name: scope.stop_session_tool(),
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
