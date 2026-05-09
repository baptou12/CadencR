use std::collections::HashMap;
use std::path::Path;

use chrono::DateTime;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::file_size::classify_content;
use crate::domain::git::models::*;
use crate::domain::git::repository;
use crate::domain::git::workflow_service;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Feature-setting key constants
// ---------------------------------------------------------------------------

const SETTING_WORKTREE_PATH: &str = "worktree_path";
const SETTING_WORKTREE_BRANCH: &str = "worktree_branch";
const SETTING_TARGET_BRANCH: &str = "target_branch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn migrate_provider_config_into_worktree(
    project_path: &str,
    worktree_path: &str,
) -> Result<(), AppError> {
    crate::domain::agents::providers::notify_worktree_created_for_all_providers(
        Path::new(project_path),
        Path::new(worktree_path),
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))
}

/// Resolve the git directory for a feature.
/// Uses worktree_path if available, otherwise project path.
pub async fn resolve_feature_git_path(
    state: &AppState,
    feature_id: i64,
) -> Result<Option<String>, AppError> {
    // Check worktree path first (applies to all feature types)
    let wt = repository::get_feature_setting(&state.read_pool, feature_id, SETTING_WORKTREE_PATH)
        .await?;
    if let Some(path) = wt {
        return Ok(Some(path));
    }

    // Fall back to project path
    let row = repository::get_feature_type_and_project(&state.read_pool, feature_id).await?;
    let project_id = match row {
        Some((pid, _)) => pid,
        None => return Ok(None),
    };
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
    let branch =
        repository::get_feature_setting(&state.read_pool, feature_id, SETTING_WORKTREE_BRANCH)
            .await?
            .ok_or_else(|| {
                AppError::NotFound("No worktree branch found for this feature".into())
            })?;
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

pub async fn get_stats(state: &AppState, params: GetStatsParams) -> Result<GitStats, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(GitStats {
                files_changed: 0,
                insertions: 0,
                deletions: 0,
            })
        }
    };
    commands::get_stats(
        Path::new(&git_path),
        &params.mode,
        params.target_branch.as_deref(),
    )
    .await
}

pub async fn get_diff(state: &AppState, params: GetDiffParams) -> Result<DiffResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(DiffResponse {
                diff: String::new(),
            })
        }
    };

    let diff = if let Some(ref commit_sha) = params.commit_sha {
        commands::get_commit_diff(Path::new(&git_path), commit_sha).await?
    } else {
        commands::get_diff(
            Path::new(&git_path),
            &params.mode,
            params.target_branch.as_deref(),
        )
        .await?
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
    commands::get_changed_files(
        Path::new(&git_path),
        &params.mode,
        params.target_branch.as_deref(),
    )
    .await
}

