//! `WorktreeMode::Reuse` path: attach a feature to an existing branch and,
//! when the branch is already checked out elsewhere, share that worktree.

use std::path::Path;

use crate::domain::git::commands as git_commands;
use crate::shared::git_cli::run_git_safe_refs;
use crate::shared::worktree_paths::compute_worktree_path;

/// Outcome of `attach_to_existing_branch`: whether the worktree was newly
/// created or already attached to a different feature on disk.
pub struct WorktreeAttached {
    pub worktree_path: String,
    pub branch: String,
    pub was_already_attached: bool,
}

/// Attach a feature to an existing branch. If the branch is already checked
/// out in another worktree (e.g. another Cadencr feature), reuse that path —
/// the two features will then share working-copy state. Otherwise create a
/// fresh worktree on the same branch (no `-b`).
///
/// This helper does not touch DB or send envelopes — `ensure_reuse` does
/// both via `persist_and_announce`. Keeping the helper pure makes it
/// testable (the decision logic is exercised via the parsed map).
pub async fn attach_to_existing_branch(
    branch: &str,
    project_path: &Path,
    project_name: &str,
) -> Result<WorktreeAttached, String> {
    let attachments = git_commands::list_worktree_branches(project_path)
        .await
        .map_err(|e| format!("failed to list worktrees: {e}"))?;

    if let Some(existing) = attachments.get(branch) {
        return Ok(WorktreeAttached {
            worktree_path: existing.to_string_lossy().to_string(),
            branch: branch.to_string(),
            was_already_attached: true,
        });
    }

    // Build a fresh path under ~/.cadencr/worktrees/<project>/<safe-branch>
    // and run `git worktree add <path> <branch>` (no `-b` — branch exists).
    let path_str = compute_worktree_path(project_name, branch).await?;
    run_git_safe_refs(
        &["worktree", "add"],
        &[],
        &[&path_str, branch],
        project_path,
    )
    .await
    .map_err(|e| format!("git worktree add failed: {e}"))?;

    Ok(WorktreeAttached {
        worktree_path: path_str,
        branch: branch.to_string(),
        was_already_attached: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_repo(dir: &Path) {
        let _ = tokio::process::Command::new("git")
            .arg("init")
            .arg("-q")
            .current_dir(dir)
            .status()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["config", "user.email", "t@example.com"])
            .current_dir(dir)
            .status()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["config", "user.name", "T"])
            .current_dir(dir)
            .status()
            .await
            .unwrap();
        // Disable gpg signing locally so the test doesn't depend on the
        // developer's global `commit.gpgsign` state.
        tokio::process::Command::new("git")
            .args(["config", "commit.gpgsign", "false"])
            .current_dir(dir)
            .status()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["config", "tag.gpgsign", "false"])
            .current_dir(dir)
            .status()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(dir)
            .status()
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn attach_to_existing_branch_reuses_attached_worktree() {
        // Set up: repo with branch `feat/a` already checked out in a sibling
        // worktree. Calling `attach_to_existing_branch("feat/a")` should
        // return the existing path with `was_already_attached=true`.
        let project = tempfile::tempdir().unwrap();
        init_repo(project.path()).await;

        // Create branch `feat/a` and attach it in a new worktree.
        tokio::process::Command::new("git")
            .args(["branch", "feat/a"])
            .current_dir(project.path())
            .status()
            .await
            .unwrap();
        let donor_wt = project.path().join("..").join("donor-wt");
        tokio::process::Command::new("git")
            .args(["worktree", "add", donor_wt.to_str().unwrap(), "feat/a"])
            .current_dir(project.path())
            .status()
            .await
            .unwrap();

        let result = attach_to_existing_branch("feat/a", project.path(), "donor-wt-test")
            .await
            .unwrap();
        assert!(result.was_already_attached);
        // git worktree list emits canonicalized paths, so a starts_with check is more robust
        // than equality (donor_wt has `..` in it).
        assert!(
            result.worktree_path.contains("donor-wt"),
            "{}",
            result.worktree_path
        );

        // Cleanup
        let _ = tokio::process::Command::new("git")
            .args(["worktree", "remove", "--force", donor_wt.to_str().unwrap()])
            .current_dir(project.path())
            .status()
            .await;
    }
}
