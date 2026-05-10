//! OpenCode binary discovery + override.
//!
//! Used to also own the long-running OpenCode HTTP server (spawn,
//! monitor, health-check, shutdown). With the HTTP transport retired,
//! the only surviving responsibilities are the discovery spec the host
//! app uses to find an `opencode` binary and the settings-backed path
//! override the host can set on startup.

use cli_discovery::DiscoverySpec;
use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::sync::RwLock;

/// Provider-neutral spec for finding the `opencode` binary.
///
/// Exposed publicly so the host app can call `cli_discovery::discover_all`
/// directly to render an onboarding "pick a binary" UI without re-declaring
/// the well-known install dirs here.
pub fn opencode_discovery_spec() -> DiscoverySpec {
    DiscoverySpec {
        bin_name: "opencode",
        well_known_relative_to_home: vec![".opencode/bin"],
        well_known_absolute: vec!["/opt/homebrew/bin", "/usr/local/bin"],
        version_args: &["--version"],
    }
}

/// Globally-set override for the `opencode` binary path.
///
/// Set once by the host app at startup (e.g. read from settings).
/// The override is consulted by callers of `current_binary_override`
/// (today none — the ACP path reads `CADENCR_OPENCODE_BIN` directly;
/// see TODO below).
static BINARY_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// Set (or clear, with `None`) the override path for the `opencode` binary.
///
/// Wins over `CADENCR_OPENCODE_BIN` and discovery. The host app should call
/// this once at startup with the user's persisted setting.
///
/// TODO(opencode-acp): the ACP spawn path in
/// `cadencr-service::domain::agents::opencode::acp::resolve_opencode_binary`
/// currently reads `CADENCR_OPENCODE_BIN` directly and ignores this
/// setting. Wire `current_binary_override` into that resolver so the
/// host's settings actually take effect on ACP spawns.
pub fn set_binary_override(path: Option<PathBuf>) {
    if let Ok(mut guard) = BINARY_OVERRIDE.write() {
        *guard = path;
    }
}

#[allow(dead_code)]
fn current_binary_override() -> Option<PathBuf> {
    BINARY_OVERRIDE.read().ok().and_then(|guard| guard.clone())
}

#[cfg(test)]
mod tests {
    use super::{current_binary_override, opencode_discovery_spec, set_binary_override};
    use std::path::PathBuf;

    #[test]
    fn opencode_discovery_spec_includes_user_install_and_homebrew() {
        let spec = opencode_discovery_spec();
        assert_eq!(spec.bin_name, "opencode");
        assert!(spec.well_known_relative_to_home.contains(&".opencode/bin"));
        assert!(spec.well_known_absolute.contains(&"/opt/homebrew/bin"));
    }

    #[test]
    fn binary_override_round_trips() {
        // Save and restore so this test doesn't leak state into the shared
        // singleton used by other tests in the same process.
        let prior = current_binary_override();
        set_binary_override(Some(PathBuf::from("/custom/opencode")));
        assert_eq!(
            current_binary_override(),
            Some(PathBuf::from("/custom/opencode"))
        );
        set_binary_override(None);
        assert!(current_binary_override().is_none());
        set_binary_override(prior);
    }
}
