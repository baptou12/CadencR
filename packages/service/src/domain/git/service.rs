use std::path::Path;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::models::*;
use crate::domain::git::repository;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Feature-setting key constants
// ---------------------------------------------------------------------------

const SETTING_WORKTREE_PATH: &str = "worktree_path";
const SETTING_WORKTREE_BRANCH: &str = "worktree_branch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve the git directory for a feature.
/// Non-session features use worktree_path if available, otherwise project path.
pub async fn resolve_feature_git_path(
    state: &AppState,
    feature_id: i64,
) -> Result<Option<String>, AppError> {
    let row = repository::get_feature_type_and_project(&state.read_pool, feature_id).await?;

    let (project_id, feature_type) = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    if feature_type != "ws-session" {
        let wt = repository::get_feature_setting(&state.read_pool, feature_id, SETTING_WORKTREE_PATH).await?;
        if let Some(path) = wt {
            return Ok(Some(path));
        }
    }

    match repository::get_project_path(&state.read_pool, project_id).await {
        Ok(p) => Ok(Some(p)),
        Err(_) => Ok(None),
    }
}

/// Helper to get project path + worktree branch for merge/conflict/delete operations.
async fn get_project_and_branch(
    state: &AppState,
    project_id: i64,
    feature_id: i64,
) -> Result<(String, String), AppError> {
    let project_path = repository::get_project_path(&state.read_pool, project_id).await?;
    let branch = repository::get_feature_setting(&state.read_pool, feature_id, SETTING_WORKTREE_BRANCH)
        .await?
        .ok_or_else(|| AppError::NotFound("No worktree branch found for this feature".into()))?;
    Ok((project_path, branch))
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

pub async fn get_branch(
    state: &AppState,
    params: GetBranchParams,
) -> Result<BranchResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let branch = commands::get_current_branch(Path::new(&project_path)).await?;
    Ok(BranchResponse { branch })
}

pub async fn get_stats(
    state: &AppState,
    params: GetStatsParams,
) -> Result<GitStats, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(GitStats { files_changed: 0, insertions: 0, deletions: 0 }),
    };
    commands::get_stats(Path::new(&git_path), &params.mode, params.target_branch.as_deref()).await
}

pub async fn get_diff(
    state: &AppState,
    params: GetDiffParams,
) -> Result<DiffResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(DiffResponse { diff: String::new() }),
    };

    let diff = if let Some(ref commit_sha) = params.commit_sha {
        commands::get_commit_diff(Path::new(&git_path), commit_sha).await?
    } else {
        commands::get_diff(Path::new(&git_path), &params.mode, params.target_branch.as_deref()).await?
    };
    Ok(DiffResponse { diff })
}

pub async fn get_changed_files(
    state: &AppState,
    params: GetChangedFilesParams,
) -> Result<Vec<ChangedFile>, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    commands::get_changed_files(Path::new(&git_path), &params.mode, params.target_branch.as_deref()).await
}

pub async fn get_file_content(
    state: &AppState,
    params: GetFileContentParams,
) -> Result<FileContent, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(FileContent { old_content: None, new_content: None }),
    };
    let path = Path::new(&git_path);

    if let Some(ref commit_sha) = params.commit_sha {
        let parent = format!("{commit_sha}^");
        let (old_content, new_content) = tokio::join!(
            commands::get_file_content(path, &params.file_path, Some(&parent)),
            commands::get_file_content(path, &params.file_path, Some(commit_sha)),
        );
        return Ok(FileContent { old_content: Some(old_content?), new_content: Some(new_content?) });
    }

    if params.mode == "worktree" {
        let (old_content, new_content) = tokio::join!(
            commands::get_file_content(path, &params.file_path, Some("HEAD")),
            commands::get_file_content(path, &params.file_path, None),
        );
        return Ok(FileContent { old_content: Some(old_content?), new_content: Some(new_content?) });
    }

    // Branch mode
    let branch = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_BRANCH).await?;
    let fallback = params.target_branch.as_deref().unwrap_or("main");
    let base_branch = match branch {
        Some(ref b) => commands::get_original_branch(path, b).await.unwrap_or_else(|_| fallback.to_string()),
        None => fallback.to_string(),
    };

    let (old_content, new_content) = tokio::join!(
        commands::get_file_content(path, &params.file_path, Some(&base_branch)),
        commands::get_file_content(path, &params.file_path, Some("HEAD")),
    );
    Ok(FileContent { old_content: Some(old_content?), new_content: Some(new_content?) })
}