/// Resolve which (old_ref, new_ref) pair the diff endpoints should use for a
/// given request. `None` for `new_ref` means "the working tree". Shared by
/// `get_file_content` and `get_file_content_batch` so both endpoints stay in
/// lock-step.
///
/// Priority for the comparison base in the "vs target" mode:
///
///   1. an explicit, non-empty `target_branch` from the caller — the user
///      picked it, we use it verbatim,
///   2. otherwise `workflow_service::resolve_target_branch` (consults the
///      stored feature setting, then the fallback chain pinned to
///      `origin/HEAD`),
///   3. otherwise the literal `"main"` last-resort label.
///
/// Bug fix: step 1 used to be silently overridden by `get_original_branch`,
/// which meant that an explicit pick from the picker (e.g. `origin/main`)
/// was discarded in favor of the original-branch fallback. The file-content
/// diff then used a different base than the stats endpoint and the user saw
/// inconsistent diffs.
async fn resolve_diff_refs(
    state: &AppState,
    feature_id: i64,
    mode: &str,
    target_branch: Option<&str>,
    commit_sha: Option<&str>,
    path: &Path,
) -> Result<(String, Option<String>), AppError> {
    if let Some(sha) = commit_sha {
        return Ok((format!("{sha}^"), Some(sha.to_string())));
    }
    // `"uncommitted"` is an explicit alias for the working-tree-vs-HEAD diff;
    // the new Git tab segmented control persists this value, but the existing
    // `"worktree"` value remains supported for older clients.
    if mode == "worktree" || mode == "uncommitted" {
        return Ok(("HEAD".to_string(), None));
    }
    if let Some(explicit) = target_branch.and_then(|t| {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        return Ok((explicit, Some("HEAD".to_string())));
    }
    let base = crate::domain::git::workflow_service::resolve_target_branch(state, feature_id, path)
        .await
        .unwrap_or_else(|_| "main".to_string());
    Ok((base, Some("HEAD".to_string())))
}

/// Always returns the full content even for large text files — the
/// single-file endpoint is the explicit "user opted in" path. Binary
/// content is still suppressed (no useful textual diff to show).
pub async fn get_file_content(
    state: &AppState,
    params: GetFileContentParams,
) -> Result<FileContent, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(FileContent {
                old_content: None,
                new_content: None,
                old_size: 0,
                new_size: 0,
                is_binary: false,
                is_large: false,
            })
        }
    };
    let path = Path::new(&git_path);
    let (old_ref, new_ref) = resolve_diff_refs(
        state,
        params.feature_id,
        &params.mode,
        params.target_branch.as_deref(),
        params.commit_sha.as_deref(),
        path,
    )
    .await?;

    let (old_content, new_content) = tokio::join!(
        commands::get_file_content(path, &params.file_path, Some(&old_ref)),
        commands::get_file_content(path, &params.file_path, new_ref.as_deref()),
    );

    Ok(classify_content(
        params.file_path,
        old_content?,
        new_content?,
        /* keep_large_content */ true,
    )
    .into())
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
    let (old_ref, new_ref) = resolve_diff_refs(
        state,
        body.feature_id,
        &body.mode,
        body.target_branch.as_deref(),
        body.commit_sha.as_deref(),
        path,
    )
    .await?;

    commands::get_file_content_batch(path, &body.file_paths, &old_ref, new_ref.as_deref()).await
}

pub async fn get_commit_log(
    state: &AppState,
    params: GetCommitLogParams,
) -> Result<CommitLogResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(CommitLogResponse {
                commits: vec![],
                is_on_base_branch: true,
            })
        }
    };
    let path = Path::new(&git_path);

    let branch_setting = repository::get_feature_setting(
        &state.read_pool,
        params.feature_id,
        SETTING_WORKTREE_BRANCH,
    )
    .await?;
    let branch_name = match branch_setting {
        Some(b) => b,
        None => match commands::get_current_branch(path).await? {
            Some(b) => b,
            None => {
                return Ok(CommitLogResponse {
                    commits: vec![],
                    is_on_base_branch: true,
                })
            }
        },
    };

    // Use the same target-branch resolution as the status snapshot so the
    // commit-log view and the "ahead of target" badge are always counting
    // the same thing. Critical for the `main` (stale local) vs
    // `origin/main` (remote tip) divergence: if the user picked
    // `origin/main` as their target, both UIs must compare against
    // `origin/main`, not silently fall back to local `main` here.
    let base_branch =
        crate::domain::git::workflow_service::resolve_target_branch(state, params.feature_id, path)
            .await
            .unwrap_or_else(|_| "main".to_string());

    if branch_name == base_branch {
        let commits = commands::get_recent_commits(path, params.limit).await?;
        return Ok(CommitLogResponse {
            commits,
            is_on_base_branch: true,
        });
    }

    let commits = commands::get_commit_log(path, &base_branch).await?;
    Ok(CommitLogResponse {
        commits,
        is_on_base_branch: false,
    })
}

pub async fn get_file_blob_shas(
    state: &AppState,
    params: GetFileBlobShasParams,
) -> Result<Vec<FileBlobSha>, AppError> {
    let wt_path =
        repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
            .await?;
    let wt_path = match wt_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let map = commands::get_file_blob_shas(Path::new(&wt_path)).await?;
    Ok(map
        .into_iter()
        .map(|(file_path, sha)| FileBlobSha { file_path, sha })
        .collect())
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
    let wt_path =
        repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
            .await?;
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
    migrate_provider_config_into_worktree(&project_path, &worktree_path).await?;

    repository::set_feature_setting(
        &state.write_pool,
        body.feature_id,
        SETTING_WORKTREE_PATH,
        &worktree_path,
    )
    .await?;
    repository::set_feature_setting(
        &state.write_pool,
        body.feature_id,
        SETTING_WORKTREE_BRANCH,
        &branch,
    )
    .await?;

    // TODO: Run project_settings.setup_worktree commands (e.g. `pnpm install`) after creating the worktree.
    // The legacy Electron code runs these as a separate background step via GitWorktree service.
    // This needs to be implemented here to match the legacy behavior.

    Ok(CreateWorktreeResponse {
        worktree_path,
        branch,
    })
}

