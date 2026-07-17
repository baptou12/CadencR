//! `git diff --name-status` + `--numstat` parsing and the staged/unstaged
//! merge that produces `Vec<ChangedFile>`. Used by both the branch-mode
//! and worktree-mode change listings.

use std::collections::HashMap;
use std::path::Path;

use crate::domain::git::models::{ChangedFile, FileStageState};
use crate::domain::git::porcelain::{attach_stats, parse_porcelain_v2_entries, PorcelainFileEntry};
use crate::error::AppError;
use crate::shared::git_cli::run_git_background;

/// Get list of changed files with per-file stats.
///
/// In `worktree` / `uncommitted` mode the result combines three sources:
/// staged (`git diff --cached`), unstaged (`git diff`), and untracked
/// (`git ls-files --others --exclude-standard`). Files appearing in both
/// staged and unstaged appear once with `is_staged: true` and stats summed.
/// In `branch` mode we run a single `target...HEAD` diff and `is_staged`
/// is always `false`.
pub async fn get_changed_files(
    worktree_path: &Path,
    mode: &str,
    target_branch: Option<&str>,
    commit_sha: Option<&str>,
) -> Result<Vec<ChangedFile>, AppError> {
    if let Some(sha) = commit_sha {
        return get_commit_changed_files(worktree_path, sha).await;
    }
    if mode == "worktree" || mode == "uncommitted" {
        return get_uncommitted_changed_files(worktree_path).await;
    }

    let branch = target_branch.unwrap_or("main");
    crate::shared::git_cli::guard_positionals(&[branch])?;
    let diff_arg = format!("{branch}...HEAD");

    let name_status_args = ["diff", "--name-status", diff_arg.as_str()];
    let numstat_args = ["diff", "--numstat", diff_arg.as_str()];
    let (name_status, numstat) = tokio::try_join!(
        run_git_background(&name_status_args, worktree_path),
        run_git_background(&numstat_args, worktree_path),
    )?;

    let name_status = name_status.trim();
    if name_status.is_empty() {
        return Ok(vec![]);
    }
    let stat_map = parse_numstat(&numstat);
    Ok(parse_name_status_with_stats(
        name_status,
        &stat_map,
        FileStageState::NotApplicable,
    ))
}

/// Changed-file list for a single commit (`sha^..sha`). Uses `diff-tree` so
/// root commits (no parent) diff cleanly against the empty tree instead of
/// failing on an unresolvable `sha^`. `is_staged` is always `false`.
async fn get_commit_changed_files(
    worktree_path: &Path,
    sha: &str,
) -> Result<Vec<ChangedFile>, AppError> {
    crate::shared::git_cli::guard_positionals(&[sha])?;
    // `-M` enables rename detection so a rename shows as one `R*` entry (with
    // `old_file`) instead of an add + delete pair — matching `git diff` and
    // letting the per-file diff scope both paths for rename detection.
    let name_status_args = [
        "diff-tree",
        "--no-commit-id",
        "-M",
        "--name-status",
        "-r",
        sha,
    ];
    let numstat_args = ["diff-tree", "--no-commit-id", "-M", "--numstat", "-r", sha];
    let (name_status, numstat) = tokio::try_join!(
        run_git_background(&name_status_args, worktree_path),
        run_git_background(&numstat_args, worktree_path),
    )?;

    let name_status = name_status.trim();
    if name_status.is_empty() {
        return Ok(vec![]);
    }
    let stat_map = parse_numstat(&numstat);
    Ok(parse_name_status_with_stats(
        name_status,
        &stat_map,
        FileStageState::NotApplicable,
    ))
}

/// Combine staged, unstaged and untracked into a single list of `ChangedFile`.
async fn get_uncommitted_changed_files(worktree_path: &Path) -> Result<Vec<ChangedFile>, AppError> {
    Ok(get_uncommitted_entries(worktree_path)
        .await?
        .into_iter()
        .map(|entry| ChangedFile {
            file: entry.path,
            status: entry.status_code,
            old_file: entry.old_path,
            additions: entry.additions,
            deletions: entry.deletions,
            is_staged: entry.stage_state.is_staged(),
            stage_state: entry.stage_state,
            conflict_kind: entry.conflict_kind,
        })
        .collect())
}

