//! Shared permission bridge logic for routing tool-permission requests
//! through WebSocket to the frontend and awaiting user responses.
//!
//! Used by both the workflow engine (`WorkflowPermissionBridge`) and
//! the session handler (`WsBridgeCanUseTool`).

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error};

use crate::domain::agents::adapter::{
    RuntimePermissionResponseKind, RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};
use crate::domain::session_status::AgentStatus;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::permissions::{self, ResolvedPermission};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{PermissionDecision, PermissionOptionPayload};

/// Result of server-side permission resolution with pattern checks applied.
pub enum ResolvedAction {
    /// Already resolved — return this result directly.
    Resolved(RuntimeToolPermissionResult),
    /// Needs user prompt — caller should send a WS envelope and call
    /// `wait_and_apply_decision` with the response.
    NeedsPrompt {
        description: String,
        pattern: String,
        force_prompt: bool,
    },
}

pub fn build_default_permission_options(pattern: Option<&str>) -> Vec<PermissionOptionPayload> {
    let allow_future_description = pattern.map_or_else(
        || "Save this permission for future use".to_string(),
        |value| format!("Save `{value}` to settings"),
    );

    vec![
        PermissionOptionPayload {
            decision: PermissionDecision::AllowOnce,
            option_id: None,
            label: "Allow once".to_string(),
            description: "Approve this tool call only".to_string(),
            collect_feedback: false,
        },
        PermissionOptionPayload {
            decision: PermissionDecision::AllowFuture,
            option_id: None,
            label: "Allow for future use".to_string(),
            description: allow_future_description,
            collect_feedback: false,
        },
        PermissionOptionPayload {
            decision: PermissionDecision::Deny,
            option_id: None,
            label: "Deny".to_string(),
            description: "Reject this tool call".to_string(),
            collect_feedback: true,
        },
    ]
}

pub fn extract_permission_preview(input: &Value) -> Option<String> {
    [
        "command",
        "file_path",
        "filepath",
        "path",
        "filePath",
        "directory",
        "dir",
        "cwd",
        "target",
        "destination",
        "source",
    ]
    .iter()
    .find_map(|key| input.get(*key).and_then(Value::as_str))
    .map(ToOwned::to_owned)
    .or_else(|| extract_preview_from_nested_object(input.get("args")))
    .or_else(|| {
        input.get("metadata").and_then(|metadata| {
            [
                "command",
                "path",
                "file_path",
                "filepath",
                "filePath",
                "directory",
                "dir",
                "cwd",
                "target",
                "destination",
                "source",
            ]
            .iter()
            .find_map(|key| metadata.get(*key).and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .or_else(|| extract_preview_from_nested_object(metadata.get("args")))
        })
    })
    .or_else(|| {
        input
            .get("always")
            .and_then(Value::as_array)
            .and_then(|items| items.iter().find_map(Value::as_str))
            .map(ToOwned::to_owned)
    })
    .or_else(|| {
        input
            .get("patterns")
            .and_then(Value::as_array)
            .and_then(|patterns| patterns.iter().find_map(Value::as_str))
            .map(ToOwned::to_owned)
    })
}

fn extract_preview_from_nested_object(value: Option<&Value>) -> Option<String> {
    value.and_then(|object| {
        [
            "command",
            "path",
            "file_path",
            "filepath",
            "filePath",
            "directory",
            "dir",
            "cwd",
            "target",
            "destination",
            "source",
        ]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(ToOwned::to_owned)
    })
}

/// Resolve a permission request server-side, checking the session cache
/// and allowed patterns. Returns `NeedsPrompt` if user interaction is needed.
pub async fn resolve_permission_check(
    request: &RuntimeToolPermissionRequest,
    worktree_path: &Path,
    session_cache: &Arc<Mutex<HashSet<String>>>,
    allowed_patterns: &Arc<HashSet<String>>,
) -> ResolvedAction {
    let force_prompt = permissions::FRONTEND_PROMPT_TOOLS.contains(&request.tool_name.as_str());

    let cache = session_cache.lock().await;
    let resolved =
        permissions::resolve_permission(&request.tool_name, &request.input, worktree_path, &cache);
    drop(cache);

    match resolved {
        ResolvedPermission::Allow => {
            debug!(tool_name = %request.tool_name, "auto-allowed");
            ResolvedAction::Resolved(RuntimeToolPermissionResult::Allow {
                updated_input: request.input.clone(),
                updated_permissions: None,
                tool_use_id: Some(request.tool_use_id.clone()),
            })
        }
        ResolvedPermission::Deny { reason } => {
            debug!(tool_name = %request.tool_name, reason = %reason, "auto-denied");
            ResolvedAction::Resolved(RuntimeToolPermissionResult::Deny {
                message: reason,
                interrupt: Some(false),
                tool_use_id: Some(request.tool_use_id.clone()),
            })
        }
        ResolvedPermission::NeedsPrompt {
            description,
            pattern,
        } => {
            // Check allowed_patterns from settings files
            if !force_prompt && allowed_patterns.contains(&pattern) {
                debug!(tool_name = %request.tool_name, pattern = %pattern, "allowed by settings pattern");
                session_cache.lock().await.insert(pattern);
                return ResolvedAction::Resolved(RuntimeToolPermissionResult::Allow {
                    updated_input: request.input.clone(),
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id.clone()),
                });
            }
            ResolvedAction::NeedsPrompt {
                description,
                pattern,
                force_prompt,
            }
        }
    }
}

