//! Service layer for the Git-tab graph view. Builds the set of tips to log
//! (`HEAD` plus the *local* target branch) and pages the commit graph.

use std::path::Path;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::host;
use crate::domain::git::models::{
    CommitGraphResponse, CommitUrlResponse, GetCommitGraphParams, GetCommitUrlParams,
};
use crate::domain::git::repository;
use crate::error::AppError;
use crate::shared::git_cli::run_git_background;

use super::{resolve_feature_git_path, SETTING_WORKTREE_BRANCH};

/// Map a resolved target ref to its *local* branch when one exists. The shared
/// `resolve_target_branch` fallback prefers `origin/<name>` (the remote tip),
/// but the graph view is explicitly a local comparison: if `origin/main` was
/// chosen yet a local `main` exists, we log against `main`. Picks already
/// pointing at a local branch pass through unchanged.
async fn prefer_local_target(repo: &Path, target: &str) -> String {
    if local_branch_exists(repo, target).await {
        return target.to_string();
    }
    // `<remote>/<name>` → try the bare `<name>` against the local branches.
    if let Ok(remotes) = run_git_background(&["remote"], repo).await {
        for remote in remotes.lines().map(str::trim).filter(|r| !r.is_empty()) {
            if let Some(local) = target.strip_prefix(&format!("{remote}/")) {
                if local_branch_exists(repo, local).await {
                    return local.to_string();
                }
            }
        }
    }
    target.to_string()
}

async fn local_branch_exists(repo: &Path, name: &str) -> bool {
    run_git_background(
        &["rev-parse", "--verify", &format!("refs/heads/{name}")],
        repo,
    )
    .await
    .is_ok()
}

pub async fn get_commit_graph(
    state: &AppState,
    params: GetCommitGraphParams,
) -> Result<CommitGraphResponse, AppError> {
    let git_path = match resolve_feature_git_path(state, params.feature_id).await? {
        Some(p) => p,
        None => return Ok(empty_graph()),
    };
    let path = Path::new(&git_path);

    let branch_setting = repository::get_feature_setting(
        &state.read_pool,
        params.feature_id,
        SETTING_WORKTREE_BRANCH,
    )
    .await?;
    let current_branch = match branch_setting {
        Some(b) => Some(b),
        None => commands::get_current_branch(path).await?,
    };

    // Same resolution as the status snapshot / commit-log so every Git-tab
    // surface compares against the same base, then mapped to its local branch.
    let resolved =
        crate::domain::git::workflow_service::resolve_target_branch(state, params.feature_id, path)
            .await
            .unwrap_or_else(|_| "main".to_string());
    let local_target = prefer_local_target(path, &resolved).await;

    // Tips: always HEAD; add the target when it's a distinct branch so the
    // graph shows both lines and their divergence point. Skip it when we're
    // sitting on the target (nothing extra to show) or it doesn't resolve.
    let mut tips = vec!["HEAD".to_string()];
    let on_target = current_branch.as_deref() == Some(local_target.as_str());
    let target_for_view = if !on_target && local_branch_exists(path, &local_target).await {
        tips.push(local_target.clone());
        Some(local_target)
    } else {
        None
    };

    // Fetch one extra row to detect whether more commits exist past this page.
    let fetched = commands::get_commit_graph(path, &tips, params.skip, params.limit + 1).await?;
    let has_more = fetched.len() as i64 > params.limit;
    let commits = fetched
        .into_iter()
        .take(params.limit.max(0) as usize)
        .collect();

    Ok(CommitGraphResponse {
        commits,
        has_more,
        current_branch,
        target_branch: target_for_view,
    })
}

/// Resolve the browser URL for a single commit on the feature's remote, so the
/// frontend's "open commit online" action can link out to GitHub/GitLab/etc.
pub async fn get_commit_url(
    state: &AppState,
    params: GetCommitUrlParams,
) -> Result<CommitUrlResponse, AppError> {
    let sha = params.sha.trim();
    let unavailable = CommitUrlResponse {
        url: String::new(),
        available: false,
    };
    if sha.is_empty() {
        return Ok(unavailable);
    }
    let git_path = match resolve_feature_git_path(state, params.feature_id).await? {
        Some(p) => p,
        None => return Ok(unavailable),
    };
    let url = run_git_background(
        &["config", "--get", "remote.origin.url"],
        Path::new(&git_path),
    )
    .await
    .ok();
    let commit_url = url
        .and_then(|u| host::detect_remote(u.trim()))
        .and_then(|info| host::commit_url(&info, sha));
    Ok(match commit_url {
        Some(url) => CommitUrlResponse {
            url,
            available: true,
        },
        None => unavailable,
    })
}

fn empty_graph() -> CommitGraphResponse {
    CommitGraphResponse {
        commits: vec![],
        has_more: false,
        current_branch: None,
        target_branch: None,
    }
}
