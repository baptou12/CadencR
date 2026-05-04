//! Internal helpers shared across the `commands/*` submodules.

use std::path::Path;

use crate::shared::git_cli::run_git;

/// Run a git command, returning Ok("") instead of Err on failure.
pub(super) async fn run_git_quiet(args: &[&str], cwd: &Path) -> String {
    run_git(args, cwd).await.unwrap_or_default()
}