pub(crate) async fn get_uncommitted_entries(
    worktree_path: &Path,
) -> Result<Vec<PorcelainFileEntry>, AppError> {
    let (porcelain, staged_num, unstaged_num) = tokio::try_join!(
        run_git_background(&["status", "--porcelain=v2", "-z"], worktree_path),
        run_git_background(&["diff", "--cached", "--numstat", "-z"], worktree_path),
        run_git_background(&["diff", "--numstat", "-z"], worktree_path),
    )?;
    let staged_stats = parse_numstat(&staged_num);
    let unstaged_stats = parse_numstat(&unstaged_num);

    Ok(parse_porcelain_v2_entries(&porcelain)
        .into_iter()
        .map(|entry| attach_stats(entry, &staged_stats, &unstaged_stats))
        .collect())
}

pub(crate) fn parse_numstat(numstat: &str) -> HashMap<String, (i32, i32)> {
    if numstat.contains('\0') {
        return parse_numstat_z(numstat);
    }
    let mut stat_map: HashMap<String, (i32, i32)> = HashMap::new();
    for line in numstat.trim().lines().filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 3 {
            let additions = if parts[0] == "-" {
                0
            } else {
                parts[0].parse().unwrap_or(0)
            };
            let deletions = if parts[1] == "-" {
                0
            } else {
                parts[1].parse().unwrap_or(0)
            };
            stat_map.insert(parts[2].to_string(), (additions, deletions));
        }
    }
    stat_map
}

fn parse_numstat_z(numstat: &str) -> HashMap<String, (i32, i32)> {
    let mut stat_map = HashMap::new();
    let mut records = numstat.split_terminator('\0');
    while let Some(record) = records.next() {
        let mut fields = record.splitn(3, '\t');
        let Some(additions) = fields.next().and_then(parse_numstat_value) else {
            continue;
        };
        let Some(deletions) = fields.next().and_then(parse_numstat_value) else {
            continue;
        };
        let Some(path) = fields.next() else {
            continue;
        };
        let path = if path.is_empty() {
            let _old_path = records.next();
            records.next().unwrap_or_default()
        } else {
            path
        };
        if !path.is_empty() {
            stat_map.insert(path.to_string(), (additions, deletions));
        }
    }
    stat_map
}

fn parse_numstat_value(value: &str) -> Option<i32> {
    if value == "-" {
        Some(0)
    } else {
        value.parse().ok()
    }
}

