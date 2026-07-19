use std::path::Path;

use crate::domain::git::models::GitOperationResponse;
use crate::error::AppError;
use crate::shared::git_cli::{run_git_background, run_git_capture};

/// Stash staged and unstaged tracked-file changes. Untracked files are included
/// only when requested; ignored files are always left in the worktree.
pub async fn push_stash(
    repo_path: &Path,
    message: Option<&str>,
    include_untracked: bool,
) -> Result<GitOperationResponse, AppError> {
    let untracked_mode = if include_untracked {
        "--untracked-files=normal"
    } else {
        "--untracked-files=no"
    };
    let changes =
        run_git_background(&["status", "--porcelain=v2", untracked_mode], repo_path).await?;
    if changes.trim().is_empty() {
        let kind = if include_untracked { "" } else { " tracked" };
        return Err(AppError::BadRequest(format!(
            "No{kind} changes are available to stash"
        )));
    }

    let trimmed = message.map(str::trim).filter(|value| !value.is_empty());
    let mut flags = Vec::new();
    if include_untracked {
        flags.push("--include-untracked");
    }
    if let Some(value) = trimmed {
        flags.extend(["-m", value]);
    }
    run_git_capture(&["stash", "push"], &flags, &[], repo_path).await?;
    Ok(GitOperationResponse::Completed)
}

#[cfg(test)]
mod tests {
    use super::super::tests::Repo;
    use super::*;
    use crate::domain::git::commands::list_stashes;
    use crate::shared::git_cli::run_git;

    #[tokio::test]
    async fn named_push_stashes_staged_and_unstaged_tracked_changes_only() {
        let repo = Repo::seeded().await;
        tokio::fs::write(repo.path.join(".gitignore"), "ignored.txt\n")
            .await
            .unwrap();
        run_git(&["add", ".gitignore"], &repo.path).await.unwrap();
        run_git(&["commit", "-q", "-m", "ignore"], &repo.path)
            .await
            .unwrap();
        tokio::fs::write(repo.path.join("staged.txt"), "staged change\n")
            .await
            .unwrap();
        run_git(&["add", "staged.txt"], &repo.path).await.unwrap();
        tokio::fs::write(repo.path.join("unstaged.txt"), "unstaged change\n")
            .await
            .unwrap();
        tokio::fs::write(repo.path.join("untracked.txt"), "leave me\n")
            .await
            .unwrap();
        tokio::fs::write(repo.path.join("ignored.txt"), "leave me too\n")
            .await
            .unwrap();

        assert_eq!(
            push_stash(&repo.path, Some("  named work  "), false)
                .await
                .unwrap(),
            GitOperationResponse::Completed
        );
        let entries = list_stashes(&repo.path).await.unwrap();
        assert!(entries[0].message.ends_with("named work"));
        assert!(repo.path.join("untracked.txt").exists());
        assert!(repo.path.join("ignored.txt").exists());
        assert_eq!(
            tokio::fs::read_to_string(repo.path.join("staged.txt"))
                .await
                .unwrap(),
            "base staged\n"
        );
        assert_eq!(
            tokio::fs::read_to_string(repo.path.join("unstaged.txt"))
                .await
                .unwrap(),
            "base unstaged\n"
        );
    }

    #[tokio::test]
    async fn unnamed_and_blank_message_pushes_use_gits_default_description() {
        for message in [None, Some(" \t\n ")] {
            let repo = Repo::seeded().await;
            tokio::fs::write(repo.path.join("staged.txt"), "stashed\n")
                .await
                .unwrap();
            push_stash(&repo.path, message, false).await.unwrap();
            let entry = &list_stashes(&repo.path).await.unwrap()[0];
            assert!(entry.message.starts_with("WIP on main:"), "{entry:?}");
        }
    }

    #[tokio::test]
    async fn clean_or_untracked_only_repository_returns_noop_error() {
        let repo = Repo::seeded().await;
        let clean_error = push_stash(&repo.path, None, false).await.unwrap_err();
        assert!(matches!(clean_error, AppError::BadRequest(_)));
        tokio::fs::write(repo.path.join("untracked.txt"), "untouched\n")
            .await
            .unwrap();
        let untracked_error = push_stash(&repo.path, None, false).await.unwrap_err();
        assert!(matches!(untracked_error, AppError::BadRequest(_)));
        assert!(list_stashes(&repo.path).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn include_untracked_stashes_untracked_but_not_ignored_files() {
        let repo = Repo::seeded().await;
        tokio::fs::write(repo.path.join(".gitignore"), "ignored.txt\n")
            .await
            .unwrap();
        run_git(&["add", ".gitignore"], &repo.path).await.unwrap();
        run_git(&["commit", "-q", "-m", "ignore"], &repo.path)
            .await
            .unwrap();
        tokio::fs::write(repo.path.join("untracked.txt"), "stash me\n")
            .await
            .unwrap();
        tokio::fs::write(repo.path.join("ignored.txt"), "leave me\n")
            .await
            .unwrap();

        let outcome = push_stash(&repo.path, Some("untracked work"), true)
            .await
            .unwrap();

        assert_eq!(outcome, GitOperationResponse::Completed);
        assert!(!repo.path.join("untracked.txt").exists());
        assert!(repo.path.join("ignored.txt").exists());
        assert_eq!(list_stashes(&repo.path).await.unwrap().len(), 1);
    }
}
