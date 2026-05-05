//! `POST /api/git/merge` — merge the current feature branch into the
//! configured target branch, always using a local target branch.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::models::MergeResult;
use crate::domain::git::repository;
use crate::domain::git::service::resolve_feature_git_path;
use crate::domain::workspace;
use crate::error::AppError;
use crate::shared::git_cli::{run_git, run_git_safe_refs};

use super::{broadcast_after_write, resolve_target_branch};

const SETTING_GIT_MERGE_MODE: &str = "git_merge_mode";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MergeMode {
    Default,
    NoFf,
    FfOnly,
    Squash,
}

impl MergeMode {
    fn flags(self) -> &'static [&'static str] {
        match self {
            Self::Default => &["--no-edit"],
            Self::NoFf => &["--no-ff", "--no-edit"],
            Self::FfOnly => &["--ff-only"],
            Self::Squash => &["--squash"],
        }
    }

    fn as_setting(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::NoFf => "no_ff",
            Self::FfOnly => "ff_only",
            Self::Squash => "squash",
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeFeatureBranchBody {
    pub feature_id: i64,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub mode: Option<MergeMode>,
    #[serde(default)]
    pub save_as_default: bool,
}

pub async fn merge_feature_branch(
    state: &AppState,
    body: MergeFeatureBranchBody,
) -> Result<MergeResult, AppError> {
    let feature_id = body.feature_id;
    let mode = body.mode.unwrap_or(MergeMode::NoFf);
    let source_path = resolve_feature_git_path(state, feature_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("feature {feature_id} has no git path")))?;
    let source_repo = Path::new(&source_path);
    ensure_clean(source_repo, "source feature worktree").await?;

    let source_branch = commands::get_current_branch(source_repo)
        .await?
        .ok_or_else(|| AppError::BadRequest("source worktree is in detached HEAD".into()))?;
    let project_id = resolve_project_id(state, feature_id, body.project_id).await?;
    let project_path = repository::get_project_path(&state.read_pool, project_id).await?;
    let project_repo = Path::new(&project_path);
    let configured_target = resolve_target_branch(state, feature_id, source_repo).await?;
    let target_branch = ensure_local_target(project_repo, &configured_target).await?;

    if source_branch == target_branch {
        return Err(AppError::BadRequest(
            "source branch already matches target branch".into(),
        ));
    }

    let merge_repo = target_worktree_or_project(project_repo, &target_branch).await?;
    let result = run_merge(&merge_repo, &source_branch, &target_branch, mode).await?;
    if result.success {
        if body.save_as_default {
            workspace::service::set_setting(
                &state.write_pool,
                SETTING_GIT_MERGE_MODE,
                mode.as_setting(),
            )
            .await?;
        }
        broadcast_after_write(state, feature_id).await;
    }
    Ok(result)
}

async fn resolve_project_id(
    state: &AppState,
    feature_id: i64,
    explicit_project_id: Option<i64>,
) -> Result<i64, AppError> {
    if let Some(id) = explicit_project_id {
        return Ok(id);
    }
    repository::get_feature_type_and_project(&state.read_pool, feature_id)
        .await?
        .map(|(project_id, _)| project_id)
        .ok_or_else(|| AppError::NotFound(format!("feature not found: {feature_id}")))
}

async fn ensure_local_target(repo: &Path, target: &str) -> Result<String, AppError> {
    if target.trim().is_empty() || target.starts_with('-') {
        return Err(AppError::BadRequest("target branch is invalid".into()));
    }
    if local_branch_exists(repo, target).await {
        return Ok(target.to_string());
    }
    if remote_ref_exists(repo, target).await {
        let local = target
            .split_once('/')
            .map(|(_, branch)| branch)
            .filter(|branch| !branch.is_empty())
            .ok_or_else(|| AppError::BadRequest(format!("target branch is invalid: {target}")))?;
        if local_branch_exists(repo, local).await {
            return Ok(local.to_string());
        }
        run_git_safe_refs(&["branch"], &[], &[local, target], repo).await?;
        return Ok(local.to_string());
    }
    Err(AppError::BadRequest(format!(
        "target branch '{target}' does not resolve locally or as a remote-tracking ref"
    )))
}

