//! Watches the settings directory and broadcasts a change event when a settings
//! file is created/modified — by our own writes or an external editor/script.
//! The broadcast drives the frontend to re-fetch so external edits show up live.

use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use super::{paths, SettingsChangeEvent};

/// Keeps the debouncer (and its underlying OS watcher) alive for the process
/// lifetime. Dropping it would silently stop notifications.
static WATCHER: OnceLock<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>> =
    OnceLock::new();

/// Start watching `dir` (non-recursive). Best-effort: a failure is logged but
/// never fatal — settings still work, just without live external-edit refresh.
pub fn start(dir: &Path, tx: broadcast::Sender<SettingsChangeEvent>) {
    let mut debouncer = match new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let events = match result {
                Ok(events) => events,
                Err(e) => {
                    warn!("settings watcher error: {e:?}");
                    return;
                }
            };
            for event in events {
                if let Some(file) = settings_file_name(&event.path) {
                    debug!(file = %file, "settings file change detected");
                    let _ = tx.send(SettingsChangeEvent { file });
                }
            }
        },
    ) {
        Ok(debouncer) => debouncer,
        Err(e) => {
            warn!("failed to create settings watcher: {e}");
            return;
        }
    };

    if let Err(e) = debouncer.watcher().watch(dir, RecursiveMode::NonRecursive) {
        warn!(dir = %dir.display(), "failed to watch settings dir: {e}");
        return;
    }
    let _ = WATCHER.set(debouncer);
    debug!(dir = %dir.display(), "settings watcher started");
}

/// Returns the file name if `path` is a settings document we care about
/// (`settings.json` or `*.settings.json`), filtering out the dotfile temp files
/// our atomic writes create.
fn settings_file_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    if name.starts_with('.') {
        return None;
    }
    if name == paths::GLOBAL_FILE_NAME || name.ends_with(".settings.json") {
        Some(name.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn recognizes_settings_files() {
        assert_eq!(
            settings_file_name(&PathBuf::from("/s/settings.json")),
            Some("settings.json".to_string())
        );
        assert_eq!(
            settings_file_name(&PathBuf::from("/s/my-project.settings.json")),
            Some("my-project.settings.json".to_string())
        );
    }

    #[test]
    fn ignores_temp_and_unrelated_files() {
        assert!(settings_file_name(&PathBuf::from("/s/.settings.json.tmp")).is_none());
        assert!(settings_file_name(&PathBuf::from("/s/notes.txt")).is_none());
        assert!(settings_file_name(&PathBuf::from("/s/cadencr.db")).is_none());
    }
}