/// Wait for a user response on the permission channel, clear the DB gate +
/// broadcast the next turn, and apply the decision.
///
/// Preconditions: the caller has already
/// - persisted the pending-input row via
///   [`WsSessionPersistence::mark_awaiting_user_static`] (which both wrote the
///   `pending_*` column and broadcast `"askUser"`), and
/// - sent the matching `permission.request` WS envelope to the client.
///
/// On response this function calls
/// [`WsSessionPersistence::mark_agent_resumed_static`] which NULLs the given
/// column *before* broadcasting the terminal turn (`"agent"` / `"none"`),
/// closing the lag-recovery race where a snapshot re-read resurrected
/// `"askUser"` from a row that had already been answered.
#[allow(clippy::too_many_arguments)]
pub async fn wait_and_apply_decision(
    response_rx: &Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    tool_use_id: &str,
    original_input: serde_json::Value,
    pattern: &str,
    force_prompt: bool,
    worktree_path: &Path,
    session_cache: &Arc<Mutex<HashSet<String>>>,
    session_status_tx: &crate::domain::session_status::SessionStatusBroadcaster,
    feature_id: i64,
    write_pool: &sqlx::SqlitePool,
    db_session_id: i64,
    clear_kind: crate::domain::ws_session::persistence::PendingUserInputKind,
) -> RuntimeToolPermissionResult {
    let mut rx = response_rx.lock().await;
    match rx.recv().await {
        Some(response) => {
            // Claude Code keeps streaming after `can_use_tool` returns Deny
            // with `interrupt: false`, so the turn stays on the agent until a
            // real Result arrives. Broadcasting Idle here would flip the
            // sidebar while the CLI is still working.
            WsSessionPersistence::mark_agent_resumed_static(
                write_pool,
                session_status_tx,
                db_session_id,
                feature_id,
                clear_kind,
                AgentStatus::Agent,
            )
            .await;
            let input = response.updated_input.unwrap_or(original_input);
            apply_decision(
                tool_use_id,
                pattern,
                force_prompt,
                worktree_path,
                session_cache,
                response.decision,
                response.feedback,
                input,
            )
            .await
        }
        None => {
            // Channel closed before we got a response. Clear the DB gate AND
            // broadcast Idle so any connected client still showing Question
            // drops back to idle — otherwise the sidebar stays stuck even
            // after the gate is gone from the DB.
            WsSessionPersistence::mark_agent_resumed_static(
                write_pool,
                session_status_tx,
                db_session_id,
                feature_id,
                clear_kind,
                AgentStatus::Idle,
            )
            .await;
            RuntimeToolPermissionResult::Deny {
                message: "Permission channel closed".to_string(),
                interrupt: Some(false),
                tool_use_id: Some(tool_use_id.to_string()),
            }
        }
    }
}

