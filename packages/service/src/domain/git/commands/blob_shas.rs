//! `get_file_blob_shas`: collect blob SHAs for every file that's changed
//! in the working copy or relative to `main`/`master`. Used by the diff
//! viewer to key its per-file caches.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::error::AppError;
use crate::shared::git_cli::{run_git, run_git_safe};

use super::util::run_git_quiet;

/// Get blob SHAs for all changed files (worktree + branch changes).
pub async fn get_file_blob_shas(worktree_path: &Path) -> Result<HashMap<String, String>, AppError> {
    let (changed_out, untracked_out) = tokio::join!(
        run_git_quiet(&["diff", "HEAD", "--name-only"], worktree_path),
        run_git_quiet(
            &["ls-files", "--others", "--exclude-standard"],
            worktree_path
        ),
    );

    let changed_files: HashSet<String> = changed_out
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect();
    let untracked_files: HashSet<String> = untracked_out
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect();

    // Also get branch-changed files via merge-base
    let merge_base_result = match run_git(&["merge-base", "HEAD", "main"], worktree_path).await {
        Ok(v) => Ok(v),
        Err(_) => run_git(&["merge-base", "HEAD", "master"], worktree_path).await,
    };

    let branch_changed: HashSet<String> = match merge_base_result {
        Ok(merge_base_out) => {
            let merge_base = merge_base_out.trim();
            if merge_base.is_empty() {
                HashSet::new()
            } else {
                run_git_quiet(&["diff", merge_base, "HEAD", "--name-only"], worktree_path)
                    .await
                    .trim()
                    .lines()
                    .filter(|l| !l.is_empty())
                    .map(|s| s.to_string())
                    .collect()
            }
        }
        Err(_) => HashSet::new(),
    };

    let all_files: HashSet<String> = changed_files
        .union(&untracked_files)
        .cloned()
        .collect::<HashSet<_>>()
        .union(&branch_changed)
        .cloned()
        .collect();

    let mut result = HashMap::new();
    for file_path in all_files {
        // A file name starting with `-` would be parsed as a flag; skip it.
        if crate::shared::git_cli::guard_positionals(&[file_path.as_str()]).is_err() {
            continue;
        }
        // Try hash-object first, then rev-parse HEAD:path
        let sha = match run_git_safe(&["hash-object"], &[], &[&file_path], worktree_path).await {
            Ok(stdout) => stdout.trim().to_string(),
            Err(_) => {
                let rev_arg = format!("HEAD:{file_path}");
                match run_git(&["rev-parse", &rev_arg], worktree_path).await {
                    Ok(stdout) => stdout.trim().to_string(),
                    Err(_) => continue,
                }
            }
        };
        if !sha.is_empty() {
            result.insert(file_path, sha);
        }
    }

    Ok(result)
}