pub async fn remove_worktree(
    state: &AppState,
    params: RemoveWorktreeParams,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let wt_path =
        repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
            .await?
            .ok_or_else(|| AppError::NotFound("No worktree found for this feature".into()))?;

    commands::remove_worktree(Path::new(&project_path), Path::new(&wt_path)).await?;
    repository::delete_feature_settings(
        &state.write_pool,
        params.feature_id,
        &[SETTING_WORKTREE_PATH, SETTING_WORKTREE_BRANCH],
    )
    .await?;

    Ok(SuccessResponse {
        success: true,
        error: None,
    })
}

pub async fn delete_worktree(
    state: &AppState,
    params: DeleteWorktreeParams,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let wt_path =
        repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
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
            repository::delete_feature_settings(
                &state.write_pool,
                params.feature_id,
                &[SETTING_WORKTREE_PATH, SETTING_WORKTREE_BRANCH],
            )
            .await?;
            Ok(SuccessResponse {
                success: true,
                error: None,
            })
        }
        Err(e) => Ok(SuccessResponse {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

pub async fn retry_worktree_setup(
    state: &AppState,
    body: RetryWorktreeBody,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, body.project_id).await?;
    let project_name = repository::get_project_name(&state.read_pool, body.project_id).await?;

    // Reuse stored branch name to avoid creating duplicate worktrees
    let branch_name = match repository::get_feature_setting(
        &state.read_pool,
        body.feature_id,
        SETTING_WORKTREE_BRANCH,
    )
    .await?
    {
        Some(existing) => existing,
        None => {
            let prefix = repository::get_branch_prefix(&state.read_pool, body.project_id).await?;
            let title = repository::get_feature_title(&state.read_pool, body.feature_id)
                .await?
                .unwrap_or_else(|| "feature".to_string());
            commands::build_branch_name(&prefix, &title)
        }
    };

    let (worktree_path, branch) =
        commands::create_worktree(Path::new(&project_path), &branch_name, &project_name).await?;
    migrate_provider_config_into_worktree(&project_path, &worktree_path).await?;

    repository::set_feature_setting(
        &state.write_pool,
        body.feature_id,
        SETTING_WORKTREE_PATH,
        &worktree_path,
    )
    .await?;
    repository::set_feature_setting(
        &state.write_pool,
        body.feature_id,
        SETTING_WORKTREE_BRANCH,
        &branch,
    )
    .await?;

    Ok(SuccessResponse {
        success: true,
        error: None,
    })
}

pub async fn list_project_worktrees(
    state: &AppState,
    params: ListProjectWorktreesParams,
) -> Result<Vec<ProjectWorktreeInfo>, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let worktrees = commands::list_worktrees(Path::new(&project_path))
        .await
        .unwrap_or_default();

    let repo_root_canonical = std::fs::canonicalize(&project_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&project_path));
    let repo_root_str = repo_root_canonical
        .to_string_lossy()
        .trim_end_matches('/')
        .to_string();
    let secondary: Vec<_> = worktrees
        .into_iter()
        .filter(|w| {
            let w_canonical = std::fs::canonicalize(&w.path)
                .unwrap_or_else(|_| std::path::PathBuf::from(&w.path));
            w_canonical.to_string_lossy().trim_end_matches('/') != repo_root_str && !w.is_bare
        })
        .collect();

    let feature_lookup =
        repository::get_worktree_feature_lookup(&state.read_pool, params.project_id).await?;
    // Build lookup by canonicalized path for symlink-safe matching
    let by_path: std::collections::HashMap<String, _> = feature_lookup
        .iter()
        .map(|r| {
            let canonical = std::fs::canonicalize(&r.worktree_path)
                .unwrap_or_else(|_| std::path::PathBuf::from(&r.worktree_path));
            (canonical.to_string_lossy().to_string(), r)
        })
        .collect();

    Ok(secondary
        .into_iter()
        .map(|w| {
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
        })
        .collect())
}

