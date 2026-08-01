//! Watches `~/.cadencr/themes` and broadcasts when a `theme.json` changes.
//!
//! This is what makes "edit the file, see it live" work: the user keeps the
//! theme open in their own editor, and every save re-validates and re-injects
//! the tokens without a reload.

use std::path::Path;
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use tokio::sync::broadcast;
use tracing::warn;

use crate::shared::file_watch::watch_dir;

use super::paths::THEME_FILE_NAME;

/// Short enough that a save feels immediate, long enough to collapse the
/// write-then-rename an atomic save produces.
const DEBOUNCE: Duration = Duration::from_millis(200);

/// A user theme's file changed on disk — via the in-app editor or the user's
/// own. The client's cue to refetch `/api/themes` and re-apply.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ThemesChangeEvent {
    /// The theme's directory slug.
    pub id: String,
}

/// Start watching `dir` recursively (each theme is its own subdirectory). The
/// directory is created first: `notify` can't watch a path that doesn't exist,
/// and a user's first theme would otherwise never reload live.
pub fn start(dir: &Path, tx: broadcast::Sender<ThemesChangeEvent>) {
    if let Err(e) = std::fs::create_dir_all(dir) {
        warn!(dir = %dir.display(), "failed to create themes dir: {e}");
        return;
    }
    watch_dir(dir, RecursiveMode::Recursive, DEBOUNCE, tx, |path| {
        changed_theme_id(path).map(|id| ThemesChangeEvent { id })
    });
}

/// The theme id when `path` is a `<id>/theme.json`. Our atomic writes stage
/// through a dot-prefixed temp file, which this deliberately ignores so a
/// half-written document is never broadcast.
fn changed_theme_id(path: &Path) -> Option<String> {
    if path.file_name()?.to_str()? != THEME_FILE_NAME {
        return None;
    }
    Some(path.parent()?.file_name()?.to_str()?.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn recognizes_a_theme_document() {
        assert_eq!(
            changed_theme_id(&PathBuf::from("/t/themes/my-theme/theme.json")),
            Some("my-theme".to_string())
        );
    }

    #[test]
    fn ignores_temp_and_unrelated_files() {
        assert!(changed_theme_id(&PathBuf::from("/t/themes/my-theme/.theme.json.tmp")).is_none());
        assert!(changed_theme_id(&PathBuf::from("/t/themes/my-theme/notes.txt")).is_none());
        assert!(changed_theme_id(&PathBuf::from("/t/themes")).is_none());
    }
}
