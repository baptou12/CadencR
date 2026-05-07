//! Helpers for the `WorktreeMode::New` provisioning path: deriving the
//! branch name (and persisting it so retries don't churn) plus running
//! `git worktree add` with optional base-branch fork point.

use std::path::Path;

use regex_lite::Regex;
use sqlx::SqlitePool;

use crate::shared::git_cli::run_git_safe_refs;

use super::branch::build_branch_name;
use super::db::{get_setting, set_setting};

/// Mirror of `auto_name::is_default_title`. We don't import it to keep the
/// workflow module independent of `ws_session`. When the feature title is
/// still the auto-incremented placeholder (e.g. "Session 5") — typically
/// because auto-naming failed silently — using it as a branch slug yields
/// `feature/session-5-xxxx`, which is misleading (the number is a per-project
/// counter, not the feature_id) and collides across projects. Detecting it
/// here lets us fall back to a stable, feature-scoped slug.
fn is_default_title(title: &str) -> bool {
    let re = Regex::new(r"(?i)^Session \d+$").unwrap();
    re.is_match(title) || title == "Untitled Feature"
}

/// Get-or-derive the new branch name for the `New` mode. Persists the
/// generated name immediately so retries don't make a fresh one each time.
pub(super) async fn ensure_new_branch_name(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
) -> Result<String, String> {
    if let Some(b) = get_setting(read_pool, feature_id, "worktree_branch").await {
        return Ok(b);
    }

    let prefix = sqlx::query_as::<_, (String,)>(
        "SELECT value FROM project_settings WHERE project_id = ? AND key = 'branch_prefix'",
    )
    .bind(project_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("DB error looking up branch_prefix: {e}"))?
    .map(|r| r.0)
    .unwrap_or_else(|| "feature/".to_string());

    let title = sqlx::query_as::<_, (String,)>("SELECT title FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("DB error looking up feature title: {e}"))?
        .map(|r| r.0)
        .unwrap_or_else(|| format!("feature-{feature_id}"));

    // Auto-naming runs synchronously before this on the prompt-send path, but
    // the LLM step can silently return `None` (timeout, empty extraction,
    // provider error). When that happens the title is still the
    // per-project counter "Session N" — slugifying that produces
    // `feature/session-N-xxxx`, which is meaningless and collides across
    // projects. Fall back to a stable feature-scoped slug instead so the
    // branch name doesn't lock in a bad value that the user has to manually
    // fix later.
    let slug_source = if is_default_title(&title) {
        format!("feature-{feature_id}")
    } else {
        title
    };
    let name = build_branch_name(&prefix, &slug_source);
    let _ = set_setting(write_pool, feature_id, "worktree_branch", &name).await;
    Ok(name)
}

/// Run `git worktree add -b <branch> <path> [<base>]`. When `base` is set,
/// the new branch forks from that ref; otherwise from the project's current
/// HEAD. If the new branch already exists (race / retry), fall back to
/// attaching without `-b` (base is ignored in that case — the branch is
/// already at its tip and we're just reattaching).
pub(super) async fn add_new_worktree(
    project_dir: &str,
    branch: &str,
    path_str: &str,
    base: Option<&str>,
) -> Result<(), String> {
    let positional: Vec<&str> = match base {
        Some(b) => vec![path_str, b],
        None => vec![path_str],
    };
    match run_git_safe_refs(
        &["worktree", "add"],
        &["-b", branch],
        &positional,
        Path::new(project_dir),
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = format!("{e}");
            if msg.contains("already exists") {
                run_git_safe_refs(
                    &["worktree", "add"],
                    &[],
                    &[path_str, branch],
                    Path::new(project_dir),
                )
                .await
                .map_err(|e2| format!("git worktree add failed: {e2}"))?;
                Ok(())
            } else {
                Err(format!("git worktree add failed: {msg}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_default_title_matches_session_n_and_untitled() {
        assert!(is_default_title("Session 1"));
        assert!(is_default_title("session 42"));
        assert!(is_default_title("Untitled Feature"));
        assert!(!is_default_title("Fix Login Bug"));
        assert!(!is_default_title("Session about logins"));
    }

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
    async fn add_new_worktree_with_base_branch_forks_from_base() {
        // Set up a repo with two branches at different commits; verify that
        // passing `base = "develop"` makes the new worktree's branch start
        // from `develop`'s tip rather than `main`'s.
        let project = tempfile::tempdir().unwrap();
        init_repo(project.path()).await;

        // Resolve initial branch — `git init` may default to `main` or
        // `master` depending on user config.
        let initial = tokio::process::Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(project.path())
            .output()
            .await
            .unwrap();
        let initial_branch = String::from_utf8(initial.stdout)
            .unwrap()
            .trim()
            .to_string();

        // Create `develop` and add a distinguishing commit.
        tokio::process::Command::new("git")
            .args(["checkout", "-q", "-b", "develop"])
            .current_dir(project.path())
            .status()
            .await
            .unwrap();
        tokio::process::Command::new("git")
            .args(["commit", "--allow-empty", "-m", "develop-only"])
            .current_dir(project.path())
            .status()
            .await
            .unwrap();
        let develop_sha = tokio::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(project.path())
            .output()
            .await
            .unwrap();
        let develop_sha = String::from_utf8(develop_sha.stdout)
            .unwrap()
            .trim()
            .to_string();

        // Switch back so HEAD ≠ develop — proves the explicit base argument
        // is what the new branch actually forks from.
        tokio::process::Command::new("git")
            .args(["checkout", "-q", &initial_branch])
            .current_dir(project.path())
            .status()
            .await
            .unwrap();

        let wt_path = project.path().join("..").join("base-branch-wt");
        let wt_path_str = wt_path.to_str().unwrap();
        add_new_worktree(
            project.path().to_str().unwrap(),
            "feat/from-develop",
            wt_path_str,
            Some("develop"),
        )
        .await
        .unwrap();

        let head_sha = tokio::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&wt_path)
            .output()
            .await
            .unwrap();
        let head_sha = String::from_utf8(head_sha.stdout)
            .unwrap()
            .trim()
            .to_string();
        assert_eq!(
            head_sha, develop_sha,
            "new worktree should fork from develop"
        );

        // Cleanup
        let _ = tokio::process::Command::new("git")
            .args(["worktree", "remove", "--force", wt_path_str])
            .current_dir(project.path())
            .status()
            .await;
    }
}
