//! `git diff --name-status` + `--numstat` parsing and the staged/unstaged
//! merge that produces `Vec<ChangedFile>`. Used by both the branch-mode
//! and worktree-mode change listings.

use std::collections::HashMap;
use std::path::Path;

use crate::domain::git::models::ChangedFile;
use crate::error::AppError;

use super::util::run_git_quiet;

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
) -> Result<Vec<ChangedFile>, AppError> {
    if mode == "worktree" || mode == "uncommitted" {
        return get_uncommitted_changed_files(worktree_path).await;
    }

    let branch = target_branch.unwrap_or("main");
    crate::shared::git_cli::guard_positionals(&[branch])?;
    let diff_arg = format!("{branch}...HEAD");

    let name_status_args = ["diff", "--name-status", diff_arg.as_str()];
    let numstat_args = ["diff", "--numstat", diff_arg.as_str()];
    let (name_status, numstat) = tokio::join!(
        run_git_quiet(&name_status_args, worktree_path),
        run_git_quiet(&numstat_args, worktree_path),
    );

    let name_status = name_status.trim();
    if name_status.is_empty() {
        return Ok(vec![]);
    }
    let stat_map = parse_numstat(&numstat);
    Ok(parse_name_status_with_stats(
        name_status,
        &stat_map,
        /* is_staged */ false,
    ))
}

/// Combine staged, unstaged and untracked into a single list of `ChangedFile`.
async fn get_uncommitted_changed_files(worktree_path: &Path) -> Result<Vec<ChangedFile>, AppError> {
    let (staged_ns, staged_num, unstaged_ns, unstaged_num, untracked) = tokio::join!(
        run_git_quiet(&["diff", "--cached", "--name-status"], worktree_path),
        run_git_quiet(&["diff", "--cached", "--numstat"], worktree_path),
        run_git_quiet(&["diff", "--name-status"], worktree_path),
        run_git_quiet(&["diff", "--numstat"], worktree_path),
        run_git_quiet(
            &["ls-files", "--others", "--exclude-standard"],
            worktree_path
        ),
    );

    let staged = parse_name_status_with_stats(
        staged_ns.trim(),
        &parse_numstat(&staged_num),
        /* is_staged */ true,
    );
    let unstaged = parse_name_status_with_stats(
        unstaged_ns.trim(),
        &parse_numstat(&unstaged_num),
        /* is_staged */ false,
    );

    // Merge: keyed by `file` (post-rename for `R*` / `C*` entries). When the
    // same path has both staged and unstaged changes we keep one entry,
    // mark `is_staged = true`, and sum the stats so the UI reports the full
    // delta the user is about to review.
    let mut merged: std::collections::BTreeMap<String, ChangedFile> =
        std::collections::BTreeMap::new();
    for cf in staged.into_iter().chain(unstaged.into_iter()) {
        merge_changed_file(&mut merged, cf);
    }

    let mut out: Vec<ChangedFile> = merged.into_values().collect();

    // Untracked files are synthesized as new-file entries. We don't ask git
    // for stats here (numstat doesn't cover untracked); leave (0, 0) — the
    // diff endpoint computes the real line count when the user opens it.
    for path in untracked.lines().filter(|l| !l.is_empty()) {
        out.push(ChangedFile {
            file: path.to_string(),
            status: "A".to_string(),
            old_file: None,
            additions: 0,
            deletions: 0,
            is_staged: false,
        });
    }

    Ok(out)
}

fn merge_changed_file(out: &mut std::collections::BTreeMap<String, ChangedFile>, cf: ChangedFile) {
    match out.get_mut(&cf.file) {
        Some(existing) => {
            existing.additions += cf.additions;
            existing.deletions += cf.deletions;
            existing.is_staged = existing.is_staged || cf.is_staged;
            // Prefer the more-informative status (rename/copy carry the
            // old_file). If either side has `R*`/`C*`, keep it.
            if existing.old_file.is_none() && cf.old_file.is_some() {
                existing.status = cf.status;
                existing.old_file = cf.old_file;
            }
        }
        None => {
            out.insert(cf.file.clone(), cf);
        }
    }
}

pub fn parse_numstat(numstat: &str) -> HashMap<String, (i32, i32)> {
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

fn parse_name_status_with_stats(
    name_status: &str,
    stat_map: &HashMap<String, (i32, i32)>,
    is_staged: bool,
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
            is_staged,
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
        let staged = parse_name_status_with_stats("M\ta.rs\n", &stats, true);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].file, "a.rs");
        assert_eq!(staged[0].status, "M");
        assert!(staged[0].is_staged);
        assert_eq!(staged[0].additions, 3);
        assert_eq!(staged[0].deletions, 1);

        let unstaged = parse_name_status_with_stats("M\ta.rs\n", &stats, false);
        assert!(!unstaged[0].is_staged);
    }

    #[test]
    fn parse_name_status_handles_renames() {
        let stats: HashMap<String, (i32, i32)> = [("old.rs => new.rs".to_string(), (0, 0))]
            .into_iter()
            .collect();
        let cf = parse_name_status_with_stats("R100\told.rs\tnew.rs\n", &stats, false);
        assert_eq!(cf.len(), 1);
        assert_eq!(cf[0].file, "new.rs");
        assert_eq!(cf[0].old_file.as_deref(), Some("old.rs"));
        assert!(cf[0].status.starts_with('R'));
    }

    #[test]
    fn merge_changed_file_combines_staged_and_unstaged() {
        let mut out: std::collections::BTreeMap<String, ChangedFile> =
            std::collections::BTreeMap::new();
        merge_changed_file(
            &mut out,
            ChangedFile {
                file: "x.rs".into(),
                status: "M".into(),
                old_file: None,
                additions: 2,
                deletions: 1,
                is_staged: true,
            },
        );
        merge_changed_file(
            &mut out,
            ChangedFile {
                file: "x.rs".into(),
                status: "M".into(),
                old_file: None,
                additions: 4,
                deletions: 0,
                is_staged: false,
            },
        );
        assert_eq!(out.len(), 1);
        let merged = out.get("x.rs").unwrap();
        assert!(merged.is_staged, "staged side wins the OR");
        assert_eq!(merged.additions, 6);
        assert_eq!(merged.deletions, 1);
    }

    #[test]
    fn merge_changed_file_prefers_rename_metadata() {
        // If one side recorded the rename and the other didn't, keep the
        // rename-aware status + old_file.
        let mut out: std::collections::BTreeMap<String, ChangedFile> =
            std::collections::BTreeMap::new();
        merge_changed_file(
            &mut out,
            ChangedFile {
                file: "new.rs".into(),
                status: "M".into(),
                old_file: None,
                additions: 0,
                deletions: 0,
                is_staged: false,
            },
        );
        merge_changed_file(
            &mut out,
            ChangedFile {
                file: "new.rs".into(),
                status: "R100".into(),
                old_file: Some("old.rs".into()),
                additions: 0,
                deletions: 0,
                is_staged: true,
            },
        );
        let merged = out.get("new.rs").unwrap();
        assert_eq!(merged.status, "R100");
        assert_eq!(merged.old_file.as_deref(), Some("old.rs"));
        assert!(merged.is_staged);
    }
}
