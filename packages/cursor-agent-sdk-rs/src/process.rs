use cli_discovery::DiscoverySpec;
use once_cell::sync::Lazy;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::SdkError;

/// Cursor renamed its primary CLI entry point from `cursor-agent` to `agent`
/// in January 2026. The installer places it in `~/.local/bin`.
pub fn cursor_discovery_spec() -> DiscoverySpec {
    DiscoverySpec {
        bin_name: "agent".into(),
        well_known_relative_to_home: vec![".local/bin".into()],
        well_known_absolute: vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()],
        version_args: vec!["--version".into()],
        // Cursor versions are date/hash strings such as
        // `2026.03.11-6dfa30c` and do not include a stable product marker.
        version_must_contain: None,
    }
}

static BINARY_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

#[cfg(test)]
static TEST_DISCOVERY_LOCK: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));

pub fn set_binary_override(path: Option<PathBuf>) {
    *BINARY_OVERRIDE
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = path;
}

fn current_binary_override() -> Option<PathBuf> {
    BINARY_OVERRIDE
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub async fn resolve_binary() -> Result<PathBuf, SdkError> {
    let spec = cursor_discovery_spec();
    let override_path = current_binary_override();
    if let Some(path) = &override_path {
        if !is_executable_file(path) {
            return Err(SdkError::CliNotFound {
                searched: vec![path.clone()],
            });
        }
    }
    let candidates = cli_discovery::discover_all(&spec, override_path.as_deref()).await;
    let Some(best) = cli_discovery::select_best(&candidates) else {
        return Err(SdkError::CliNotFound {
            searched: cli_discovery::searched_dirs(&spec).await,
        });
    };
    Ok(best.path.clone())
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn discovery_spec_includes_cursor_installer_location() {
        let spec = cursor_discovery_spec();
        assert_eq!(spec.bin_name, "agent");
        assert!(spec
            .well_known_relative_to_home
            .iter()
            .any(|path| path == ".local/bin"));
    }

    #[tokio::test]
    async fn binary_override_round_trips() {
        let _guard = TEST_DISCOVERY_LOCK.lock().await;
        let prior = current_binary_override();
        let dir = tempfile::TempDir::new().unwrap();
        let binary = dir.path().join("agent");
        std::fs::write(&binary, "#!/bin/sh\necho 2026.03.11-6dfa30c\n").unwrap();
        let mut permissions = std::fs::metadata(&binary).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&binary, permissions).unwrap();

        set_binary_override(Some(binary.clone()));
        assert_eq!(resolve_binary().await.unwrap(), binary);
        set_binary_override(prior);
    }
}
