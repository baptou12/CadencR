//! `project_cleanup_worktree`: remove a feature's git worktree through the safe
//! path only. There is no force flag anywhere in this file — a dirty worktree
//! or an unmerged branch is refused, never overridden. In `Default` access mode
//! the removal additionally waits on a human approval raised in the app.

use std::path::Path;

use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde::{Deserialize, Serialize};

#[path = "cleanup_worktree_gate.rs"]
mod gate;

use self::gate::{caller_access_mode, request_approval, Approval};
use super::audit::{elapsed_ms, record_tool_audit, result_size_bytes, ToolAudit};
use super::scope::{resolve_session_scope, SessionScope};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeAccessMode;
use crate::domain::git::models::{
    BranchDeleteCheckParams, DeleteWorktreeParams, HasUncommittedChangesParams, SuccessResponse,
};
use crate::domain::git::{repository, service as git_service};
use crate::error::AppError;

pub(super) const TOOL_NAME: &str = "project_cleanup_worktree";
const WORKTREE_PATH_SETTING: &str = "worktree_path";
/// The user answered "keep it". Reported as a successful call so the agent
/// states the outcome instead of retrying a refused deletion.
const DENIED: &str = "DENIED";
/// Nobody answered before the prompt expired. Also a success: the worktree is
/// simply still there.
const APPROVAL_TIMEOUT: &str = "APPROVAL_TIMEOUT";

#[derive(Debug, Deserialize)]
pub(super) struct CleanupWorktreeRequest {
    source_session_id: i64,
    feature_id: i64,
}

#[derive(Debug, Serialize)]
pub(super) struct CleanupWorktreeResponse {
    removed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    feedback: Option<String>,
}

/// What the removal destroyed, kept as the audit undo payload.
#[derive(Debug, Serialize)]
struct RemovedWorktree {
    worktree_path: String,
    branch: String,
    head_sha: Option<String>,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new().route(
        "/internal/mcp/project/cleanup-worktree",
        post(cleanup_worktree_handler),
    )
}

async fn cleanup_worktree_handler(
    State(state): State<AppState>,
    Json(body): Json<CleanupWorktreeRequest>,
) -> Result<Json<CleanupWorktreeResponse>, AppError> {
    let started_at = std::time::Instant::now();
    let caller = resolve_session_scope(&state.write_pool, body.source_session_id).await?;
    match cleanup(&state, &caller, body.feature_id).await {
        Ok((response, removed)) => {
            let audit = Audit {
                status: "ok",
                result_size_bytes: result_size_bytes(&response),
                error: None,
                previous_value: removed
                    .map(|removed| serde_json::to_value(removed))
                    .transpose()
                    .map_err(|error| AppError::Internal(error.to_string()))?,
            };
            record(&state, &caller, body.feature_id, audit, started_at).await?;
            Ok(Json(response))
        }
        Err(error) => {
            let audit = Audit {
                status: "error",
                result_size_bytes: 0,
                error: Some(error.to_string()),
                previous_value: None,
            };
            record(&state, &caller, body.feature_id, audit, started_at).await?;
            Err(error)
        }
    }
}

async fn cleanup(
    state: &AppState,
    caller: &SessionScope,
    feature_id: i64,
) -> Result<(CleanupWorktreeResponse, Option<RemovedWorktree>), AppError> {
    let worktree_path = target_worktree_path(state, caller, feature_id).await?;
    // Both refusals are checked before the mode branch, so the user is never
    // asked to approve a removal that would be refused anyway.
    let branch = ensure_removable(state, caller.project_id, feature_id).await?;

    if !matches!(
        caller_access_mode(state, caller.session_id).await,
        RuntimeAccessMode::FullAccess | RuntimeAccessMode::AutoReview
    ) {
        match request_approval(
            state,
            caller.session_id,
            caller.feature_id,
            &worktree_path,
            &branch,
        )
        .await
        {
            Approval::Approved => {}
            Approval::Denied(feedback) => return Ok((refused(DENIED, feedback), None)),
            Approval::TimedOut => return Ok((refused(APPROVAL_TIMEOUT, None), None)),
        }
    }

    let head_sha = head_sha(&worktree_path).await;
    remove(state, caller.project_id, feature_id).await?;
    Ok((
        CleanupWorktreeResponse {
            removed: true,
            reason: None,
            worktree_path: Some(worktree_path.clone()),
            branch: Some(branch.clone()),
            feedback: None,
        },
        Some(RemovedWorktree {
            worktree_path,
            branch,
            head_sha,
        }),
    ))
}

fn refused(reason: &'static str, feedback: Option<String>) -> CleanupWorktreeResponse {
    CleanupWorktreeResponse {
        removed: false,
        reason: Some(reason),
        worktree_path: None,
        branch: None,
        feedback,
    }
}

async fn target_worktree_path(
    state: &AppState,
    caller: &SessionScope,
    feature_id: i64,
) -> Result<String, AppError> {
    let project_id: Option<i64> =
        sqlx::query_scalar("SELECT project_id FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(&state.read_pool)
            .await?;
    if project_id != Some(caller.project_id) {
        return Err(AppError::NotFound(format!(
            "feature {feature_id} in the current project"
        )));
    }
    repository::get_feature_setting(&state.read_pool, feature_id, WORKTREE_PATH_SETTING)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("worktree for feature {feature_id}")))
}