fn parse_name_status_with_stats(
    name_status: &str,
    stat_map: &HashMap<String, (i32, i32)>,
    stage_state: FileStageState,
) -> Vec<ChangedFile> {
    let mut files = vec![];
    for line in name_status.lines().filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.is_empty() {
            continue;
        }
        let status_code = parts[0];
        let (file, old_file) = if status_code.starts_with('R') || status_code.starts_with('C') {
            if parts.len() >= 3 {
                (parts[2].to_string(), Some(parts[1].to_string()))
            } else {
                continue;
            }
        } else if parts.len() >= 2 {
            (parts[1].to_string(), None)
        } else {
            continue;
        };

        let (additions, deletions) = stat_map
            .get(&file)
            .or_else(|| {
                old_file
                    .as_ref()
                    .and_then(|old| stat_map.get(&format!("{old} => {file}")))
            })
            .copied()
            .unwrap_or((0, 0));

        files.push(ChangedFile {
            file,
            status: status_code.to_string(),
            old_file,
            additions,
            deletions,
            is_staged: stage_state.is_staged(),
            stage_state,
            conflict_kind: None,
        });
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_name_status_marks_is_staged_flag() {
        let stats: HashMap<String, (i32, i32)> =
            [("a.rs".to_string(), (3, 1))].into_iter().collect();
        let staged = parse_name_status_with_stats("M\ta.rs\n", &stats, FileStageState::Staged);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].file, "a.rs");
        assert_eq!(staged[0].status, "M");
        assert!(staged[0].is_staged);
        assert_eq!(staged[0].additions, 3);
        assert_eq!(staged[0].deletions, 1);

        let unstaged = parse_name_status_with_stats("M\ta.rs\n", &stats, FileStageState::Unstaged);
        assert!(!unstaged[0].is_staged);
    }

    #[test]
    fn parse_name_status_handles_renames() {
        let stats: HashMap<String, (i32, i32)> = [("old.rs => new.rs".to_string(), (0, 0))]
            .into_iter()
            .collect();
        let cf = parse_name_status_with_stats(
            "R100\told.rs\tnew.rs\n",
            &stats,
            FileStageState::Unstaged,
        );
        assert_eq!(cf.len(), 1);
        assert_eq!(cf[0].file, "new.rs");
        assert_eq!(cf[0].old_file.as_deref(), Some("old.rs"));
        assert!(cf[0].status.starts_with('R'));
    }

    #[test]
    fn parse_numstat_handles_nul_delimited_rename_paths() {
        let stats = parse_numstat("3\t1\t\0src/old.rs\0src/new.rs\0");
        assert_eq!(stats.get("src/new.rs"), Some(&(3, 1)));
    }

    fn git(repo: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("HOME", repo)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init(repo: &Path) {
        for args in [
            &["init", "-q", "-b", "main"][..],
            &["config", "user.email", "test@example.com"],
            &["config", "user.name", "Test"],
            &["config", "commit.gpgsign", "false"],
        ] {
            git(repo, args);
        }
        for path in ["staged", "unstaged", "both", "old", "deleted"] {
            std::fs::write(repo.join(path), b"base\n").unwrap();
        }
        git(repo, &["add", "."]);
        git(repo, &["commit", "-q", "-m", "seed"]);
    }

    fn find<'a>(files: &'a [ChangedFile], path: &str) -> &'a ChangedFile {
        files.iter().find(|file| file.file == path).unwrap()
    }

    #[tokio::test]
    async fn real_worktree_rows_share_canonical_state_and_rename_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        init(repo);
        std::fs::write(repo.join("staged"), b"staged\n").unwrap();
        git(repo, &["add", "staged"]);
        std::fs::write(repo.join("unstaged"), b"unstaged\n").unwrap();
        std::fs::write(repo.join("both"), b"index\n").unwrap();
        git(repo, &["add", "both"]);
        std::fs::write(repo.join("both"), b"worktree\n").unwrap();
        git(repo, &["mv", "old", "new"]);
        std::fs::remove_file(repo.join("deleted")).unwrap();
        std::fs::write(repo.join("untracked"), b"new\n").unwrap();

        let files = get_uncommitted_changed_files(repo).await.unwrap();

        assert_eq!(find(&files, "staged").stage_state, FileStageState::Staged);
        assert_eq!(
            find(&files, "unstaged").stage_state,
            FileStageState::Unstaged
        );
        assert_eq!(find(&files, "both").stage_state, FileStageState::Both);
        assert_eq!(
            find(&files, "untracked").stage_state,
            FileStageState::Untracked
        );
        assert_eq!(find(&files, "deleted").status, "D");
        let renamed = find(&files, "new");
        assert_eq!(renamed.old_file.as_deref(), Some("old"));
        assert!(renamed.status.starts_with('R'));
    }

    #[tokio::test]
    async fn unmerged_path_has_one_row_and_non_duplicated_stats() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        init(repo);
        git(repo, &["checkout", "-q", "-b", "other"]);
        std::fs::write(repo.join("both"), b"other\n").unwrap();
        git(repo, &["commit", "-qam", "other"]);
        git(repo, &["checkout", "-q", "main"]);
        std::fs::write(repo.join("both"), b"main\n").unwrap();
        git(repo, &["commit", "-qam", "main"]);
        let merge = std::process::Command::new("git")
            .args(["merge", "other"])
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(!merge.status.success());

        let staged = run_git_background(&["diff", "--cached", "--numstat"], repo)
            .await
            .unwrap();
        let unstaged = run_git_background(&["diff", "--numstat"], repo)
            .await
            .unwrap();
        let staged_stats = parse_numstat(&staged).get("both").copied();
        let unstaged_stats = parse_numstat(&unstaged).get("both").copied();
        let expected_stats = staged_stats.or(unstaged_stats).unwrap_or_default();
        let files = get_uncommitted_changed_files(repo).await.unwrap();
        let conflicts: Vec<_> = files.iter().filter(|file| file.file == "both").collect();

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].stage_state, FileStageState::Conflicted);
        assert_eq!(conflicts[0].additions, expected_stats.0);
        assert_eq!(conflicts[0].deletions, expected_stats.1);
    }

    #[tokio::test]
    async fn nested_rename_uses_machine_readable_numstat_path() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        init(repo);
        std::fs::create_dir(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/old.rs"), b"one\ntwo\nthree\n").unwrap();
        git(repo, &["add", "src/old.rs"]);
        git(repo, &["commit", "-q", "-m", "nested"]);
        git(repo, &["mv", "src/old.rs", "src/new.rs"]);
        std::fs::write(repo.join("src/new.rs"), b"one\ntwo\nthree\nfour\n").unwrap();

        let files = get_uncommitted_changed_files(repo).await.unwrap();
        let renamed = find(&files, "src/new.rs");

        assert_eq!(renamed.old_file.as_deref(), Some("src/old.rs"));
        assert_eq!(renamed.additions, 1);
        assert_eq!(renamed.deletions, 0);
    }
}
