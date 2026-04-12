//! Shared permission bridge logic for routing tool-permission requests
//! through WebSocket to the frontend and awaiting user responses.
//!
//! Used by both the workflow engine (`WorkflowPermissionBridge`) and
//! the session handler (`WsBridgeCanUseTool`).

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error};

use crate::domain::agents::adapter::{RuntimeToolPermissionRequest, RuntimeToolPermissionResult};
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::permissions::{self, ResolvedPermission};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::PermissionDecision;

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
            WsSessionPersistence::broadcast_turn_state(turn_state_tx, feature_id, "claude");
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
        None => RuntimeToolPermissionResult::Deny {
            message: "Permission channel closed".to_string(),
            interrupt: Some(false),
            tool_use_id: Some(tool_use_id.to_string()),
        },
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
