use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

/// Best-effort macOS fallback for GUI launches where neither launchd nor the
/// login-shell env exported SSH_AUTH_SOCK.
pub async fn hydrate_macos_ssh_auth_sock() -> usize {
    if !cfg!(target_os = "macos") {
        return 0;
    }
    if current_ssh_auth_sock_is_usable() {
        return 0;
    }
    let Some(sock) = launchctl_ssh_auth_sock()
        .await
        .or_else(|| select_launchd_ssh_auth_sock(Path::new("/private/tmp")))
    else {
        tracing::warn!("SSH_AUTH_SOCK unavailable after login-shell hydration");
        return 0;
    };
    std::env::set_var("SSH_AUTH_SOCK", &sock);
    tracing::info!(ssh_auth_sock = %sock.display(), "hydrated SSH_AUTH_SOCK from macOS agent socket");
    1
}

fn current_ssh_auth_sock_is_usable() -> bool {
    std::env::var_os("SSH_AUTH_SOCK")
        .map(PathBuf::from)
        .is_some_and(|path| is_unix_socket(&path))
}

async fn launchctl_ssh_auth_sock() -> Option<PathBuf> {
    let mut child = Command::new("launchctl")
        .arg("getenv")
        .arg("SSH_AUTH_SOCK")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let read = async {
        let mut buf = Vec::with_capacity(256);
        stdout.read_to_end(&mut buf).await.ok()?;
        Some(String::from_utf8_lossy(&buf).trim().to_string())
    };
    let raw = match timeout(Duration::from_millis(500), read).await {
        Ok(Some(raw)) => raw,
        _ => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return None;
        }
    };
    let _ = timeout(Duration::from_millis(100), child.wait()).await;
    let path = PathBuf::from(raw);
    is_launchd_listeners_socket(&path).then_some(path)
}

fn select_launchd_ssh_auth_sock(root: &Path) -> Option<PathBuf> {
    select_launchd_ssh_auth_sock_with(root, is_current_user_owned, is_launchd_listeners_socket)
}

fn select_launchd_ssh_auth_sock_with(
    root: &Path,
    is_owned: impl Fn(&Path) -> bool,
    is_listeners_socket: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let mut selected: Option<PathBuf> = None;
    for entry in std::fs::read_dir(root).ok()? {
        let Ok(entry) = entry else {
            continue;
        };
        let entry_path = entry.path();
        if !is_owned(&entry_path) {
            continue;
        }
        let candidate = entry_path.join("Listeners");
        if is_listeners_socket(&candidate)
            && selected
                .as_ref()
                .is_none_or(|current| candidate.as_os_str() < current.as_os_str())
        {
            selected = Some(candidate);
        }
    }
    selected
}

pub fn current_ssh_auth_sock_parent() -> Option<PathBuf> {
    let sock = PathBuf::from(std::env::var_os("SSH_AUTH_SOCK")?);
    launchd_listeners_parent(&sock, is_current_user_owned, is_unix_socket)
}

fn is_launchd_listeners_socket(path: &Path) -> bool {
    launchd_listeners_parent(path, is_current_user_owned, is_unix_socket).is_some()
}

fn launchd_listeners_parent(
    path: &Path,
    is_owned: impl Fn(&Path) -> bool,
    is_socket: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if !path.is_absolute() || path.file_name().and_then(|name| name.to_str()) != Some("Listeners") {
        return None;
    }
    let parent = path.parent()?;
    let parent_name = parent.file_name().and_then(|name| name.to_str())?;
    (parent_name.starts_with("com.apple.launchd.") && is_owned(parent) && is_socket(path))
        .then(|| parent.to_path_buf())
}

#[cfg(unix)]
fn is_current_user_owned(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    std::fs::metadata(path)
        .map(|metadata| {
            // SAFETY: `geteuid` has no preconditions and only reads the
            // current process credentials.
            metadata.uid() == unsafe { libc::geteuid() }
        })
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_current_user_owned(_path: &Path) -> bool {
    false
}

#[cfg(unix)]
fn is_unix_socket(path: &Path) -> bool {
    use std::os::unix::fs::FileTypeExt;

    std::fs::metadata(path)
        .map(|metadata| metadata.file_type().is_socket())
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_unix_socket(_path: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_launchd_listeners_socket() {
        let dir = tempfile::tempdir().unwrap();
        let ignored_dir = dir.path().join("not-launchd");
        let launchd_dir = dir.path().join("com.apple.launchd.b");
        let earlier_launchd_dir = dir.path().join("com.apple.launchd.a");
        std::fs::create_dir(&ignored_dir).unwrap();
        std::fs::create_dir(&launchd_dir).unwrap();
        std::fs::create_dir(&earlier_launchd_dir).unwrap();
        let socket_path = launchd_dir.join("Listeners");
        let earlier_socket_path = earlier_launchd_dir.join("Listeners");
        std::fs::write(ignored_dir.join("Listeners"), "").unwrap();
        std::fs::write(&socket_path, "").unwrap();
        std::fs::write(&earlier_socket_path, "").unwrap();

        let selected = select_launchd_ssh_auth_sock_with(
            dir.path(),
            |_| true,
            |path| launchd_listeners_parent(path, |_| true, |_| true).is_some(),
        );

        assert_eq!(selected, Some(earlier_socket_path));
    }

    #[test]
    fn rejects_non_launchd_ssh_auth_sock_parent() {
        let dir = tempfile::tempdir().unwrap();
        let socket_path = dir.path().join("agent.sock");

        assert_eq!(
            launchd_listeners_parent(&socket_path, |_| true, |_| true),
            None
        );
    }
}