pub async fn get_file_content_batch(
    state: &AppState,
    body: GetFileContentBatchBody,
) -> Result<Vec<FileContentBatchItem>, AppError> {
    let git_path = resolve_feature_git_path(state, body.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    if body.file_paths.is_empty() {
        return Ok(vec![]);
    }
    let path = Path::new(&git_path);

    let (old_ref, new_ref): (String, Option<String>) = if let Some(ref commit_sha) = body.commit_sha {
        (format!("{commit_sha}^"), Some(commit_sha.clone()))
    } else if body.mode == "worktree" {
        ("HEAD".to_string(), None)
    } else {
        // Branch mode
        let branch = repository::get_feature_setting(&state.read_pool, body.feature_id, SETTING_WORKTREE_BRANCH).await?;
        let fallback = body.target_branch.as_deref().unwrap_or("main");
        let base = match branch {
            Some(ref b) => commands::get_original_branch(path, b).await.unwrap_or_else(|_| fallback.to_string()),
            None => fallback.to_string(),
        };
        (base, Some("HEAD".to_string()))
    };

    let batch = commands::get_file_content_batch(
        path,
        &body.file_paths,
        &old_ref,
        new_ref.as_deref(),
    ).await?;

    Ok(body.file_paths.iter().map(|fp| {
        let (old, new) = batch.get(fp).cloned().unwrap_or_default();
        FileContentBatchItem { file_path: fp.clone(), old_content: Some(old), new_content: Some(new) }
    }).collect())
}

pub async fn get_commit_log(
    state: &AppState,
    params: GetCommitLogParams,
) -> Result<CommitLogResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(CommitLogResponse { commits: vec![], is_on_base_branch: true }),
    };
    let path = Path::new(&git_path);

    let branch_setting = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_BRANCH).await?;
    let branch_name = match branch_setting {
        Some(b) => b,
        None => match commands::get_current_branch(path).await? {
            Some(b) => b,
            None => return Ok(CommitLogResponse { commits: vec![], is_on_base_branch: true }),
        },
    };

    let base_branch = match commands::get_original_branch(path, &branch_name).await {
        Ok(b) => b,
        Err(_) => {
            let commits = commands::get_recent_commits(path, &branch_name, params.limit).await?;
            return Ok(CommitLogResponse { commits, is_on_base_branch: true });
        }
    };

    if branch_name == base_branch {
        let commits = commands::get_recent_commits(path, &branch_name, params.limit).await?;
        return Ok(CommitLogResponse { commits, is_on_base_branch: true });
    }

    let commits = commands::get_commit_log(path, &base_branch, &branch_name).await?;
    Ok(CommitLogResponse { commits, is_on_base_branch: false })
}

pub async fn get_file_blob_shas(
    state: &AppState,
    params: GetFileBlobShasParams,
) -> Result<Vec<FileBlobSha>, AppError> {
    let wt_path = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH).await?;
    let wt_path = match wt_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let map = commands::get_file_blob_shas(Path::new(&wt_path)).await?;
    Ok(map.into_iter().map(|(file_path, sha)| FileBlobSha { file_path, sha }).collect())
}

pub async fn list_files(
    state: &AppState,
    params: ListFilesParams,
) -> Result<Vec<String>, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    commands::list_files(Path::new(&git_path)).await
}

pub async fn get_worktree_info(
    state: &AppState,
    params: WorktreeInfoParams,
) -> Result<Option<WorktreeInfo>, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let wt_path = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH).await?;
    let wt_path = match wt_path {
        Some(p) => p,
        None => return Ok(None),
    };
    commands::get_worktree_info(Path::new(&project_path), Path::new(&wt_path)).await
}