/// Status broadcast on the direct-SDK response path (OpenCode per-tool
/// perms, AskUserQuestion). Deny ends the turn here because the caller
/// explicitly emits `session.ended` alongside this broadcast.
pub fn status_after_decision(decision: PermissionDecision) -> AgentStatus {
    match decision {
        PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => AgentStatus::Agent,
        PermissionDecision::Deny => AgentStatus::Idle,
    }
}

pub fn status_after_approval(decision: PermissionDecision, feedback: Option<&str>) -> AgentStatus {
    match decision {
        PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => AgentStatus::Agent,
        PermissionDecision::Deny => {
            let has_feedback = feedback.is_some_and(|f| !f.trim().is_empty());
            if has_feedback {
                AgentStatus::Agent
            } else {
                AgentStatus::Idle
            }
        }
    }
}

pub fn status_after_runtime_permission(
    kind: RuntimePermissionResponseKind,
    decision: PermissionDecision,
    feedback: Option<&str>,
) -> AgentStatus {
    match kind {
        RuntimePermissionResponseKind::PlanApproval => status_after_approval(decision, feedback),
        RuntimePermissionResponseKind::ContinueOnDeny
            if matches!(decision, PermissionDecision::Deny) =>
        {
            AgentStatus::Agent
        }
        RuntimePermissionResponseKind::ContinueOnDeny | RuntimePermissionResponseKind::Normal => {
            status_after_decision(decision)
        }
    }
}

pub fn runtime_permission_denial_completes_session(
    kind: RuntimePermissionResponseKind,
    decision: PermissionDecision,
    feedback: Option<&str>,
) -> bool {
    matches!(decision, PermissionDecision::Deny)
        && !matches!(kind, RuntimePermissionResponseKind::PlanApproval)
        && status_after_runtime_permission(kind, decision, feedback) == AgentStatus::Idle
}

#[cfg(test)]
mod tests {
    use super::{
        runtime_permission_denial_completes_session, status_after_approval, status_after_decision,
        status_after_runtime_permission,
    };
    use crate::domain::agents::adapter::RuntimePermissionResponseKind;
    use crate::domain::session_status::AgentStatus;
    use crate::domain::ws_session::protocol::PermissionDecision;

    #[test]
    fn deny_decision_ends_turn_on_direct_sdk_path() {
        assert_eq!(
            status_after_decision(PermissionDecision::Deny),
            AgentStatus::Idle
        );
    }

    #[test]
    fn allow_decisions_resume_agent_status() {
        assert_eq!(
            status_after_decision(PermissionDecision::AllowOnce),
            AgentStatus::Agent
        );
        assert_eq!(
            status_after_decision(PermissionDecision::AllowFuture),
            AgentStatus::Agent
        );
    }

    #[test]
    fn approval_deny_without_feedback_ends_turn() {
        assert_eq!(
            status_after_approval(PermissionDecision::Deny, None),
            AgentStatus::Idle,
        );
        assert_eq!(
            status_after_approval(PermissionDecision::Deny, Some("")),
            AgentStatus::Idle,
        );
        assert_eq!(
            status_after_approval(PermissionDecision::Deny, Some("   ")),
            AgentStatus::Idle,
        );
    }

    #[test]
    fn approval_deny_with_feedback_hands_turn_back_to_agent() {
        assert_eq!(
            status_after_approval(PermissionDecision::Deny, Some("not quite, try X")),
            AgentStatus::Agent,
        );
    }