/// The two hard refusals. Returns the branch name the checks resolved, which
/// the response and the audit snapshot both need.
async fn ensure_removable(
    state: &AppState,
    project_id: i64,
    feature_id: i64,
) -> Result<String, AppError> {
    let dirty = git_service::has_uncommitted_changes(
        state,
        HasUncommittedChangesParams {
            project_id,
            feature_id,
        },
    )
    .await?;
    if dirty.has_changes {
        return Err(AppError::coded(
            StatusCode::CONFLICT,
            "WORKTREE_DIRTY",
            "the worktree has uncommitted or untracked changes; commit or discard them first",
        ));
    }
    let check = git_service::check_branch_delete(
        state,
        BranchDeleteCheckParams {
            project_id,
            feature_id,
        },
    )
    .await?;
    if !check.merged {
        return Err(AppError::coded(
            StatusCode::CONFLICT,
            "BRANCH_NOT_MERGED",
            format!(
                "branch {} is not merged into {}; merge it first",
                check.branch, check.target_branch
            ),
        ));
    }
    Ok(check.branch)
}

async fn remove(state: &AppState, project_id: i64, feature_id: i64) -> Result<(), AppError> {
    let result = git_service::delete_worktree(
        state,
        DeleteWorktreeParams {
            project_id,
            feature_id,
            force: false,
        },
    )
    .await?;
    if result.success {
        return Ok(());
    }
    Err(removal_error(&result))
}

/// The safe delete reports refusals in-band. Re-raise them as coded errors, and
/// keep the dirty case on its own code even though it can only appear when the
/// worktree turned dirty between the pre-check and the removal.
fn removal_error(result: &SuccessResponse) -> AppError {
    let message = result
        .error
        .clone()
        .unwrap_or_else(|| "the worktree could not be removed".to_string());
    let code = match result.blocked_reason.as_deref() {
        Some("dirty_worktree") => "WORKTREE_DIRTY",
        _ => "WORKTREE_REMOVE_FAILED",
    };
    AppError::coded(StatusCode::CONFLICT, code, message)
}

/// Best effort: the sha is an audit convenience, not a precondition.
async fn head_sha(worktree_path: &str) -> Option<String> {
    crate::shared::git_cli::run_git(&["rev-parse", "HEAD"], Path::new(worktree_path))
        .await
        .ok()
        .map(|sha| sha.trim().to_string())
        .filter(|sha| !sha.is_empty())
}

struct Audit {
    status: &'static str,
    result_size_bytes: i64,
    error: Option<String>,
    previous_value: Option<serde_json::Value>,
}

async fn record(
    state: &AppState,
    caller: &SessionScope,
    feature_id: i64,
    audit: Audit,
    started_at: std::time::Instant,
) -> Result<(), AppError> {
    record_tool_audit(
        &state.write_pool,
        ToolAudit {
            server_name: "cadencr-project",
            tool_name: TOOL_NAME,
            source_session_id: Some(caller.session_id),
            source_feature_id: Some(caller.feature_id),
            source_project_id: Some(caller.project_id),
            target_session_id: None,
            target_feature_id: Some(feature_id),
            target_project_id: Some(caller.project_id),
            status: audit.status,
            result_size_bytes: audit.result_size_bytes,
            latency_ms: elapsed_ms(started_at),
            error: audit.error.as_deref(),
            previous_value: audit.previous_value,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocked(reason: &str, error: &str) -> SuccessResponse {
        SuccessResponse {
            success: false,
            error: Some(error.to_string()),
            blocked_reason: Some(reason.to_string()),
        }
    }

    #[test]
    fn an_in_band_dirty_refusal_keeps_its_own_code() {
        let error = removal_error(&blocked("dirty_worktree", "has uncommitted changes"));
        assert!(matches!(
            error,
            AppError::Coded {
                code: "WORKTREE_DIRTY",
                ..
            }
        ));
    }

    #[test]
    fn other_in_band_refusals_become_a_generic_removal_failure() {
        let error = removal_error(&blocked(
            "default_worktree",
            "Cannot remove the default worktree",
        ));
        assert!(matches!(
            error,
            AppError::Coded {
                code: "WORKTREE_REMOVE_FAILED",
                ..
            }
        ));
        assert_eq!(error.to_string(), "Cannot remove the default worktree");
    }

    #[test]
    fn a_refusal_response_carries_the_reason_and_never_claims_a_removal() {
        let denied = refused(DENIED, Some("still needed".to_string()));
        assert!(!denied.removed);
        let value = serde_json::to_value(&denied).unwrap();
        assert_eq!(value["reason"], "DENIED");
        assert_eq!(value["feedback"], "still needed");
        assert!(value.get("worktree_path").is_none());

        let timed_out = serde_json::to_value(refused(APPROVAL_TIMEOUT, None)).unwrap();
        assert_eq!(timed_out["reason"], "APPROVAL_TIMEOUT");
        assert!(timed_out.get("feedback").is_none());
    }

    #[tokio::test]
    async fn a_feature_outside_the_callers_project_is_not_found() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(
            "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL);
             INSERT INTO features (id, project_id) VALUES (99, 8);",
        )
        .execute(&pool)
        .await
        .unwrap();
        let state = AppState::with_pool(pool);
        let caller = SessionScope {
            session_id: 777,
            feature_id: 42,
            feature_title: "Source".to_string(),
            project_id: 7,
            status: "running".to_string(),
            pending_permission: None,
            pending_questions: None,
        };

        let error = target_worktree_path(&state, &caller, 99).await.unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
    }
}