async fn local_branch_exists(repo: &Path, branch: &str) -> bool {
    let refname = format!("refs/heads/{branch}");
    run_git_safe_refs(&["show-ref"], &["--verify", "--quiet"], &[&refname], repo)
        .await
        .is_ok()
}

async fn remote_ref_exists(repo: &Path, branch: &str) -> bool {
    let refname = format!("refs/remotes/{branch}");
    run_git_safe_refs(&["show-ref"], &["--verify", "--quiet"], &[&refname], repo)
        .await
        .is_ok()
}

async fn target_worktree_or_project(
    project_repo: &Path,
    target_branch: &str,
) -> Result<PathBuf, AppError> {
    let attached = commands::list_worktree_branches(project_repo)
        .await
        .unwrap_or_default();
    Ok(attached
        .get(target_branch)
        .cloned()
        .unwrap_or_else(|| project_repo.to_path_buf()))
}

async fn run_merge(
    repo: &Path,
    source_branch: &str,
    target_branch: &str,
    mode: MergeMode,
) -> Result<MergeResult, AppError> {
    ensure_clean(repo, "target branch worktree").await?;
    let original_branch = commands::get_current_branch(repo).await.ok().flatten();
    if original_branch.as_deref() != Some(target_branch) {
        run_git_safe_refs(&["checkout"], &[], &[target_branch], repo).await?;
    }

    let merge = run_git_safe_refs(&["merge"], mode.flags(), &[source_branch], repo).await;
    let result = match merge {
        Ok(_) => MergeResult {
            success: true,
            error: None,
        },
        Err(err) => {
            let _ = run_git(&["merge", "--abort"], repo).await;
            MergeResult {
                success: false,
                error: Some(err.to_string()),
            }
        }
    };

    if let Some(original) = original_branch {
        if original != target_branch {
            let _ = run_git_safe_refs(&["checkout"], &[], &[&original], repo).await;
        }
    }
    Ok(result)
}

async fn ensure_clean(repo: &Path, label: &str) -> Result<(), AppError> {
    if commands::has_uncommitted_changes(repo).await? {
        return Err(AppError::BadRequest(format!(
            "{label} has uncommitted changes"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        for args in [
            &["init", "-q"][..],
            &["config", "user.email", "test@example.com"][..],
            &["config", "user.name", "Test"][..],
            &["config", "commit.gpgsign", "false"][..],
            &["config", "tag.gpgsign", "false"][..],
        ] {
            run_git(args, repo).await.unwrap();
        }
        tokio::fs::write(repo.join("seed.txt"), "seed\n")
            .await
            .unwrap();
        run_git(&["add", "seed.txt"], repo).await.unwrap();
        run_git(&["commit", "-q", "-m", "seed"], repo)
            .await
            .unwrap();
        dir
    }

    #[tokio::test]
    async fn remote_tracking_target_creates_local_branch() {
        let dir = init_repo().await;
        let repo = dir.path();
        run_git(&["branch", "-M", "trunk"], repo).await.unwrap();
        let head = run_git(&["rev-parse", "HEAD"], repo).await.unwrap();
        run_git(
            &["update-ref", "refs/remotes/origin/main", head.trim()],
            repo,
        )
        .await
        .unwrap();

        let local = ensure_local_target(repo, "origin/main").await.unwrap();

        assert_eq!(local, "main");
        assert!(local_branch_exists(repo, "main").await);
    }

    #[tokio::test]
    async fn local_target_is_used_verbatim() {
        let dir = init_repo().await;
        let repo = dir.path();
        run_git(&["branch", "release"], repo).await.unwrap();

        let local = ensure_local_target(repo, "release").await.unwrap();

        assert_eq!(local, "release");
    }

    #[test]
    fn merge_mode_setting_values_match_api_payloads() {
        assert_eq!(MergeMode::Default.as_setting(), "default");
        assert_eq!(MergeMode::NoFf.as_setting(), "no_ff");
        assert_eq!(MergeMode::FfOnly.as_setting(), "ff_only");
        assert_eq!(MergeMode::Squash.as_setting(), "squash");
    }
}
