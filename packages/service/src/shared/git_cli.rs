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
        return Err(AppError::GitCommandError(format!(
            "git {} failed: {}",
            args.join(" "),
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}
