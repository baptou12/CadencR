use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::domain::git::models::{
    ChangedFile, CommitLogEntry, GitStats, MergeConflictResult, MergeResult, WorktreeInfo,
};
use crate::error::AppError;
use crate::shared::git_cli::run_git;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Run a git command, returning Ok("") instead of Err on failure.
async fn run_git_quiet(args: &[&str], cwd: &Path) -> String {
    run_git(args, cwd).await.unwrap_or_default()
}

/// Parse git diff --stat summary line.
fn parse_stat_line(output: &str) -> GitStats {
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

const LOG_RS: char = '\x1e';

fn parse_git_log(output: &str) -> Vec<CommitLogEntry> {
    if output.trim().is_empty() {
        return vec![];
    }

    let mut commits = vec![];
    for entry in output.trim().split(LOG_RS).filter(|s| !s.is_empty()) {
        let lines: Vec<&str> = entry.trim().lines().collect();
        if lines.len() < 5 {
            continue;
        }
        commits.push(CommitLogEntry {
            sha: lines[0].to_string(),
            short_sha: lines[1].to_string(),
            message: lines[2].to_string(),
            author: lines[3].to_string(),
            date: lines[4].to_string(),
            body: lines[5..].join("\n").trim().to_string(),
            is_pushed: true,
        });
    }
    commits
}

/// Determine which SHAs have NOT been pushed to the remote.
/// Returns None if all commits are unpushed (no remote tracking).
async fn get_unpushed_shas(repo_path: &Path, branch_name: &str) -> Option<HashSet<String>> {
    let cmd = format!("origin/{branch_name}..HEAD");
    match run_git(&["rev-list", &cmd], repo_path).await {
        Ok(stdout) => Some(
            stdout
                .trim()
                .lines()
                .filter(|l| !l.is_empty())
                .map(|s| s.to_string())
                .collect(),
        ),
        Err(_) => None, // No remote tracking — treat all as unpushed
    }
}

fn apply_pushed_status(commits: &mut [CommitLogEntry], unpushed: Option<&HashSet<String>>) {
    for c in commits.iter_mut() {
        c.is_pushed = match unpushed {
            None => false,
            Some(set) => !set.contains(&c.sha),
        };
    }
}

// ---------------------------------------------------------------------------
// Public git command functions
// ---------------------------------------------------------------------------

/// Get the current branch name. Returns None on error (detached HEAD, not a repo).
pub async fn get_current_branch(repo_path: &Path) -> Result<Option<String>, AppError> {
    match run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path).await {
        Ok(stdout) => {
            let branch = stdout.trim().to_string();
            Ok(if branch.is_empty() { None } else { Some(branch) })
        }
        Err(_) => Ok(None),
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

    for file in untracked_list.trim().lines().filter(|l| !l.is_empty()) {
        let full_path = worktree_path.join(file);
        if let Ok(content) = tokio::fs::read_to_string(&full_path).await {
            let mut lines: Vec<&str> = content.split('\n').collect();
            if lines.last() == Some(&"") {
                lines.pop();
            }
            let line_count = lines.len();
            let added_lines: String = lines.iter().map(|l| format!("+{l}")).collect::<Vec<_>>().join("\n");
            result.push_str(&format!(
                "diff --git a/{file} b/{file}\nnew file mode 100644\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{line_count} @@\n{added_lines}\n"
            ));
        }
    }

    Ok(result)
}

/// Get the diff for a specific commit.
pub async fn get_commit_diff(worktree_path: &Path, commit_sha: &str) -> Result<String, AppError> {
    let diff_arg = format!("{commit_sha}^..{commit_sha}");
    match run_git(&["diff", &diff_arg], worktree_path).await {
        Ok(stdout) => Ok(stdout),
        Err(_) => {
            // Fallback for root commits
            Ok(run_git_quiet(&["diff-tree", "--root", "-p", commit_sha], worktree_path).await)
        }
    }
}

/// Get list of changed files with per-file stats.
pub async fn get_changed_files(
    worktree_path: &Path,
    mode: &str,
    target_branch: Option<&str>,
) -> Result<Vec<ChangedFile>, AppError> {
    let branch = target_branch.unwrap_or("main");
    let diff_arg = if mode == "worktree" {
        String::new()
    } else {
        format!("{branch}...HEAD")
    };

    let name_status_args: Vec<&str> = if diff_arg.is_empty() {
        vec!["diff", "--name-status"]
    } else {
        vec!["diff", "--name-status", &diff_arg]
    };
    let numstat_args: Vec<&str> = if diff_arg.is_empty() {
        vec!["diff", "--numstat"]
    } else {
        vec!["diff", "--numstat", &diff_arg]
    };
    let (name_status, numstat) = tokio::join!(
        run_git_quiet(&name_status_args, worktree_path),
        run_git_quiet(&numstat_args, worktree_path),
    );

    let name_status = name_status.trim();
    if name_status.is_empty() {
        return Ok(vec![]);
    }

    // Build stat map from numstat
    let mut stat_map: HashMap<String, (i32, i32)> = HashMap::new();
    for line in numstat.trim().lines().filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 3 {
            let additions = if parts[0] == "-" { 0 } else { parts[0].parse().unwrap_or(0) };
            let deletions = if parts[1] == "-" { 0 } else { parts[1].parse().unwrap_or(0) };
            stat_map.insert(parts[2].to_string(), (additions, deletions));
        }
    }

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
        } else {
            if parts.len() >= 2 {
                (parts[1].to_string(), None)
            } else {
                continue;
            }
        };

        let (additions, deletions) = stat_map
            .get(&file)
            .or_else(|| {
                old_file.as_ref().and_then(|old| {
                    stat_map.get(&format!("{old} => {file}"))
                })
            })
            .copied()
            .unwrap_or((0, 0));

        files.push(ChangedFile {
            file,
            status: status_code.to_string(),
            old_file,
            additions,
            deletions,
        });
    }

    Ok(files)
}

