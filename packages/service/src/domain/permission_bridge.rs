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

use crate::domain::agents::adapter::{RuntimeToolPermissionRequest, RuntimeToolPermissionResult};
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
            label: "Allow once".to_string(),
            description: "Approve this tool call only".to_string(),
            collect_feedback: false,
        },
        PermissionOptionPayload {
            decision: PermissionDecision::AllowFuture,
            label: "Allow for future use".to_string(),
            description: allow_future_description,
            collect_feedback: false,
        },
        PermissionOptionPayload {
            decision: PermissionDecision::Deny,
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

/// Wait for a user response on the permission channel, broadcast turn state
/// transitions, and apply the decision. Used after the caller has already
/// sent the appropriate WS envelope.
pub async fn wait_and_apply_decision(
    response_rx: &Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    tool_use_id: &str,
    original_input: serde_json::Value,
    pattern: &str,
    force_prompt: bool,
    worktree_path: &Path,
    session_cache: &Arc<Mutex<HashSet<String>>>,
    turn_state_tx: &tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    feature_id: i64,
) -> RuntimeToolPermissionResult {
    WsSessionPersistence::broadcast_turn_state(turn_state_tx, feature_id, "askUser");

    let mut rx = response_rx.lock().await;
    match rx.recv().await {
        Some(response) => {
            let decision = response.decision.clone();
            WsSessionPersistence::broadcast_turn_state(
                turn_state_tx,
                feature_id,
                turn_state_after_decision(decision.clone()),
            );
            let input = response.updated_input.unwrap_or(original_input);
            apply_decision(
                tool_use_id,
                pattern,
                force_prompt,
                worktree_path,
                session_cache,
                decision,
                response.feedback,
                input,
            )
            .await
        }
        None => RuntimeToolPermissionResult::Deny {
            message: "Permission channel closed".to_string(),
            interrupt: Some(false),
            tool_use_id: Some(tool_use_id.to_string()),
        },
    }
}

pub fn turn_state_after_decision(decision: PermissionDecision) -> &'static str {
    match decision {
        PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => "claude",
        PermissionDecision::Deny => "none",
    }
}

#[cfg(test)]
mod tests {
    use super::turn_state_after_decision;
    use crate::domain::ws_session::protocol::PermissionDecision;

    #[test]
    fn deny_decision_clears_turn_state() {
        assert_eq!(turn_state_after_decision(PermissionDecision::Deny), "none");
    }

    #[test]
    fn allow_decisions_resume_agent_turn_state() {
        assert_eq!(
            turn_state_after_decision(PermissionDecision::AllowOnce),
            "claude"
        );
        assert_eq!(
            turn_state_after_decision(PermissionDecision::AllowFuture),
            "claude"
        );
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
