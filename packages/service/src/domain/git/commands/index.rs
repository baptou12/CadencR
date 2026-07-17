//! Whole-file index mutations. Pathspecs are explicitly literal so names
//! containing glob metacharacters cannot select neighboring files.

use std::path::Path;

use crate::domain::git::porcelain::parse_porcelain_v2_entries;
use crate::error::AppError;
use crate::shared::git_cli::{git_ref_resolves_background, run_git_background, run_git_safe};

pub async fn stage_file(repo: &Path, file_path: &str) -> Result<(), AppError> {
    let pathspecs = mutation_pathspecs(repo, file_path).await?;
    let positionals = pathspecs.iter().map(String::as_str).collect::<Vec<_>>();
    run_git_safe(&["add"], &["-A"], &positionals, repo).await?;
    Ok(())
}

/// Remove one whole-file path from the index without modifying worktree
/// bytes. `restore --staged` is the normal path; an unborn repository has no
/// `HEAD`, so `rm --cached -f` is the safe index-only equivalent there.
pub async fn reset_file(repo: &Path, file_path: &str) -> Result<(), AppError> {
    let pathspecs = mutation_pathspecs(repo, file_path).await?;
    let positionals = pathspecs.iter().map(String::as_str).collect::<Vec<_>>();
    let has_head = git_ref_resolves_background("HEAD", repo).await?;
    if has_head {
        run_git_safe(&["restore"], &["--staged"], &positionals, repo).await?;
    } else {
        run_git_safe(
            &["rm"],
            &["--cached", "--ignore-unmatch", "-f"],
            &positionals,
            repo,
        )
        .await?;
    }
    Ok(())
}

async fn mutation_pathspecs(repo: &Path, file_path: &str) -> Result<Vec<String>, AppError> {
    let porcelain = run_git_background(&["status", "--porcelain=v2", "-z"], repo).await?;
    let old_path = parse_porcelain_v2_entries(&porcelain)
        .into_iter()
        .find(|entry| entry.path == file_path)
        .and_then(|entry| entry.old_path);
    let mut paths = vec![literal_pathspec(file_path)];
    if let Some(old_path) = old_path.filter(|old_path| old_path != file_path) {
        paths.push(literal_pathspec(&old_path));
    }
    Ok(paths)
}