/// Get file content at a given ref, or from working tree if ref is None.
pub async fn get_file_content(
    worktree_path: &Path,
    file_path: &str,
    ref_spec: Option<&str>,
) -> Result<String, AppError> {
    match ref_spec {
        None => {
            // Read from working tree
            let full_path = worktree_path.join(file_path);
            Ok(tokio::fs::read_to_string(&full_path).await.unwrap_or_default())
        }
        Some(r) => {
            let show_arg = format!("{r}:{file_path}");
            Ok(run_git_quiet(&["show", &show_arg], worktree_path).await)
        }
    }
}

/// Get file content for multiple files (batch).
pub async fn get_file_content_batch(
    git_path: &Path,
    file_paths: &[String],
    old_ref: &str,
    new_ref: Option<&str>,
) -> Result<HashMap<String, (String, String)>, AppError> {
    if file_paths.is_empty() {
        return Ok(HashMap::new());
    }

    use futures::stream::{self, StreamExt};

    let git_path = git_path.to_path_buf();
    let old_ref = old_ref.to_string();
    let new_ref = new_ref.map(|s| s.to_string());

    let results: Vec<_> = stream::iter(file_paths.to_vec())
        .map(|file_path| {
            let git_path = git_path.clone();
            let old_ref = old_ref.clone();
            let new_ref = new_ref.clone();
            async move {
                let old_content = get_file_content(&git_path, &file_path, Some(&old_ref)).await.unwrap_or_default();
                let new_content = get_file_content(&git_path, &file_path, new_ref.as_deref()).await.unwrap_or_default();
                (file_path, (old_content, new_content))
            }
        })
        .buffer_unordered(20)
        .collect()
        .await;

    Ok(results.into_iter().collect())
}

/// Get commit log for a feature branch relative to a base branch.
pub async fn get_commit_log(
    worktree_path: &Path,
    base_branch: &str,
    branch_name: &str,
) -> Result<Vec<CommitLogEntry>, AppError> {
    let range = format!("{base_branch}..HEAD");
    let format_arg = format!("\x1e%H%n%h%n%s%n%an%n%ai%n%b");
    let stdout = run_git_quiet(
        &["log", &range, &format!("--format={format_arg}"), "--reverse"],
        worktree_path,
    )
    .await;

    let mut commits = parse_git_log(&stdout);
    let unpushed = get_unpushed_shas(worktree_path, branch_name).await;
    apply_pushed_status(&mut commits, unpushed.as_ref());
    Ok(commits)
}

/// Get recent commits on the current branch.
pub async fn get_recent_commits(
    repo_path: &Path,
    branch_name: &str,
    limit: i64,
) -> Result<Vec<CommitLogEntry>, AppError> {
    let format_arg = format!("\x1e%H%n%h%n%s%n%an%n%ai%n%b");
    let limit_arg = format!("-{limit}");
    let stdout = run_git_quiet(
        &["log", &format!("--format={format_arg}"), &limit_arg],
        repo_path,
    )
    .await;

    let mut commits = parse_git_log(&stdout);
    let unpushed = get_unpushed_shas(repo_path, branch_name).await;
    apply_pushed_status(&mut commits, unpushed.as_ref());
    Ok(commits)
}