pub async fn create_worktree(
    state: &AppState,
    body: CreateWorktreeBody,
) -> Result<CreateWorktreeResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, body.project_id).await?;
    let project_name = repository::get_project_name(&state.read_pool, body.project_id).await?;
    let prefix = repository::get_branch_prefix(&state.read_pool, body.project_id).await?;
    let branch_name = commands::build_branch_name(&prefix, &body.feature_title);

    let (worktree_path, branch) =
        commands::create_worktree(Path::new(&project_path), &branch_name, &project_name).await?;

    repository::set_feature_setting(&state.write_pool, body.feature_id, SETTING_WORKTREE_PATH, &worktree_path).await?;
    repository::set_feature_setting(&state.write_pool, body.feature_id, SETTING_WORKTREE_BRANCH, &branch).await?;

    // TODO: Run project_settings.setup_worktree commands (e.g. `pnpm install`) after creating the worktree.
    // The legacy Electron code runs these as a separate background step via GitWorktree service.
    // This needs to be implemented here to match the legacy behavior.

    Ok(CreateWorktreeResponse { worktree_path, branch })
}

pub async fn remove_worktree(
    state: &AppState,
    params: RemoveWorktreeParams,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let wt_path = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
        .await?
        .ok_or_else(|| AppError::NotFound("No worktree found for this feature".into()))?;

    commands::remove_worktree(Path::new(&project_path), Path::new(&wt_path)).await?;
    repository::delete_feature_settings(&state.write_pool, params.feature_id, &[SETTING_WORKTREE_PATH, SETTING_WORKTREE_BRANCH]).await?;

    Ok(SuccessResponse { success: true, error: None })
}

pub async fn delete_worktree(
    state: &AppState,
    params: DeleteWorktreeParams,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let wt_path = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
        .await?
        .ok_or_else(|| AppError::NotFound("No worktree found for this feature".into()))?;

    if commands::has_uncommitted_changes(Path::new(&wt_path)).await? {
        return Ok(SuccessResponse {
            success: false,
            error: Some("Worktree has uncommitted or untracked changes".into()),
        });
    }

    match commands::remove_worktree(Path::new(&project_path), Path::new(&wt_path)).await {
        Ok(_) => {
            repository::delete_feature_settings(&state.write_pool, params.feature_id, &[SETTING_WORKTREE_PATH, SETTING_WORKTREE_BRANCH]).await?;
            Ok(SuccessResponse { success: true, error: None })
        }
        Err(e) => Ok(SuccessResponse { success: false, error: Some(e.to_string()) }),
    }
}

pub async fn retry_worktree_setup(
    state: &AppState,
    body: RetryWorktreeBody,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, body.project_id).await?;
    let project_name = repository::get_project_name(&state.read_pool, body.project_id).await?;
    let prefix = repository::get_branch_prefix(&state.read_pool, body.project_id).await?;

    let title = repository::get_feature_title(&state.read_pool, body.feature_id)
        .await?
        .unwrap_or_else(|| "feature".to_string());

    let branch_name = commands::build_branch_name(&prefix, &title);
    let (worktree_path, branch) =
        commands::create_worktree(Path::new(&project_path), &branch_name, &project_name).await?;

    repository::set_feature_setting(&state.write_pool, body.feature_id, SETTING_WORKTREE_PATH, &worktree_path).await?;
    repository::set_feature_setting(&state.write_pool, body.feature_id, SETTING_WORKTREE_BRANCH, &branch).await?;

    Ok(SuccessResponse { success: true, error: None })
}

