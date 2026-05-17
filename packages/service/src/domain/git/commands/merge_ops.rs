//! `git merge-tree` / `git branch -d` orchestration.
//! Branch-resolution lives in [`super::merge`].

use std::path::Path;

use tokio::process::Command;

use crate::domain::git::models::{MergeConflictResult, MergeResult};
use crate::error::AppError;
use crate::shared::git_cli::run_git_safe_refs;

/// Check if merging source_branch into target_branch would produce conflicts.
///
/// Uses the modern two-argument form of `git merge-tree` (Git 2.38+) which
/// performs a real merge in-memory and exits with code 0 for clean merges or
/// code 1 for conflicts. The old three-argument form would false-positive on
/// identical changes present on both sides.
pub async fn check_merge_conflicts(
    repo_path: &Path,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeConflictResult, AppError> {
    // `git merge-tree --write-tree` performs an in-memory merge.
    // Exit 0 → clean merge, exit 1 → conflicts (listed on stdout).
    crate::shared::git_cli::guard_positionals(&[target_branch, source_branch])?;
    let output = Command::new("git")
        .args(["merge-tree", "--write-tree", target_branch, source_branch])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to run git merge-tree: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let exit_code = output.status.code().unwrap_or(-1);

    tracing::debug!(
        exit_code,
        stdout = %stdout.chars().take(500).collect::<String>(),
        "git merge-tree --write-tree {} {}",
        target_branch,
        source_branch,
    );

    if output.status.success() {
        // Clean merge — no conflicts
        return Ok(MergeConflictResult {
            has_conflicts: false,
            conflict_files: vec![],
        });
    }

    // Parse conflicting file names from the "CONFLICT" lines in stdout.
    // Format: "CONFLICT (content): Merge conflict in <path>"
    let conflict_files: Vec<String> = stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("CONFLICT") {
                // Extract path after "Merge conflict in "
                if let Some(path) = rest.rsplit("Merge conflict in ").next() {
                    let path = path.trim();
                    if !path.is_empty() {
                        return Some(path.to_string());
                    }
                }
            }
            None
        })
        .collect();

    Ok(MergeConflictResult {
        has_conflicts: true,
        conflict_files,
    })
}

/// Return true when `branch_name` is fully contained in `target_branch`.
pub async fn is_branch_merged(
    repo_path: &Path,
    branch_name: &str,
    target_branch: &str,
) -> Result<bool, AppError> {
    crate::shared::git_cli::guard_positionals(&[branch_name, target_branch])?;
    let output = Command::new("git")
        .args(["merge-base", "--is-ancestor", branch_name, target_branch])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to run git merge-base: {e}")))?;
    Ok(output.status.success())
}

/// Delete a local branch. Safe mode uses -d; force mode uses -D after explicit
/// user confirmation from the archive cleanup flow.
pub async fn delete_branch(
    repo_path: &Path,
    branch_name: &str,
    force: bool,
) -> Result<MergeResult, AppError> {
    let flag = if force { "-D" } else { "-d" };
    match run_git_safe_refs(&["branch"], &[flag], &[branch_name], repo_path).await {
        Ok(_) => Ok(MergeResult {
            success: true,
            error: None,
        }),
        Err(e) => Ok(MergeResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}
