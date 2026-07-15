//! Worktree registration and filesystem-health checks.

use std::path::{Path, PathBuf};

use crate::domain::git::models::WorktreeInfo;
use crate::error::AppError;

use super::worktree_ops::list_worktrees;

pub async fn get_worktree_info(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<Option<WorktreeInfo>, AppError> {
    Ok(list_worktrees(repo_path)
        .await?
        .into_iter()
        .find(|worktree| worktree_path_matches(worktree, worktree_path)))
}

/// Whether `worktree_path` is an existing directory registered by `repo_path`.
/// Filesystem presence alone is insufficient because Git can detach worktree
/// metadata before a watcher-created residual directory is removed.
pub async fn is_live_worktree(repo_path: &Path, worktree_path: &Path) -> Result<bool, AppError> {
    match tokio::fs::metadata(worktree_path).await {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(AppError::Internal(format!(
                "Failed to inspect worktree path: {error}"
            )))
        }
    }
    Ok(get_worktree_info(repo_path, worktree_path).await?.is_some())
}

pub fn worktree_path_matches(worktree: &WorktreeInfo, path: &Path) -> bool {
    canonicalize(path) == canonicalize(Path::new(&worktree.path))
}

fn canonicalize(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn init_repo(path: &Path) {
        std::fs::create_dir_all(path).unwrap();
        for args in [
            &["init"][..],
            &["config", "user.email", "test@example.com"],
            &["config", "user.name", "Test"],
            &["config", "commit.gpgsign", "false"],
        ] {
            crate::shared::git_cli::run_git(args, path).await.unwrap();
        }
        std::fs::write(path.join("README.md"), "test").unwrap();
        crate::shared::git_cli::run_git(&["add", "README.md"], path)
            .await
            .unwrap();
        crate::shared::git_cli::run_git(&["commit", "-m", "init"], path)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn liveness_requires_registration_with_the_owning_repository() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let worktree = root.path().join("worktree");
        let unrelated = root.path().join("unrelated");
        init_repo(&repo).await;
        init_repo(&unrelated).await;
        crate::shared::git_cli::run_git(
            &[
                "worktree",
                "add",
                "-b",
                "feature/test",
                worktree.to_str().unwrap(),
            ],
            &repo,
        )
        .await
        .unwrap();

        assert!(is_live_worktree(&repo, &worktree).await.unwrap());
        assert!(!is_live_worktree(&repo, &unrelated).await.unwrap());
        assert!(!is_live_worktree(&repo, &root.path().join("missing"))
            .await
            .unwrap());
    }
}