pub async fn list_project_worktrees(
    state: &AppState,
    params: ListProjectWorktreesParams,
) -> Result<Vec<ProjectWorktreeInfo>, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let worktrees = commands::list_worktrees(Path::new(&project_path)).await.unwrap_or_default();

    let repo_root_canonical = std::fs::canonicalize(&project_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&project_path));
    let repo_root_str = repo_root_canonical.to_string_lossy().trim_end_matches('/').to_string();
    let secondary: Vec<_> = worktrees
        .into_iter()
        .filter(|w| {
            let w_canonical = std::fs::canonicalize(&w.path)
                .unwrap_or_else(|_| std::path::PathBuf::from(&w.path));
            w_canonical.to_string_lossy().trim_end_matches('/') != repo_root_str && !w.is_bare
        })
        .collect();

    let feature_lookup = repository::get_worktree_feature_lookup(&state.read_pool, params.project_id).await?;
    // Build lookup by canonicalized path for symlink-safe matching
    let by_path: std::collections::HashMap<String, _> = feature_lookup.iter().map(|r| {
        let canonical = std::fs::canonicalize(&r.worktree_path)
            .unwrap_or_else(|_| std::path::PathBuf::from(&r.worktree_path));
        (canonical.to_string_lossy().to_string(), r)
    }).collect();

    Ok(secondary.into_iter().map(|w| {
        let w_canonical = std::fs::canonicalize(&w.path)
            .unwrap_or_else(|_| std::path::PathBuf::from(&w.path));
        let feat = by_path.get(&*w_canonical.to_string_lossy());
        ProjectWorktreeInfo {
            path: w.path,
            branch: w.branch,
            head: w.head,
            feature_id: feat.map(|f| f.feature_id),
            feature_title: feat.map(|f| f.feature_title.clone()),
            feature_status: feat.map(|f| f.feature_status.clone()),
        }
    }).collect())
}

pub async fn remove_orphan_worktree(
    state: &AppState,
    body: RemoveOrphanWorktreeBody,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, body.project_id).await?;
    match commands::remove_worktree(Path::new(&project_path), Path::new(&body.worktree_path)).await {
        Ok(_) => Ok(SuccessResponse { success: true, error: None }),
        Err(e) => Ok(SuccessResponse { success: false, error: Some(e.to_string()) }),
    }
}

pub async fn get_original_branch(
    state: &AppState,
    params: GetOriginalBranchParams,
) -> Result<OriginalBranchResponse, AppError> {
    let (project_path, worktree_branch) = get_project_and_branch(state, params.project_id, params.feature_id).await?;
    let original_branch = commands::get_original_branch(Path::new(&project_path), &worktree_branch).await?;
    Ok(OriginalBranchResponse { original_branch, worktree_branch })
}

pub async fn check_merge_conflicts(
    state: &AppState,
    params: CheckMergeConflictsParams,
) -> Result<MergeConflictResult, AppError> {
    let (project_path, branch) = get_project_and_branch(state, params.project_id, params.feature_id).await?;
    let target = commands::get_original_branch(Path::new(&project_path), &branch).await?;
    commands::check_merge_conflicts(Path::new(&project_path), &branch, &target).await
}

pub async fn merge_feature_branch(
    state: &AppState,
    body: MergeFeatureBranchBody,
) -> Result<MergeResult, AppError> {
    let (project_path, branch) = get_project_and_branch(state, body.project_id, body.feature_id).await?;
    let target = commands::get_original_branch(Path::new(&project_path), &branch).await?;
    commands::merge_branch(Path::new(&project_path), &branch, &target).await
}

pub async fn delete_feature_branch(
    state: &AppState,
    params: DeleteFeatureBranchParams,
) -> Result<SuccessResponse, AppError> {
    let (project_path, branch) = get_project_and_branch(state, params.project_id, params.feature_id).await?;
    let result = commands::delete_branch(Path::new(&project_path), &branch).await?;
    Ok(SuccessResponse { success: result.success, error: result.error })
}

pub async fn has_uncommitted_changes(
    state: &AppState,
    params: HasUncommittedChangesParams,
) -> Result<HasUncommittedChangesResponse, AppError> {
    let wt_path = repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
        .await?
        .ok_or_else(|| AppError::NotFound("No worktree found for this feature".into()))?;

    let has_changes = commands::has_uncommitted_changes(Path::new(&wt_path)).await?;
    Ok(HasUncommittedChangesResponse { has_changes })
}
