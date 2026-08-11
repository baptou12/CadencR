//! Process-wide settings directory, set once at startup.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static SETTINGS_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Set the settings directory. Called once from `main` after the path is
/// resolved. Subsequent calls are ignored (the first one wins).
pub fn init(dir: PathBuf) {
    let _ = SETTINGS_DIR.set(dir);
}

/// The active settings directory. In production this is always initialized by
/// `main`. The fallback is a non-existent temp path (never the real user
/// settings dir) so that test code which forgot to initialize reads as empty
/// instead of silently touching `~/.cadencr/settings`.
///
/// In `cfg(test)` builds every test gets its own isolated settings dir: libtest
/// spawns a fresh OS thread per test case, so a per-thread directory keeps tests
/// that exercise the global store (via `get_setting`/`set_setting`/etc.) from
/// leaking state into one another through a shared file. There are no
/// multi-threaded tokio tests, so a `#[tokio::test]` body and any task it spawns
/// share the one thread and therefore the same isolated dir.
pub fn global_dir() -> PathBuf {
    #[cfg(test)]
    {
        return test_dir();
    }
    #[cfg(not(test))]
    {
        SETTINGS_DIR
            .get()
            .cloned()
            .unwrap_or_else(|| std::env::temp_dir().join("cadencr-settings-uninitialized"))
    }
}

/// A sibling of the settings dir — `~/.cadencr/<name>` in production, since
/// settings live at `~/.cadencr/settings`. Used by everything else that owns a
/// user-visible directory under the Cadencr home (themes, diagnostics), so the
/// derivation exists once and inherits the per-test isolation above.
///
/// In test builds the directory *nests* inside the per-thread settings dir
/// instead: the test settings dir sits directly in the temp dir, so its parent
/// is `/tmp` — shared between tests and outside the sandbox.
pub fn sibling_dir(name: &str) -> PathBuf {
    let settings = global_dir();
    #[cfg(test)]
    {
        return settings.join(name);
    }
    #[cfg(not(test))]
    settings
        .parent()
        .map(|parent| parent.join(name))
        .unwrap_or_else(|| settings.join(name))
}

/// Unique, per-test-thread settings directory (test builds only).
#[cfg(test)]
fn test_dir() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    thread_local! {
        static DIR: PathBuf = {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("cadencr-settings-test-{}-{n}", std::process::id()));
            let _ = std::fs::create_dir_all(&dir);
            dir
        };
    }
    DIR.with(Clone::clone)
}

/// Resolve the settings directory from CLI/env config, falling back to a layout
/// derived from the database path. Production passes `--settings-dir`
/// explicitly; this derivation keeps dev/CLI runs working without it.
pub fn resolve_from_config(settings_dir: Option<&str>, db_path: &str) -> PathBuf {
    if let Some(dir) = settings_dir {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    derive_from_db_path(db_path)
}

/// Production DB layout is `<base>/database/<db>` → settings live at
/// `<base>/settings`. For any other layout (dev, ad-hoc CLI) we place a
/// `cadencr-settings` dir next to the database file.
fn derive_from_db_path(db_path: &str) -> PathBuf {
    let p = Path::new(db_path);
    if let Some(db_dir) = p.parent() {
        if db_dir.file_name().is_some_and(|n| n == "database") {
            if let Some(base) = db_dir.parent() {
                return base.join("settings");
            }
        }
        return db_dir.join("cadencr-settings");
    }
    PathBuf::from("cadencr-settings")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_value_wins() {
        let dir = resolve_from_config(Some("/custom/dir"), "/home/u/.cadencr/database/x.db");
        assert_eq!(dir, PathBuf::from("/custom/dir"));
    }

    #[test]
    fn empty_config_falls_through() {
        let dir = resolve_from_config(Some("  "), "/home/u/.cadencr/database/x.db");
        assert_eq!(dir, PathBuf::from("/home/u/.cadencr/settings"));
    }

    #[test]
    fn derives_production_layout() {
        let dir = resolve_from_config(None, "/home/u/.cadencr/database/cadencr.db");
        assert_eq!(dir, PathBuf::from("/home/u/.cadencr/settings"));
    }

    #[test]
    fn derives_dev_layout_next_to_db() {
        let dir = resolve_from_config(None, "/work/service/cadencr.local.db");
        assert_eq!(dir, PathBuf::from("/work/service/cadencr-settings"));
    }
}
