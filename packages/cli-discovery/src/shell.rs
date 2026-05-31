//! Login-shell PATH resolution.

use tokio::sync::OnceCell as AsyncOnceCell;

#[cfg(unix)]
use std::time::Duration;
#[cfg(unix)]
use tokio::process::Command;
#[cfg(unix)]
use tracing::warn;

/// Spawn the user's login shell once and return its PATH.
///
/// Cached for the process lifetime. Returns `None` on Windows or if the shell
/// errors out — callers must treat absence as benign.
pub async fn login_shell_path() -> Option<String> {
    static CACHE: AsyncOnceCell<Option<String>> = AsyncOnceCell::const_new();
    CACHE.get_or_init(resolve_login_shell_path).await.clone()
}

#[cfg(unix)]
async fn resolve_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new(&shell)
            .args(["-ilc", "echo $PATH"])
            .env_remove("CLAUDECODE")
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        warn!(
            shell = %shell,
            stderr = %String::from_utf8_lossy(&output.stderr),
            "login shell exited non-zero while resolving PATH"
        );
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(not(unix))]
async fn resolve_login_shell_path() -> Option<String> {
    None
}