pub async fn list_feature_worktrees(
    state: &AppState,
    params: ListFeatureWorktreesParams,
) -> Result<Vec<FeatureWorktreeInfo>, AppError> {
    let rows =
        repository::list_feature_worktree_settings(&state.read_pool, params.project_id).await?;

    // Probe disk presence concurrently — otherwise we'd serialize one syscall
    // per feature inside a hot async handler.
    let liveness = futures::future::join_all(
        rows.iter()
            .map(|r| async { tokio::fs::metadata(&r.worktree_path).await.is_ok() }),
    )
    .await;

    Ok(rows
        .into_iter()
        .zip(liveness)
        .map(|(r, live)| FeatureWorktreeInfo {
            feature_id: r.feature_id,
            worktree_path: r.worktree_path,
            worktree_branch: r.worktree_branch,
            live,
        })
        .collect())
}

pub async fn remove_orphan_worktree(
    state: &AppState,
    body: RemoveOrphanWorktreeBody,
) -> Result<SuccessResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, body.project_id).await?;
    match commands::remove_worktree(Path::new(&project_path), Path::new(&body.worktree_path)).await
    {
        Ok(_) => Ok(SuccessResponse {
            success: true,
            error: None,
        }),
        Err(e) => Ok(SuccessResponse {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

pub async fn get_original_branch(
    state: &AppState,
    params: GetOriginalBranchParams,
) -> Result<OriginalBranchResponse, AppError> {
    let (project_path, worktree_branch) =
        get_project_and_branch(state, params.project_id, params.feature_id).await?;
    let original_branch =
        commands::get_original_branch(Path::new(&project_path), &worktree_branch).await?;
    Ok(OriginalBranchResponse {
        original_branch,
        worktree_branch,
    })
}

pub async fn check_merge_conflicts(
    state: &AppState,
    params: CheckMergeConflictsParams,
) -> Result<MergeConflictResult, AppError> {
    let (project_path, branch) =
        get_project_and_branch(state, params.project_id, params.feature_id).await?;
    let (repo_path, target) =
        resolve_merge_conflict_repo_and_target(state, params.feature_id, project_path).await?;
    commands::check_merge_conflicts(Path::new(&repo_path), &branch, &target).await
}

async fn resolve_merge_conflict_repo_and_target(
    state: &AppState,
    feature_id: i64,
    fallback_project_path: String,
) -> Result<(String, String), AppError> {
    if let Some(stored) =
        repository::get_feature_setting(&state.read_pool, feature_id, SETTING_TARGET_BRANCH).await?
    {
        let target = stored.trim();
        if !target.is_empty() {
            return Ok((fallback_project_path, target.to_string()));
        }
    }

    let git_path = resolve_feature_git_path(state, feature_id)
        .await?
        .unwrap_or(fallback_project_path);
    let target =
        workflow_service::resolve_target_branch(state, feature_id, Path::new(&git_path)).await?;
    Ok((git_path, target))
}

pub async fn delete_feature_branch(
    state: &AppState,
    params: DeleteFeatureBranchParams,
) -> Result<SuccessResponse, AppError> {
    let (project_path, branch) =
        get_project_and_branch(state, params.project_id, params.feature_id).await?;
    let result = commands::delete_branch(Path::new(&project_path), &branch).await?;
    Ok(SuccessResponse {
        success: result.success,
        error: result.error,
    })
}

pub async fn has_uncommitted_changes(
    state: &AppState,
    params: HasUncommittedChangesParams,
) -> Result<HasUncommittedChangesResponse, AppError> {
    let wt_path =
        repository::get_feature_setting(&state.read_pool, params.feature_id, SETTING_WORKTREE_PATH)
            .await?
            .ok_or_else(|| AppError::NotFound("No worktree found for this feature".into()))?;

    let has_changes = commands::has_uncommitted_changes(Path::new(&wt_path)).await?;
    Ok(HasUncommittedChangesResponse { has_changes })
}

pub async fn get_blame(
    state: &AppState,
    params: GetBlameParams,
) -> Result<BlameResponse, AppError> {
    let project_root = crate::domain::projects::service::resolve_feature_editor_root(
        &state.read_pool,
        params.project_id,
        params.feature_id,
    )
    .await?;
    // Confirm the file is inside the resolved root — blame is read-only but
    // still runs git from whatever cwd we pass, so contain it.
    let file_canonical =
        crate::domain::editor::service::validate_path(&project_root, &params.file_path)?;
    let relative = file_canonical
        .strip_prefix(&project_root)
        .map_err(|_| AppError::BadRequest("file outside project root".into()))?
        .to_string_lossy()
        .into_owned();
    let output = crate::shared::git_cli::run_git_safe(
        &["blame"],
        &["--porcelain"],
        &[&relative],
        &project_root,
    )
    .await?;
    let lines = parse_blame_porcelain(&output);
    Ok(BlameResponse { lines })
}

#[derive(Default)]
struct CommitMeta {
    author: String,
    date: String,
    summary: String,
}

fn parse_blame_porcelain(output: &str) -> Vec<BlameLine> {
    let mut results: Vec<BlameLine> = Vec::new();
    let mut commits: HashMap<String, CommitMeta> = HashMap::new();
    let mut current_sha: Option<String> = None;
    let mut line_num: u32 = 0;

    for raw_line in output.lines() {
        if raw_line.len() >= 40
            && raw_line.as_bytes()[..40]
                .iter()
                .all(|b| b.is_ascii_hexdigit())
        {
            // Header line: "<sha> <orig-line> <final-line> [<num-lines>]".
            // git blame --porcelain only emits the metadata block (author/
            // summary/...) on the first occurrence of a given SHA; subsequent
            // chunks of the same commit reuse the cached metadata.
            let sha = raw_line[..40].to_string();
            if let Some(field) = raw_line.split_whitespace().nth(2) {
                line_num = field.parse().unwrap_or(0);
            }
            commits.entry(sha.clone()).or_default();
            current_sha = Some(sha);
        } else if let Some(val) = raw_line.strip_prefix("author ") {
            if let Some(meta) = current_sha.as_deref().and_then(|s| commits.get_mut(s)) {
                meta.author = val.to_string();
            }
        } else if let Some(val) = raw_line.strip_prefix("author-time ") {
            if let Some(meta) = current_sha.as_deref().and_then(|s| commits.get_mut(s)) {
                let ts: i64 = val.parse().unwrap_or(0);
                meta.date = DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
            }
        } else if let Some(val) = raw_line.strip_prefix("summary ") {
            if let Some(meta) = current_sha.as_deref().and_then(|s| commits.get_mut(s)) {
                meta.summary = val.to_string();
            }
        } else if raw_line.starts_with('\t') {
            let Some(meta) = current_sha.as_deref().and_then(|s| commits.get(s)) else {
                continue;
            };
            results.push(BlameLine {
                line: line_num,
                author: meta.author.clone(),
                date: meta.date.clone(),
                summary: meta.summary.clone(),
            });
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_blame_porcelain_single_line() {
        let output = "\
abcdef1234567890abcdef1234567890abcdef12 1 1 1
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary initial commit
filename src/main.rs
\thello world
";
        let lines = parse_blame_porcelain(output);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].line, 1);
        assert_eq!(lines[0].author, "Alice");
        assert_eq!(lines[0].date, "2023-11-14");
        assert_eq!(lines[0].summary, "initial commit");
    }

    #[test]
    fn test_parse_blame_porcelain_multiple_lines() {
        let output = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Alice
author-time 1700000000
summary first commit
filename f.rs
\tline one
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1
author Bob
author-time 1700100000
summary second commit
filename f.rs
\tline two
";
        let lines = parse_blame_porcelain(output);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].author, "Alice");
        assert_eq!(lines[0].line, 1);
        assert_eq!(lines[1].author, "Bob");
        assert_eq!(lines[1].line, 2);
        assert_eq!(lines[1].summary, "second commit");
    }

    #[test]
    fn test_parse_blame_porcelain_empty_input() {
        let lines = parse_blame_porcelain("");
        assert!(lines.is_empty());
    }

    #[test]
    fn test_parse_blame_porcelain_repeated_commit_metadata() {
        // A single commit covering multiple consecutive lines: porcelain only
        // emits the author/summary block on the first occurrence. Subsequent
        // lines of the same commit must inherit the cached metadata.
        let output = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
summary first commit
filename f.rs
\tline one
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2
\tline two
";
        let lines = parse_blame_porcelain(output);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].author, "Alice");
        assert_eq!(lines[0].summary, "first commit");
        assert_eq!(lines[0].line, 1);
        // The second line of the same commit must still expose author and summary.
        assert_eq!(lines[1].author, "Alice");
        assert_eq!(lines[1].summary, "first commit");
        assert_eq!(lines[1].line, 2);
        assert_eq!(lines[1].date, lines[0].date);
    }

    #[test]
    fn test_parse_blame_porcelain_interleaved_commits() {
        // Commit A appears, then commit B, then commit A reappears later.
        // The reappearance must resolve metadata from the cache.
        let output = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Alice
author-time 1700000000
summary first commit
filename f.rs
\tline one
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1
author Bob
author-time 1700100000
summary second commit
filename f.rs
\tline two
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 3 3
\tline three
";
        let lines = parse_blame_porcelain(output);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[2].author, "Alice");
        assert_eq!(lines[2].summary, "first commit");
        assert_eq!(lines[2].line, 3);
        assert_eq!(lines[2].date, lines[0].date);
    }

    // -----------------------------------------------------------------------
    // resolve_diff_refs
    // -----------------------------------------------------------------------

    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    async fn setup_diff_refs_schema() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, path TEXT, branch_prefix TEXT DEFAULT 'feature/')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT, status TEXT DEFAULT 'draft', type TEXT NOT NULL DEFAULT 'feature')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    /// An explicit `target_branch` from the caller must win over any fallback.
    /// Regression test for the bug where the original-branch fallback silently
    /// overrode the user's explicit pick.
    #[tokio::test]
    async fn resolve_diff_refs_honors_explicit_target_branch() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        // Configure a worktree branch *and* a different stored target so we
        // can prove the explicit param is what wins, not either of those.
        repository::set_feature_setting(&pool, 1, SETTING_WORKTREE_BRANCH, "feature/x")
            .await
            .unwrap();
        repository::set_feature_setting(&pool, 1, "target_branch", "develop")
            .await
            .unwrap();

        let state = AppState::with_pool(pool);
        let dir = tempfile::tempdir().unwrap();

        let (old_ref, new_ref) =
            resolve_diff_refs(&state, 1, "target", Some("origin/main"), None, dir.path())
                .await
                .unwrap();
        assert_eq!(old_ref, "origin/main");
        assert_eq!(new_ref.as_deref(), Some("HEAD"));
    }

    #[tokio::test]
    async fn resolve_merge_conflict_target_honors_stored_target_branch() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        repository::set_feature_setting(&pool, 1, "target_branch", "develop")
            .await
            .unwrap();

        let state = AppState::with_pool(pool);
        let (repo_path, target) =
            resolve_merge_conflict_repo_and_target(&state, 1, "/tmp/project".to_string())
                .await
                .unwrap();
        assert_eq!(repo_path, "/tmp/project");
        assert_eq!(target, "develop");
    }

    /// Blank/whitespace `target_branch` from the caller must NOT short-circuit
    /// the resolver — fall through to `resolve_target_branch`, which will use
    /// the stored setting.
    #[tokio::test]
    async fn resolve_diff_refs_blank_explicit_target_falls_through_to_setting() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        repository::set_feature_setting(&pool, 1, "target_branch", "develop")
            .await
            .unwrap();

        let state = AppState::with_pool(pool);
        let dir = tempfile::tempdir().unwrap();

        let (old_ref, new_ref) =
            resolve_diff_refs(&state, 1, "target", Some("   "), None, dir.path())
                .await
                .unwrap();
        assert_eq!(old_ref, "develop");
        assert_eq!(new_ref.as_deref(), Some("HEAD"));
    }

    /// `mode == "uncommitted"` always means working-tree-vs-HEAD regardless
    /// of any target-branch arg. Both `"worktree"` and `"uncommitted"` must
    /// behave the same.
    #[tokio::test]
    async fn resolve_diff_refs_uncommitted_mode_uses_head_vs_worktree() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let dir = tempfile::tempdir().unwrap();

        for mode in ["worktree", "uncommitted"] {
            let (old_ref, new_ref) =
                resolve_diff_refs(&state, 1, mode, Some("origin/main"), None, dir.path())
                    .await
                    .unwrap();
            assert_eq!(old_ref, "HEAD", "mode={mode} must compare against HEAD");
            assert!(
                new_ref.is_none(),
                "mode={mode} must compare against working tree (None)"
            );
        }
    }
}
