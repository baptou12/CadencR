use std::collections::HashSet;
use std::path::Path;

use futures::{stream, StreamExt};

use crate::app_state::AppState;
use crate::domain::git::host::{detect_origin_remote, RemoteInfo};
use crate::domain::git::service;
use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct FeatureForgeTarget {
    pub feature_id: i64,
    pub branch: Option<String>,
    pub remote: Option<RemoteInfo>,
    pub error: Option<String>,
}

pub async fn active_feature_targets(state: &AppState) -> Result<Vec<FeatureForgeTarget>, AppError> {
    let feature_ids =
        sqlx::query_scalar::<_, i64>("SELECT id FROM features WHERE status = 'active' ORDER BY id")
            .fetch_all(&state.read_pool)
            .await?;
    Ok(stream::iter(feature_ids)
        .map(|feature_id| resolve_feature_target(state, feature_id))
        .buffered(8)
        .collect()
        .await)
}

pub async fn resolve_feature_target(state: &AppState, feature_id: i64) -> FeatureForgeTarget {
    match try_resolve_feature_target(state, feature_id).await {
        Ok((branch, remote)) => FeatureForgeTarget {
            feature_id,
            branch,
            remote,
            error: None,
        },
        Err(error) => FeatureForgeTarget {
            feature_id,
            branch: None,
            remote: None,
            error: Some(error.to_string()),
        },
    }
}

pub async fn detected_project_remotes(state: &AppState) -> Result<Vec<RemoteInfo>, AppError> {
    let paths = sqlx::query_scalar::<_, String>("SELECT path FROM projects ORDER BY id")
        .fetch_all(&state.read_pool)
        .await?;
    let discovered = stream::iter(paths)
        .map(|path| async move { remote_for_path(Path::new(&path)).await })
        .buffered(8)
        .collect::<Vec<_>>()
        .await;
    let mut remotes = Vec::new();
    let mut seen = HashSet::new();
    for remote in discovered {
        let Some(remote) = remote else {
            continue;
        };
        let key = format!("{}:{}/{}", remote.hostname, remote.owner, remote.repo);
        if seen.insert(key) {
            remotes.push(remote);
        }
    }
    Ok(remotes)
}

async fn try_resolve_feature_target(
    state: &AppState,
    feature_id: i64,
) -> Result<(Option<String>, Option<RemoteInfo>), AppError> {
    let path = service::resolve_feature_git_path(state, feature_id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("No repository found for feature {feature_id}"))
        })?;
    // The branch the feature is *bound to*, not whatever the resolved
    // repository happens to have checked out: a feature whose worktree was
    // removed, or one created by the worktree-free "From branch" flow, both
    // resolve to the project directory, whose HEAD is usually the default
    // branch. Matching PRs against that would report the wrong proposal.
    let branch =
        service::resolve_feature_branch(&state.read_pool, feature_id, Path::new(&path)).await?;
    let remote = remote_for_path(Path::new(&path)).await;
    Ok((branch, remote))
}

async fn remote_for_path(path: &Path) -> Option<RemoteInfo> {
    detect_origin_remote(path).await
}
