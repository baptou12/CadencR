//! `git stash list` orchestration for the Git-tab Stashes view.
//!
//! A single `git stash list --first-parent --numstat` call yields, for every
//! stash, its SHA, reflog selector, description, creation date *and* the
//! numstat block — all in one git invocation. `--first-parent` is what makes
//! the numstat meaningful: a stash is a merge commit (HEAD + index [+ untracked
//! parent]), and plain `--numstat` emits nothing for a merge. Following the
//! first parent diffs `<sha>^1..<sha>` — the exact same range the diff viewer
//! opens on click (via the shared `commit_sha` path) — so the row summary and
//! the diff it expands to can never disagree.

use std::path::Path;

use crate::domain::git::models::StashEntry;
use crate::error::AppError;
use crate::shared::git_cli::run_git;

use super::changed_files::parse_numstat;

/// Record separator emitted before every stash; field separator between the
/// `--format` placeholders. Both are control bytes that can't appear in stash
/// metadata, so splitting on them is unambiguous. Fields: full SHA (`%H`),
/// reflog selector (`%gd` → `stash@{0}`), reflog subject (`%gs`, the stash
/// description) and the strict ISO-8601 committer date (`%cI`). The trailing
/// `%x1f` is what lets us peel the `--numstat` block (which git appends *after*
/// the formatted output) off into its own field.
const FORMAT: &str = "%x1e%H%x1f%gd%x1f%gs%x1f%cI%x1f";

/// Sum a `git diff --numstat` block into `(files_changed, additions, deletions)`.
/// Binary files (numstat `-`) contribute a changed file but zero line counts,
/// matching [`parse_numstat`].
fn sum_numstat(numstat: &str) -> (i32, i32, i32) {
    let map = parse_numstat(numstat);
    let files = map.len() as i32;
    let (adds, dels) = map
        .values()
        .fold((0, 0), |(a, d), (ai, di)| (a + ai, d + di));
    (files, adds, dels)
}

/// Parse `git stash list --numstat --format=<FORMAT>` output into `StashEntry`
/// rows in git's native order (newest stash first). Field 4 (after the format's
/// closing separator) holds the trailing numstat block.
fn parse_stashes(output: &str) -> Vec<StashEntry> {
    output
        .split('\x1e')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|record| {
            let f: Vec<&str> = record.split('\x1f').collect();
            if f.len() < 5 {
                return None;
            }
            let (files_changed, additions, deletions) = sum_numstat(f[4]);
            Some(StashEntry {
                sha: f[0].trim().to_string(),
                ref_name: f[1].trim().to_string(),
                message: f[2].trim().to_string(),
                date: f[3].trim().to_string(),
                files_changed,
                additions,
                deletions,
            })
        })
        .collect()
}