fn literal_pathspec(file_path: &str) -> String {
    format!(":(literal){file_path}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct Repo {
        _temp: tempfile::TempDir,
        path: std::path::PathBuf,
    }

    impl Repo {
        fn init() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().to_path_buf();
            for args in [
                &["init", "-q", "-b", "main"][..],
                &["config", "user.email", "test@example.com"],
                &["config", "user.name", "Test"],
                &["config", "commit.gpgsign", "false"],
            ] {
                git(&path, args);
            }
            Self { _temp: temp, path }
        }

        fn seeded() -> Self {
            let repo = Self::init();
            std::fs::write(repo.path.join("tracked.txt"), b"original\n").unwrap();
            git(&repo.path, &["add", "tracked.txt"]);
            git(&repo.path, &["commit", "-q", "-m", "seed"]);
            repo
        }
    }

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
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

    fn capture(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("HOME", repo)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    #[tokio::test]
    async fn stage_handles_add_modify_delete_and_rename() {
        let repo = Repo::seeded();
        std::fs::write(repo.path.join("added.txt"), b"added\n").unwrap();
        std::fs::write(repo.path.join("tracked.txt"), b"modified\n").unwrap();
        std::fs::write(repo.path.join("delete.txt"), b"delete\n").unwrap();
        std::fs::write(repo.path.join("old.txt"), b"rename\n").unwrap();
        git(&repo.path, &["add", "delete.txt", "old.txt"]);
        git(&repo.path, &["commit", "-q", "-m", "more"]);
        std::fs::remove_file(repo.path.join("delete.txt")).unwrap();
        std::fs::rename(repo.path.join("old.txt"), repo.path.join("new.txt")).unwrap();

        for path in [
            "added.txt",
            "tracked.txt",
            "delete.txt",
            "old.txt",
            "new.txt",
        ] {
            stage_file(&repo.path, path).await.unwrap();
        }

        let status = capture(&repo.path, &["status", "--porcelain=v2"]);
        assert!(status.contains("added.txt"), "{status}");
        assert!(status.contains("tracked.txt"), "{status}");
        assert!(status.contains("delete.txt"), "{status}");
        assert!(status.contains("new.txt"), "{status}");
        assert!(
            !status.lines().any(|line| line.starts_with("? ")),
            "{status}"
        );
    }

    #[tokio::test]
    async fn stage_resolves_a_conflicted_file() {
        let repo = Repo::seeded();
        git(&repo.path, &["checkout", "-q", "-b", "other"]);
        std::fs::write(repo.path.join("tracked.txt"), b"other\n").unwrap();
        git(&repo.path, &["commit", "-qam", "other"]);
        git(&repo.path, &["checkout", "-q", "main"]);
        std::fs::write(repo.path.join("tracked.txt"), b"main\n").unwrap();
        git(&repo.path, &["commit", "-qam", "main"]);
        let merge = Command::new("git")
            .args(["merge", "other"])
            .current_dir(&repo.path)
            .output()
            .unwrap();
        assert!(!merge.status.success());
        std::fs::write(repo.path.join("tracked.txt"), b"resolved\n").unwrap();

        stage_file(&repo.path, "tracked.txt").await.unwrap();

        assert!(
            capture(&repo.path, &["diff", "--name-only", "--diff-filter=U"])
                .trim()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn literal_glob_like_path_only_stages_the_exact_file() {
        let repo = Repo::seeded();
        for path in [
            "[one].txt",
            "o.txt",
            "*.txt",
            "quote\"name.txt",
            "line\nbreak.txt",
            "tab\tname.txt",
        ] {
            std::fs::write(repo.path.join(path), path.as_bytes()).unwrap();
        }

        for path in [
            "*.txt",
            "quote\"name.txt",
            "line\nbreak.txt",
            "tab\tname.txt",
        ] {
            stage_file(&repo.path, path).await.unwrap();
        }

        let staged = capture(&repo.path, &["diff", "--cached", "--name-only", "-z"]);
        let staged = staged.split_terminator('\0').collect::<Vec<_>>();
        assert_eq!(
            staged,
            [
                "*.txt",
                "line\nbreak.txt",
                "quote\"name.txt",
                "tab\tname.txt"
            ]
        );
    }

    #[tokio::test]
    async fn reset_preserves_worktree_bytes() {
        let repo = Repo::seeded();
        let bytes = b"modified\0binary\n";
        std::fs::write(repo.path.join("tracked.txt"), bytes).unwrap();
        stage_file(&repo.path, "tracked.txt").await.unwrap();

        reset_file(&repo.path, "tracked.txt").await.unwrap();

        assert_eq!(std::fs::read(repo.path.join("tracked.txt")).unwrap(), bytes);
        assert!(capture(&repo.path, &["diff", "--cached", "--name-only"])
            .trim()
            .is_empty());
    }

    #[tokio::test]
    async fn reset_rename_unstages_both_sides_without_restoring_worktree() {
        let repo = Repo::seeded();
        git(&repo.path, &["mv", "tracked.txt", "renamed.txt"]);

        reset_file(&repo.path, "renamed.txt").await.unwrap();

        assert!(capture(&repo.path, &["diff", "--cached", "--name-only"])
            .trim()
            .is_empty());
        assert!(!repo.path.join("tracked.txt").exists());
        assert_eq!(
            std::fs::read(repo.path.join("renamed.txt")).unwrap(),
            b"original\n"
        );
    }

    #[tokio::test]
    async fn unborn_head_reset_leaves_the_file_on_disk() {
        let repo = Repo::init();
        let bytes = b"unborn\0bytes\n";
        std::fs::write(repo.path.join("new.txt"), bytes).unwrap();
        stage_file(&repo.path, "new.txt").await.unwrap();

        reset_file(&repo.path, "new.txt").await.unwrap();

        assert_eq!(std::fs::read(repo.path.join("new.txt")).unwrap(), bytes);
        assert_eq!(
            capture(&repo.path, &["status", "--porcelain=v2"]).trim(),
            "? new.txt"
        );
    }
}