    #[test]
    fn approval_allow_always_resumes_agent() {
        assert_eq!(
            status_after_approval(PermissionDecision::AllowOnce, None),
            AgentStatus::Agent,
        );
        assert_eq!(
            status_after_approval(PermissionDecision::AllowFuture, Some("extra note")),
            AgentStatus::Agent,
        );
    }

    #[test]
    fn runtime_permission_continue_on_deny_hands_turn_back_to_agent() {
        assert_eq!(
            status_after_runtime_permission(
                RuntimePermissionResponseKind::ContinueOnDeny,
                PermissionDecision::Deny,
                None,
            ),
            AgentStatus::Agent,
        );
    }

    #[test]
    fn runtime_permission_completion_uses_central_status_policy() {
        assert!(runtime_permission_denial_completes_session(
            RuntimePermissionResponseKind::Normal,
            PermissionDecision::Deny,
            None,
        ));
        assert!(!runtime_permission_denial_completes_session(
            RuntimePermissionResponseKind::ContinueOnDeny,
            PermissionDecision::Deny,
            None,
        ));
    }
}

/// Apply a user's permission decision (AllowOnce/AllowFuture/Deny).
async fn apply_decision(
    tool_use_id: &str,
    pattern: &str,
    force_prompt: bool,
    worktree_path: &Path,
    session_cache: &Arc<Mutex<HashSet<String>>>,
    decision: PermissionDecision,
    feedback: Option<String>,
    input: serde_json::Value,
) -> RuntimeToolPermissionResult {
    match decision {
        PermissionDecision::AllowOnce => {
            if !force_prompt {
                session_cache.lock().await.insert(pattern.to_string());
            }
            RuntimeToolPermissionResult::Allow {
                updated_input: input,
                updated_permissions: None,
                tool_use_id: Some(tool_use_id.to_string()),
            }
        }
        PermissionDecision::AllowFuture => {
            session_cache.lock().await.insert(pattern.to_string());
            if let Err(e) = permissions::append_to_settings_local(worktree_path, pattern) {
                error!(error = %e, "failed to persist permission to settings.local.json");
            }
            RuntimeToolPermissionResult::Allow {
                updated_input: input,
                updated_permissions: None,
                tool_use_id: Some(tool_use_id.to_string()),
            }
        }
        PermissionDecision::Deny => {
            let message = feedback.unwrap_or_else(|| "User denied permission".to_string());
            RuntimeToolPermissionResult::Deny {
                message,
                interrupt: Some(false),
                tool_use_id: Some(tool_use_id.to_string()),
            }
        }
    }
}

/// Wait for a user response on the permission channel and convert an
/// allow/deny into a `PermissionResult`. Used for approval gates
/// (show_plan, show_prd, ExitPlanMode) that bypass normal resolution.
pub async fn wait_for_approval(
    response_rx: &Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    tool_use_id: &str,
    input: serde_json::Value,
    deny_message: &str,
) -> RuntimeToolPermissionResult {
    let mut rx = response_rx.lock().await;
    match rx.recv().await {
        Some(response) => match response.decision {
            PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => {
                RuntimeToolPermissionResult::Allow {
                    updated_input: input,
                    updated_permissions: None,
                    tool_use_id: Some(tool_use_id.to_string()),
                }
            }
            PermissionDecision::Deny => {
                let feedback = response
                    .feedback
                    .unwrap_or_else(|| deny_message.to_string());
                RuntimeToolPermissionResult::Deny {
                    message: feedback,
                    interrupt: Some(false),
                    tool_use_id: Some(tool_use_id.to_string()),
                }
            }
        },
        None => RuntimeToolPermissionResult::Deny {
            message: "Approval channel closed".to_string(),
            interrupt: Some(false),
            tool_use_id: Some(tool_use_id.to_string()),
        },
    }
}
