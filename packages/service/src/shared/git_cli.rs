use std::path::Path;
use tokio::process::Command;

use crate::error::AppError;

/// Run a git command with the given arguments in the specified working directory.
///
/// Prefer `run_git_safe` / `run_git_safe_refs` for new code — those validate
/// user-controlled positionals against flag-prefix injection. This raw variant
/// remains for call sites that compose fully static arg lists.
pub async fn run_git(args: &[&str], cwd: &Path) -> Result<String, AppError> {
    run_raw(args, cwd).await
}

/// Run a git command that operates on paths. Validates that no positional
/// starts with `-` (which would be parsed as a flag) and inserts `--` between
/// flags and positionals so the tokens cannot be reinterpreted as options.
///
/// Layout: `git <subcommand_args>... <flags>... -- <positionals>...`
///
/// Use for subcommands whose trailing positionals are file paths: `diff`,
/// `blame`, `log -- <path>`, `checkout -- <path>` (file-checkout form), etc.
pub async fn run_git_safe(
    subcommand_args: &[&str],
    flags: &[&str],
    positionals: &[&str],
    cwd: &Path,
) -> Result<String, AppError> {
    validate_positionals(positionals)?;
    let mut args: Vec<&str> =
        Vec::with_capacity(subcommand_args.len() + flags.len() + positionals.len() + 1);
    args.extend_from_slice(subcommand_args);
    args.extend_from_slice(flags);
    args.push("--");
    args.extend_from_slice(positionals);
    run_raw(&args, cwd).await
}

/// Run a git command whose positionals are refs (branches, SHAs) rather than
/// file paths — `--` changes the meaning of these subcommands (e.g.
/// `git checkout -- foo` treats `foo` as a path, not a branch). We only
/// validate that positionals do not start with `-`.
///
/// Layout: `git <subcommand_args>... <flags>... <positionals>...`
pub async fn run_git_safe_refs(
    subcommand_args: &[&str],
    flags: &[&str],
    positionals: &[&str],
    cwd: &Path,
) -> Result<String, AppError> {
    validate_positionals(positionals)?;
    let mut args: Vec<&str> =
        Vec::with_capacity(subcommand_args.len() + flags.len() + positionals.len());
    args.extend_from_slice(subcommand_args);
    args.extend_from_slice(flags);
    args.extend_from_slice(positionals);
    run_raw(&args, cwd).await
}

fn validate_positionals(positionals: &[&str]) -> Result<(), AppError> {
    for p in positionals {
        if p.starts_with('-') {
            return Err(AppError::BadRequest(format!(
                "refusing to pass flag-prefixed value to git: {p:?}"
            )));
        }
    }
    Ok(())
}

/// Validate user-controlled positionals for flag-prefix injection. Use in
/// call sites that need to keep their existing `Command` setup (e.g. to
/// inspect non-zero exit codes as first-class outcomes rather than errors).
pub fn guard_positionals(positionals: &[&str]) -> Result<(), AppError> {
    validate_positionals(positionals)
}

async fn run_raw(args: &[&str], cwd: &Path) -> Result<String, AppError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let sanitized = sanitize_git_stderr(stderr.trim());
        return Err(AppError::GitCommandError(format!(
            "git {} failed: {}",
            args.join(" "),
            sanitized
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

/// Run a git command and return the **raw** stderr verbatim on failure
/// (only the home-dir prefix is stripped to avoid leaking the user's
/// real path). Intended for user-facing operations like commit and push
/// where the original git error message is the actionable signal —
/// `error-handling.md` forbids dropping it. Validates positionals against
/// flag-prefix injection.
///
/// Layout: `git <subcommand_args>... <flags>... <positionals>...`
pub async fn run_git_capture(
    subcommand_args: &[&str],
    flags: &[&str],
    positionals: &[&str],
    cwd: &Path,
) -> Result<String, AppError> {
    validate_positionals(positionals)?;
    let mut args: Vec<&str> =
        Vec::with_capacity(subcommand_args.len() + flags.len() + positionals.len());
    args.extend_from_slice(subcommand_args);
    args.extend_from_slice(flags);
    args.extend_from_slice(positionals);

    let output = Command::new("git")
        .args(&args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let scrubbed = scrub_home_prefix(stderr.trim());
        return Err(AppError::GitCommandError(scrubbed));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Replace the user's home directory with `~` so we don't leak the real
/// filesystem layout, but otherwise preserve git's verbatim message.
fn scrub_home_prefix(s: &str) -> String {
    let Some(home) = dirs::home_dir() else {
        return s.to_string();
    };
    let home_str = home.to_string_lossy();
    if home_str.is_empty() {
        return s.to_string();
    }
    s.replace(home_str.as_ref(), "~")
}

/// Strip absolute paths and truncate stderr to avoid leaking filesystem info.
fn sanitize_git_stderr(stderr: &str) -> String {
    use regex_lite::Regex;
    static PATH_RE: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"(/[a-zA-Z0-9_.~\-]+){2,}").unwrap());
    let cleaned = PATH_RE.replace_all(stderr, "<path>");
    if cleaned.len() > 200 {
        format!("{}…", &cleaned[..200])
    } else {
        cleaned.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[tokio::test]
    async fn run_git_safe_rejects_flag_positional() {
        let err = run_git_safe(&["log"], &[], &["--upload-pack=evil"], &temp_dir())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[tokio::test]
    async fn run_git_safe_refs_rejects_flag_positional() {
        let err = run_git_safe_refs(
            &["merge"],
            &["--no-ff"],
            &["--exec=curl attacker"],
            &temp_dir(),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[tokio::test]
    async fn run_git_capture_rejects_flag_positional() {
        let err = run_git_capture(&["log"], &[], &["--upload-pack=evil"], &temp_dir())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn scrub_home_prefix_replaces_home_dir() {
        let home = dirs::home_dir().unwrap();
        let home_str = home.to_string_lossy();
        let input = format!("error in {home_str}/repo/foo");
        let out = scrub_home_prefix(&input);
        assert!(out.starts_with("error in ~/"), "{out}");
        assert!(!out.contains(home_str.as_ref()), "{out}");
    }

    #[tokio::test]
    async fn run_git_safe_accepts_benign_positional() {
        // Validation runs before spawn; we only care that validation itself
        // passes. Use a non-existent cwd so git fails fast after validation.
        let cwd = temp_dir().join("cadencr-no-such-dir-git-safe");
        let err = run_git_safe(&["log"], &[], &["foo/bar.txt"], &cwd)
            .await
            .unwrap_err();
        // Must NOT be BadRequest from our validator.
        match err {
            AppError::BadRequest(_) => panic!("validation should pass for non-flag positional"),
            _ => {}
        }
    }
}
