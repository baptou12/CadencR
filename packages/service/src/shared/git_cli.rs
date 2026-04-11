use std::path::Path;
use tokio::process::Command;

use crate::error::AppError;

/// Run a git command with the given arguments in the specified working directory.
pub async fn run_git(args: &[&str], cwd: &Path) -> Result<String, AppError> {
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