/// Get blob SHAs for all changed files (worktree + branch changes).
pub async fn get_file_blob_shas(
    worktree_path: &Path,
) -> Result<HashMap<String, String>, AppError> {
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
                run_git_quiet(
                    &["diff", merge_base, "HEAD", "--name-only"],
                    worktree_path,
                )
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
        // Try hash-object first, then rev-parse HEAD:path
        let sha = match run_git(&["hash-object", &file_path], worktree_path).await {
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

/// List all git-tracked files.
pub async fn list_files(worktree_path: &Path) -> Result<Vec<String>, AppError> {
    let stdout = run_git_quiet(&["ls-files"], worktree_path).await;
    Ok(stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect())
}

/// List all worktrees for a repository.
pub async fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>, AppError> {
    let stdout = run_git(&["worktree", "list", "--porcelain"], repo_path).await?;
    Ok(parse_worktree_list(&stdout))
}

fn parse_worktree_list(output: &str) -> Vec<WorktreeInfo> {
    let mut worktrees = vec![];
    let mut path = None;
    let mut head = String::new();
    let mut branch = String::new();
    let mut is_bare = false;

    for line in output.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            // Push previous entry if exists
            if let Some(prev_path) = path.take() {
                worktrees.push(WorktreeInfo {
                    path: prev_path,
                    branch: if branch.is_empty() {
                        "(detached)".to_string()
                    } else {
                        std::mem::take(&mut branch)
                    },
                    head: std::mem::take(&mut head),
                    is_bare,
                });
                is_bare = false;
            }
            path = Some(p.to_string());
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            head = h.to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = b.replace("refs/heads/", "");
        } else if line == "bare" {
            is_bare = true;
        } else if line.is_empty() {
            if let Some(p) = path.take() {
                worktrees.push(WorktreeInfo {
                    path: p,
                    branch: if branch.is_empty() {
                        "(detached)".to_string()
                    } else {
                        std::mem::take(&mut branch)
                    },
                    head: std::mem::take(&mut head),
                    is_bare,
                });
                is_bare = false;
            }
        }
    }

    // Push last entry
    if let Some(p) = path {
        worktrees.push(WorktreeInfo {
            path: p,
            branch: if branch.is_empty() {
                "(detached)".to_string()
            } else {
                branch
            },
            head,
            is_bare,
        });
    }

    worktrees
}

/// Get info for a specific worktree by path.
pub async fn get_worktree_info(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<Option<WorktreeInfo>, AppError> {
    let all = list_worktrees(repo_path).await?;
    // Canonicalize to handle macOS symlinks (/var -> /private/var)
    let canonical = std::fs::canonicalize(worktree_path)
        .unwrap_or_else(|_| worktree_path.to_path_buf());
    let wt_str = canonical.to_string_lossy();
    Ok(all.into_iter().find(|w| {
        let w_canonical = std::fs::canonicalize(&w.path)
            .unwrap_or_else(|_| std::path::PathBuf::from(&w.path));
        w_canonical.to_string_lossy() == wt_str.as_ref()
    }))
}

/// Create a git worktree with a new branch.
/// Places the worktree at ~/.cadence/<project_name>/<safe_branch>.
pub async fn create_worktree(
    repo_path: &Path,
    branch_name: &str,
    project_name: &str,
) -> Result<(String, String), AppError> {
    // Pre-flight: verify repo
    run_git(&["rev-parse", "--git-dir"], repo_path).await.map_err(|_| {
        AppError::BadRequest(format!(
            "Not a git repository: {}. Ensure the project path points to a valid git repo.",
            repo_path.display()
        ))
    })?;

    // Pre-flight: validate branch name
    if branch_name.is_empty() || branch_name.contains(|c: char| " \t~^:?*[\\".contains(c)) {
        return Err(AppError::BadRequest(format!(
            "Invalid branch name: \"{branch_name}\""
        )));
    }

    let safe_branch = branch_name.replace('/', "-");
    let home = dirs::home_dir().ok_or_else(|| AppError::Internal("Cannot determine home directory".into()))?;
    let worktree_path = home.join(".cadence").join(project_name).join(&safe_branch);
    let worktree_str = worktree_path.to_string_lossy().to_string();

    // Check if directory already exists
    if worktree_path.exists() {
        let existing = list_worktrees(repo_path).await?;
        if existing.iter().any(|w| w.path == worktree_str) {
            return Ok((worktree_str, branch_name.to_string()));
        }
        return Err(AppError::BadRequest(format!(
            "Directory already exists but is not a worktree: {worktree_str}"
        )));
    }

    // Create parent directory
    if let Some(parent) = worktree_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::Internal(format!("Failed to create directory: {e}"))
        })?;
    }

    // Try with -b first; fall back without -b if branch already exists
    match run_git(
        &["worktree", "add", &worktree_str, "-b", branch_name],
        repo_path,
    )
    .await
    {
        Ok(_) => {}
        Err(e) => {
            let err_msg = e.to_string();
            if err_msg.contains("already exists") {
                run_git(
                    &["worktree", "add", &worktree_str, branch_name],
                    repo_path,
                )
                .await?;
            } else {
                return Err(e);
            }
        }
    }

    Ok((worktree_str, branch_name.to_string()))
}

