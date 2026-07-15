//! Resilient worktree removal, including cleanup after Git detaches metadata
//! but a watcher recreates generated files before the directory is removed.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use crate::error::AppError;
use crate::shared::git_cli::{run_git_background, run_git_safe};
use crate::shared::worktree_paths::default_worktrees_root;

use super::worktree_health::get_worktree_info;

static REMOVAL_ID: AtomicU64 = AtomicU64::new(0);
const CLEANUP_ATTEMPTS: usize = 3;

/// Remove a Git worktree. Safe mode preserves Git's dirty-worktree refusal but
/// finishes cleanup if Git detaches metadata before hitting the common
/// directory-not-empty race. Force mode also removes already-unregistered
/// residual folders when they are inside Cadencr's managed worktree root.
pub async fn remove_worktree(
    repo_path: &Path,
    requested_path: &Path,
    force: bool,
) -> Result<(), AppError> {
    let target = resolve_removal_root(requested_path).await;
    let was_registered = get_worktree_info(repo_path, &target).await?.is_some();
    let managed_root = managed_worktree_root(&target);
    if force && !was_registered {
        if let Some(path) = managed_root.as_deref() {
            return remove_residual_path(path).await;
        }
    }
    let target_str = target.to_string_lossy().into_owned();
    let flags: &[&str] = if force { &["--force"] } else { &[] };
    let git_result = run_git_safe(&["worktree", "remove"], flags, &[&target_str], repo_path).await;

    if get_worktree_info(repo_path, &target).await?.is_some() {
        return git_result.and_then(|_| {
            Err(AppError::Internal(
                "Git reported success but the worktree is still registered".into(),
            ))
        });
    }

    if !force {
        // A clean removal can still return "directory not empty" after Git
        // has already detached the worktree metadata. At that point the safe
        // dirty-tree check has passed, so finish removing the residual folder
        // instead of preserving an unusable shell of the old worktree.
        if was_registered {
            return remove_residual_path(&target).await;
        }
        if managed_root.is_some() && !target.exists() {
            return Ok(());
        }
        git_result?;
        return ensure_path_removed(&target);
    }

    if !was_registered && managed_root.is_none() {
        return git_result.map(|_| ());
    }
    remove_residual_path(managed_root.as_deref().unwrap_or(&target)).await
}

async fn resolve_removal_root(path: &Path) -> PathBuf {
    match run_git_background(&["rev-parse", "--show-toplevel"], path).await {
        Ok(root) if !root.trim().is_empty() => PathBuf::from(root.trim()),
        _ => managed_worktree_root(path).unwrap_or_else(|| path.to_path_buf()),
    }
}

fn managed_worktree_root(path: &Path) -> Option<PathBuf> {
    let root = default_worktrees_root().ok()?;
    let canonical_root = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    let comparable = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    managed_child_root(&canonical_root, &comparable).or_else(|| managed_child_root(&root, path))
}

fn managed_child_root(root: &Path, path: &Path) -> Option<PathBuf> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let Component::Normal(project) = components.next()? else {
        return None;
    };
    let Component::Normal(worktree) = components.next()? else {
        return None;
    };
    Some(root.join(project).join(worktree))
}

fn ensure_path_removed(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        return Err(AppError::Internal(
            "Git detached the worktree but its folder still exists".into(),
        ));
    }
    Ok(())
}

async fn remove_residual_path(path: &Path) -> Result<(), AppError> {
    for attempt in 0..CLEANUP_ATTEMPTS {
        match tokio::fs::symlink_metadata(path).await {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(AppError::Internal(format!(
                    "Failed to inspect residual worktree files: {error}"
                )))
            }
        }
        let trash = removal_sibling(path, attempt)?;
        match tokio::fs::rename(path, &trash).await {
            Ok(()) => remove_dir_all_retry(&trash).await?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(AppError::Internal(format!(
                    "Failed to isolate residual worktree files: {error}"
                )))
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    ensure_path_removed(path)
}

fn removal_sibling(path: &Path, attempt: usize) -> Result<PathBuf, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Internal("Worktree path has no parent".into()))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("worktree");
    let id = REMOVAL_ID.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{name}.cadencr-removing-{}-{id}-{attempt}",
        std::process::id()
    )))
}

async fn remove_dir_all_retry(path: &Path) -> Result<(), AppError> {
    let mut last_error = None;
    for _ in 0..CLEANUP_ATTEMPTS {
        match tokio::fs::remove_dir_all(path).await {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Err(AppError::Internal(format!(
        "Failed to delete residual worktree files: {}",
        last_error.expect("cleanup attempts always set an error")
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn repository_with_commit(root: &Path) -> PathBuf {
        let repo = root.join("repo");
        std::fs::create_dir(&repo).unwrap();
        for args in [
            &["init"][..],
            &["config", "user.email", "test@example.com"],
            &["config", "user.name", "Test"],
            &["config", "commit.gpgsign", "false"],
        ] {
            crate::shared::git_cli::run_git(args, &repo).await.unwrap();
        }
        std::fs::write(repo.join("README.md"), "hello").unwrap();
        crate::shared::git_cli::run_git(&["add", "README.md"], &repo)
            .await
            .unwrap();
        crate::shared::git_cli::run_git(&["commit", "-m", "init"], &repo)
            .await
            .unwrap();
        repo
    }

    #[tokio::test]
    async fn remove_worktree_requires_force_for_dirty_tree() {
        let dir = tempfile::tempdir().unwrap();
        let repo = repository_with_commit(dir.path()).await;
        let wt = dir.path().join("wt");
        crate::shared::git_cli::run_git(
            &[
                "worktree",
                "add",
                "-b",
                "feature/dirty",
                wt.to_str().unwrap(),
            ],
            &repo,
        )
        .await
        .unwrap();
        std::fs::write(wt.join("dirty.txt"), "dirty").unwrap();

        assert!(remove_worktree(&repo, &wt, false).await.is_err());
        remove_worktree(&repo, &wt, true).await.unwrap();
        assert!(!wt.exists());
    }

    #[tokio::test]
    async fn residual_cleanup_removes_nested_generated_files() {
        let dir = tempfile::tempdir().unwrap();
        let residual = dir.path().join("worktree");
        tokio::fs::create_dir_all(residual.join("packages/landing/.astro"))
            .await
            .unwrap();
        tokio::fs::write(residual.join("packages/landing/.astro/data.json"), "{}")
            .await
            .unwrap();

        remove_residual_path(&residual).await.unwrap();
        assert!(!residual.exists());
    }

    #[test]
    fn managed_child_root_selects_only_the_worktree_boundary() {
        let root = Path::new("/tmp/cadencr-worktrees");
        let nested = root.join("project/worktree/packages/app");
        assert_eq!(
            managed_child_root(root, &nested),
            Some(root.join("project/worktree"))
        );
        assert_eq!(
            managed_child_root(root, &root.join("../outside/worktree")),
            None
        );
    }
}
