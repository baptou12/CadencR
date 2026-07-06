//! `git diff` / `git diff --stat` orchestration plus the unified-diff
//! emission for untracked files. Spans both `branch` and `worktree`/
//! `uncommitted` modes; the ws/HTTP handlers pick the mode.

use std::path::Path;

use crate::domain::git::models::GitStats;
use crate::error::AppError;
use crate::shared::git_cli::run_git_safe_refs;

use super::untracked::{count_untracked_lines, synthesize_untracked_new_file_diff};
use super::util::run_git_quiet;

/// Parse git diff --stat summary line.
pub(super) fn parse_stat_line(output: &str) -> GitStats {
    static STAT_RE: std::sync::LazyLock<regex_lite::Regex> = std::sync::LazyLock::new(|| {
        regex_lite::Regex::new(
            r"(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?"
        ).unwrap()
    });

    if let Some(caps) = STAT_RE.captures(output) {
        GitStats {
            files_changed: caps.get(1).map_or(0, |m| m.as_str().parse().unwrap_or(0)),
            insertions: caps.get(2).map_or(0, |m| m.as_str().parse().unwrap_or(0)),
            deletions: caps.get(3).map_or(0, |m| m.as_str().parse().unwrap_or(0)),
        }
    } else {
        GitStats {
            files_changed: 0,
            insertions: 0,
            deletions: 0,
        }
    }
}

/// Get git diff stats.
pub async fn get_stats(
    worktree_path: &Path,
    mode: &str,
    target_branch: Option<&str>,
) -> Result<GitStats, AppError> {
    if mode == "branch" {
        let branch = target_branch.unwrap_or("main");
        let diff_arg = format!("{branch}...HEAD");
        let stdout = run_git_quiet(&["diff", &diff_arg, "--stat"], worktree_path).await;
        return Ok(parse_stat_line(&stdout));
    }

    // Worktree mode: unstaged + staged + untracked
    let (unstaged, staged, untracked) = tokio::join!(
        run_git_quiet(&["diff", "--stat"], worktree_path),
        run_git_quiet(&["diff", "--cached", "--stat"], worktree_path),
        run_git_quiet(
            &["ls-files", "--others", "--exclude-standard"],
            worktree_path
        ),
    );

    let mut stats_unstaged = parse_stat_line(&unstaged);
    let stats_staged = parse_stat_line(&staged);
    stats_unstaged.files_changed += stats_staged.files_changed;
    stats_unstaged.insertions += stats_staged.insertions;
    stats_unstaged.deletions += stats_staged.deletions;

    // Count untracked files. `--exclude-standard` already filters gitignored
    // paths, so we only see files that count. Lines are counted with a buffered
    // stream (bounded memory, not a full read-into-String of every file) and
    // binaries are skipped.
    for file in untracked.trim().lines().filter(|l| !l.is_empty()) {
        let full_path = worktree_path.join(file);
        if let Some(line_count) = count_untracked_lines(&full_path).await {
            stats_unstaged.files_changed += 1;
            stats_unstaged.insertions += line_count as i32;
        }
    }

    Ok(stats_unstaged)
}

/// Get unified diff string.
pub async fn get_diff(
    worktree_path: &Path,
    mode: &str,
    target_branch: Option<&str>,
) -> Result<String, AppError> {
    if mode == "branch" {
        let branch = target_branch.unwrap_or("main");
        let diff_arg = format!("{branch}...HEAD");
        return Ok(run_git_quiet(&["diff", &diff_arg], worktree_path).await);
    }

    // Worktree mode
    let (unstaged, staged, untracked_list) = tokio::join!(
        run_git_quiet(&["diff"], worktree_path),
        run_git_quiet(&["diff", "--cached"], worktree_path),
        run_git_quiet(
            &["ls-files", "--others", "--exclude-standard"],
            worktree_path
        ),
    );

    let mut result = unstaged;
    result.push_str(&staged);

    // `git ls-files --others --exclude-standard` already filters gitignored
    // paths, so we never synthesize a diff for an ignored file. Each remaining
    // untracked file is bounded per-file (see `untracked`) so a giant generated
    // file can't blow up the aggregate response.
    for file in untracked_list.trim().lines().filter(|l| !l.is_empty()) {
        if let Some(block) = synthesize_untracked_new_file_diff(worktree_path, file).await {
            result.push_str(&block);
        }
    }

    Ok(result)
}

/// Get the diff for a specific commit.
pub async fn get_commit_diff(worktree_path: &Path, commit_sha: &str) -> Result<String, AppError> {
    crate::shared::git_cli::guard_positionals(&[commit_sha])?;
    let diff_arg = format!("{commit_sha}^..{commit_sha}");
    match run_git_safe_refs(&["diff"], &[], &[&diff_arg], worktree_path).await {
        Ok(stdout) => Ok(stdout),
        Err(_) => {
            // Fallback for root commits
            Ok(run_git_quiet(&["diff-tree", "--root", "-p", commit_sha], worktree_path).await)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_changed_files_numstat() {
        // Test parse_stat_line since that's the numstat parser
        let output = "3 files changed, 5 insertions(+), 3 deletions(-)";
        let stats = parse_stat_line(output);
        assert_eq!(stats.files_changed, 3);
        assert_eq!(stats.insertions, 5);
        assert_eq!(stats.deletions, 3);
    }

    #[test]
    fn test_parse_stat_line_insertions_only() {
        let output = "1 file changed, 10 insertions(+)";
        let stats = parse_stat_line(output);
        assert_eq!(stats.files_changed, 1);
        assert_eq!(stats.insertions, 10);
        assert_eq!(stats.deletions, 0);
    }
}