/// List all stashes with a per-stash numstat summary, newest first.
pub async fn list_stashes(repo_path: &Path) -> Result<Vec<StashEntry>, AppError> {
    let format_arg = format!("--format={FORMAT}");
    let stdout = run_git(
        &["stash", "list", "--first-parent", "--numstat", &format_arg],
        repo_path,
    )
    .await?;
    Ok(parse_stashes(&stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_stashes_multiple_entries_with_numstat() {
        let output = "\x1eabc123\x1fstash@{0}\x1fWIP on main: 1234 subject\x1f2024-01-02T03:04:05+00:00\x1f\n10\t2\tsrc/a.rs\n\x1edef456\x1fstash@{1}\x1fOn main: my work\x1f2024-01-01T00:00:00+00:00\x1f\n3\t4\tsrc/b.rs\n1\t0\tsrc/c.rs\n";
        let rows = parse_stashes(output);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].sha, "abc123");
        assert_eq!(rows[0].ref_name, "stash@{0}");
        assert_eq!(rows[0].message, "WIP on main: 1234 subject");
        assert_eq!(rows[0].date, "2024-01-02T03:04:05+00:00");
        assert_eq!(
            (rows[0].files_changed, rows[0].additions, rows[0].deletions),
            (1, 10, 2)
        );
        assert_eq!(rows[1].ref_name, "stash@{1}");
        assert_eq!(rows[1].message, "On main: my work");
        assert_eq!(
            (rows[1].files_changed, rows[1].additions, rows[1].deletions),
            (2, 4, 4)
        );
    }

    #[test]
    fn parse_stashes_empty() {
        assert!(parse_stashes("").is_empty());
        assert!(parse_stashes("   \n ").is_empty());
    }

    #[test]
    fn parse_stashes_skips_malformed_record() {
        // Missing the trailing numstat field — not enough to build an entry.
        let output = "\x1eabc123\x1fstash@{0}\x1fmsg";
        assert!(parse_stashes(output).is_empty());
    }

    #[test]
    fn sum_numstat_totals_lines_and_files() {
        let numstat = "10\t2\tsrc/a.rs\n3\t4\tsrc/b.rs\n";
        assert_eq!(sum_numstat(numstat), (2, 13, 6));
    }

    #[test]
    fn sum_numstat_binary_counts_file_not_lines() {
        let numstat = "-\t-\tassets/logo.png\n5\t1\tsrc/a.rs\n";
        assert_eq!(sum_numstat(numstat), (2, 5, 1));
    }

    #[test]
    fn sum_numstat_empty() {
        assert_eq!(sum_numstat(""), (0, 0, 0));
    }

    /// End-to-end against real git: two stashes must be listed newest-first
    /// with their reflog selector, description and numstat summary — all from
    /// the single `git stash list --first-parent --numstat` call.
    #[tokio::test]
    async fn list_stashes_reports_entries_with_numstat() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        run_git(&["init", "-q", "-b", "main"], path).await.unwrap();
        run_git(&["config", "user.email", "t@example.com"], path)
            .await
            .unwrap();
        run_git(&["config", "user.name", "T"], path).await.unwrap();
        run_git(&["config", "commit.gpgsign", "false"], path)
            .await
            .unwrap();

        // Base commit so stashes have a parent to diff against.
        tokio::fs::write(path.join("a.txt"), "1\n2\n3\n")
            .await
            .unwrap();
        run_git(&["add", "."], path).await.unwrap();
        run_git(&["commit", "-q", "-m", "base"], path)
            .await
            .unwrap();

        // First stash: modify a.txt.
        tokio::fs::write(path.join("a.txt"), "1\n2\n3\n4\n")
            .await
            .unwrap();
        run_git(&["stash", "push", "-m", "first"], path)
            .await
            .unwrap();

        // Second stash: add a new tracked file.
        tokio::fs::write(path.join("b.txt"), "x\ny\n")
            .await
            .unwrap();
        run_git(&["add", "b.txt"], path).await.unwrap();
        run_git(&["stash", "push", "-m", "second"], path)
            .await
            .unwrap();

        let stashes = list_stashes(path).await.unwrap();
        assert_eq!(stashes.len(), 2);

        // Newest first: stash@{0} is the "second" stash.
        assert_eq!(stashes[0].ref_name, "stash@{0}");
        assert!(stashes[0].message.contains("second"), "{:?}", stashes[0]);
        assert_eq!(stashes[0].files_changed, 1);
        assert_eq!(stashes[0].additions, 2);
        assert!(!stashes[0].sha.is_empty());
        assert!(!stashes[0].date.is_empty());

        assert_eq!(stashes[1].ref_name, "stash@{1}");
        assert!(stashes[1].message.contains("first"));
        assert_eq!(stashes[1].files_changed, 1);
        assert_eq!(stashes[1].additions, 1);
    }

    #[tokio::test]
    async fn list_stashes_empty_when_no_stashes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        run_git(&["init", "-q", "-b", "main"], path).await.unwrap();
        run_git(&["config", "user.email", "t@example.com"], path)
            .await
            .unwrap();
        run_git(&["config", "user.name", "T"], path).await.unwrap();
        run_git(&["config", "commit.gpgsign", "false"], path)
            .await
            .unwrap();
        tokio::fs::write(path.join("a.txt"), "1\n").await.unwrap();
        run_git(&["add", "."], path).await.unwrap();
        run_git(&["commit", "-q", "-m", "base"], path)
            .await
            .unwrap();

        assert!(list_stashes(path).await.unwrap().is_empty());
    }
}
