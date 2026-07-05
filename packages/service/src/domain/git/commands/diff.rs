//! `git diff` / `git diff --stat` orchestration plus the unified-diff
//! emission for untracked files. Spans both `branch` and `worktree`/
//! `uncommitted` modes; the ws/HTTP handlers pick the mode.

use std::path::Path;

use crate::domain::git::file_size::LARGE_FILE_BYTES;
use crate::domain::git::models::GitStats;
use crate::error::AppError;
use crate::shared::git_cli::run_git_safe_refs;

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

    // Count untracked files
    for file in untracked.trim().lines().filter(|l| !l.is_empty()) {
        let full_path = worktree_path.join(file);
        if let Ok(content) = tokio::fs::read_to_string(&full_path).await {
            let line_count = content.lines().count();
            // Match TS: if file ends without newline, last line still counts
            let line_count = if !content.is_empty() && !content.ends_with('\n') {
                line_count
            } else if content.is_empty() {
                0
            } else {
                line_count
            };
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
    // untracked file is bounded per-file (see below) so a giant generated file
    // can't blow up the aggregate response.
    for file in untracked_list.trim().lines().filter(|l| !l.is_empty()) {
        if let Some(block) = synthesize_untracked_new_file_diff(worktree_path, file).await {
            result.push_str(&block);
        }
    }

    Ok(result)
}

/// Build the synthetic "new file" unified diff for a single untracked file,
/// bounding the cost: a file at or above [`LARGE_FILE_BYTES`] is represented by
/// a short placeholder instead of being read fully into memory and inlined
/// (the diff view gates such files behind a placeholder anyway, and shipping +
/// JSON-parsing a multi-MB string on the main thread is the exact storm we're
/// avoiding). Non-UTF-8 (binary) files under the threshold are skipped, which
/// matches the previous behaviour. Returns `None` when nothing should be
/// emitted for the file (unreadable or binary).
async fn synthesize_untracked_new_file_diff(worktree_path: &Path, file: &str) -> Option<String> {
    let full_path = worktree_path.join(file);
    let metadata = tokio::fs::metadata(&full_path).await.ok()?;
    if metadata.len() >= LARGE_FILE_BYTES {
        let size = format_bytes(metadata.len());
        return Some(format!(
            "diff --git a/{file} b/{file}\nnew file mode 100644\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,1 @@\n+(untracked file too large to display inline: {size} — open it from the editor)\n"
        ));
    }

    let content = tokio::fs::read_to_string(&full_path).await.ok()?;
    let mut lines: Vec<&str> = content.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let line_count = lines.len();
    let added_lines: String = lines
        .iter()
        .map(|l| format!("+{l}"))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "diff --git a/{file} b/{file}\nnew file mode 100644\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{line_count} @@\n{added_lines}\n"
    ))
}

/// Human-readable byte count for placeholder messages. Mirrors the frontend's
/// `formatBytes` (`lib/diff-thresholds.ts`) so the two read the same.
fn format_bytes(n: u64) -> String {
    if n < 1024 {
        format!("{n} B")
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else {
        format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
    }
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

    #[tokio::test]
    async fn synthesize_small_untracked_file_inlines_full_content() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("hello.txt"), "line1\nline2\n").unwrap();

        let block = synthesize_untracked_new_file_diff(dir.path(), "hello.txt")
            .await
            .expect("small file is synthesized");
        assert!(block.contains("diff --git a/hello.txt b/hello.txt"));
        assert!(block.contains("@@ -0,0 +1,2 @@"));
        assert!(block.contains("+line1"));
        assert!(block.contains("+line2"));
    }

    #[tokio::test]
    async fn synthesize_large_untracked_file_is_capped_not_inlined() {
        let dir = tempfile::tempdir().unwrap();
        // A file comfortably past the large-file threshold.
        let big = "x\n".repeat(LARGE_FILE_BYTES as usize); // ~2x threshold in bytes
        std::fs::write(dir.path().join("big.log"), &big).unwrap();

        let block = synthesize_untracked_new_file_diff(dir.path(), "big.log")
            .await
            .expect("large file still appears in the diff");
        // The file is present in the list…
        assert!(block.contains("diff --git a/big.log b/big.log"));
        // …but its content is NOT inlined — the block is a bounded placeholder,
        // not a multi-MB string of `+x` lines.
        assert!(block.contains("too large to display inline"));
        assert!(
            block.len() < LARGE_FILE_BYTES as usize,
            "capped block must be far smaller than the file ({} bytes)",
            block.len()
        );
        assert!(
            !block.contains("+x\n+x"),
            "large content must not be inlined"
        );
    }

    #[tokio::test]
    async fn synthesize_binary_untracked_file_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        // Small but non-UTF-8: read_to_string fails, so it's skipped (parity
        // with the previous behaviour — binary untracked files aren't inlined).
        std::fs::write(dir.path().join("blob.bin"), [0u8, 159, 146, 150]).unwrap();

        let block = synthesize_untracked_new_file_diff(dir.path(), "blob.bin").await;
        assert!(block.is_none());
    }

    #[test]
    fn format_bytes_reads_like_the_frontend() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(2048), "2.0 KB");
        assert_eq!(format_bytes(3 * 1024 * 1024), "3.0 MB");
    }
}