/// Remove a git worktree.
pub async fn remove_worktree(repo_path: &Path, worktree_path: &Path) -> Result<(), AppError> {
    let wt_str = worktree_path.to_string_lossy().to_string();
    run_git(&["worktree", "remove", &wt_str, "--force"], repo_path).await?;
    Ok(())
}

/// Detect the original branch from which a worktree branch was created.
/// Uses tracking config → remote HEAD → common defaults fallback chain.
pub async fn get_original_branch(
    repo_path: &Path,
    worktree_branch: &str,
) -> Result<String, AppError> {
    // 1. Try tracking config
    let config_key = format!("branch.{worktree_branch}.merge");
    if let Ok(stdout) = run_git(&["config", "--get", &config_key], repo_path).await {
        let merge = stdout.trim();
        if !merge.is_empty() {
            return Ok(merge.replace("refs/heads/", ""));
        }
    }

    // 2. Try remote HEAD
    if let Ok(stdout) = run_git(&["symbolic-ref", "refs/remotes/origin/HEAD"], repo_path).await {
        let remote_head = stdout.trim();
        if !remote_head.is_empty() {
            return Ok(remote_head.replace("refs/remotes/origin/", ""));
        }
    }

    // 3. Try common defaults
    for candidate in &["main", "master", "develop", "trunk"] {
        if run_git(&["rev-parse", "--verify", candidate], repo_path)
            .await
            .is_ok()
        {
            return Ok(candidate.to_string());
        }
    }

    Err(AppError::GitCommandError(format!(
        "Cannot determine original branch for worktree branch: {worktree_branch}"
    )))
}

