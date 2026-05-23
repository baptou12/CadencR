//! Git command orchestration. Split into cohesive submodules so each
//! file stays small enough to read at a glance:
//!
//! - [`branch_name`] — `build_branch_name` (slug + random hex suffix).
//! - [`diff`] — `git diff` / `--stat` / `--numstat`, changed-files merging.
//! - [`files`] — single-file + batch `git show`, `ls-files`.
//! - [`log`] — commit log + `is_pushed` painting via `--not --remotes`.
//! - [`merge`] — `merge-tree`, `merge --no-ff`, `branch -d`,
//!   `get_original_branch` fallback chain, `get_current_branch`.
//! - [`pty`] — `commit_streaming` / `push_streaming` over `portable-pty`.
//! - [`worktree_ops`] — `worktree list/add/remove`, porcelain parsers.
//!
//! Public symbols are re-exported here so existing callers
//! (`crate::domain::git::commands::foo`) keep working without churn.

mod blob_shas;
mod branch_name;
mod changed_files;
mod diff;
mod files;
mod log;
mod merge;
mod merge_ops;
mod pty;
mod pty_spawn;
mod util;
mod worktree_ops;

pub use blob_shas::get_file_blob_shas;
pub use branch_name::build_branch_name;
pub use changed_files::{get_changed_files, parse_numstat};
pub use diff::{get_commit_diff, get_diff, get_stats};
pub use files::{get_file_content, get_file_content_batch, list_files};
pub use log::{get_commit_log, get_recent_commits};
pub use merge::{get_current_branch, get_original_branch};
pub use merge_ops::{check_merge_conflicts, delete_branch, is_branch_merged, parse_conflict_files};
pub use pty::{commit_streaming, push_streaming};
pub use worktree_ops::{
    create_worktree, get_worktree_info, has_uncommitted_changes, list_worktree_branches,
    list_worktrees, remove_worktree,
};