/// Check if merging source_branch into target_branch would produce conflicts.
pub async fn check_merge_conflicts(
    repo_path: &Path,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeConflictResult, AppError> {
    let merge_base_out =
        run_git(&["merge-base", target_branch, source_branch], repo_path).await?;
    let merge_base = merge_base_out.trim();

    // merge-tree may exit non-zero when it detects conflicts
    let merge_tree_output = match run_git(
        &["merge-tree", merge_base, target_branch, source_branch],
        repo_path,
    )
    .await
    {
        Ok(stdout) => stdout,
        Err(e) => e.to_string(),
    };

    let has_conflicts = merge_tree_output.contains("<<<<<<<");
    if !has_conflicts {
        return Ok(MergeConflictResult {
            has_conflicts: false,
            conflict_files: vec![],
        });
    }

    // Identify conflicting files
    let source_args = ["diff", "--name-only", merge_base, source_branch];
    let target_args = ["diff", "--name-only", merge_base, target_branch];
    let (source_diff, target_diff) = tokio::join!(
        run_git_quiet(&source_args, repo_path),
        run_git_quiet(&target_args, repo_path),
    );

    let source_files: HashSet<&str> = source_diff.trim().lines().filter(|l| !l.is_empty()).collect();
    let conflict_files: Vec<String> = target_diff
        .trim()
        .lines()
        .filter(|l| !l.is_empty() && source_files.contains(l))
        .map(|s| s.to_string())
        .collect();

    Ok(MergeConflictResult {
        has_conflicts: true,
        conflict_files,
    })
}

/// Merge source_branch into target_branch using --no-ff.
pub async fn merge_branch(
    repo_path: &Path,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeResult, AppError> {
    // Get current branch to restore later
    let original_branch = get_current_branch(repo_path).await.ok().flatten();

    // Checkout target and merge
    let merge_result = match run_git(&["checkout", target_branch], repo_path).await {
        Ok(_) => match run_git(&["merge", "--no-ff", source_branch], repo_path).await {
            Ok(_) => MergeResult {
                success: true,
                error: None,
            },
            Err(e) => {
                // Abort the merge
                let _ = run_git(&["merge", "--abort"], repo_path).await;
                MergeResult {
                    success: false,
                    error: Some(e.to_string()),
                }
            }
        },
        Err(e) => MergeResult {
            success: false,
            error: Some(e.to_string()),
        },
    };

    // Restore original branch
    if let Some(ref orig) = original_branch {
        if orig != target_branch {
            let _ = run_git(&["checkout", orig], repo_path).await;
        }
    }

    Ok(merge_result)
}

/// Delete a local branch using -d (safe, only if fully merged).
pub async fn delete_branch(repo_path: &Path, branch_name: &str) -> Result<MergeResult, AppError> {
    match run_git(&["branch", "-d", branch_name], repo_path).await {
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

/// Check if a worktree has uncommitted or untracked changes.
pub async fn has_uncommitted_changes(worktree_path: &Path) -> Result<bool, AppError> {
    match run_git(&["status", "--porcelain"], worktree_path).await {
        Ok(stdout) => Ok(!stdout.trim().is_empty()),
        Err(_) => Ok(false),
    }
}

/// Build a branch name from a prefix and feature title.
/// Matches the TypeScript implementation: slug + random 4-char hex.
pub fn build_branch_name(prefix: &str, title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    // Collapse multiple dashes and trim leading/trailing
    let mut result = String::new();
    let mut last_was_dash = true; // treat start as dash to trim leading
    for c in slug.chars() {
        if c == '-' {
            if !last_was_dash {
                result.push('-');
            }
            last_was_dash = true;
        } else {
            result.push(c);
            last_was_dash = false;
        }
    }
    // Trim trailing dash
    let slug = result.trim_end_matches('-');
    // Truncate to 50 chars
    let slug = &slug[..slug.len().min(50)];

    // Random 4-char hex suffix
    let suffix: String = format!("{:04x}", rand::random::<u16>());

    format!("{prefix}{slug}-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_branch_name_basic() {
        let name = build_branch_name("feature/", "My Feature");
        assert!(name.starts_with("feature/"), "should start with prefix, got: {name}");
        assert!(name.contains("my-feature"), "should contain slug, got: {name}");
        // 4-char hex suffix after last dash
        let suffix = &name[name.rfind('-').unwrap() + 1..];
        assert_eq!(suffix.len(), 4, "suffix should be 4 hex chars, got: {suffix}");
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_branch_name_special_chars() {
        let name = build_branch_name("feature/", "Hello, World! @#$%");
        assert!(name.starts_with("feature/"));
        // Special chars should become hyphens (collapsed)
        assert!(!name.contains(','));
        assert!(!name.contains('!'));
        assert!(!name.contains('@'));
    }

    #[test]
    fn test_build_branch_name_long_title() {
        let long_title = "a".repeat(100);
        let name = build_branch_name("feature/", &long_title);
        // prefix (8) + slug (<=50) + dash (1) + suffix (4) = max 63
        assert!(name.len() <= 63, "name too long: {} chars", name.len());
    }

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

    #[test]
    fn test_parse_commit_log() {
        let output = "\x1eabc123full\nabc123\nfix bug\nJohn Doe\n2024-01-01 12:00:00 +0000\nsome body text\n";
        let commits = parse_git_log(output);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].sha, "abc123full");
        assert_eq!(commits[0].short_sha, "abc123");
        assert_eq!(commits[0].message, "fix bug");
        assert_eq!(commits[0].author, "John Doe");
        assert_eq!(commits[0].date, "2024-01-01 12:00:00 +0000");
        assert_eq!(commits[0].body, "some body text");
    }

    #[test]
    fn test_parse_commit_log_empty() {
        assert!(parse_git_log("").is_empty());
        assert!(parse_git_log("  \n  ").is_empty());
    }

    #[test]
    fn test_parse_worktree_list_porcelain() {
        let output = "worktree /home/user/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /home/user/wt1\nHEAD def456\nbranch refs/heads/feature/test\n\n";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].path, "/home/user/repo");
        assert_eq!(worktrees[0].branch, "main");
        assert_eq!(worktrees[0].head, "abc123");
        assert!(!worktrees[0].is_bare);
        assert_eq!(worktrees[1].path, "/home/user/wt1");
        assert_eq!(worktrees[1].branch, "feature/test");
        assert_eq!(worktrees[1].head, "def456");
    }

    #[test]
    fn test_parse_worktree_list_bare() {
        let output = "worktree /home/user/repo.git\nHEAD abc123\nbare\n\n";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_bare);
    }

    #[test]
    fn test_parse_worktree_list_detached() {
        let output = "worktree /home/user/wt\nHEAD abc123\ndetached\n\n";
        let worktrees = parse_worktree_list(output);
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch, "(detached)");
    }
}
