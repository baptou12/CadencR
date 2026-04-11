use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use tokio::sync::broadcast;
use tracing::{debug, warn};

/// Lightweight signal sent when watched files change.
#[derive(Clone, Debug)]
pub struct FileChangeEvent {
    pub project_path: String,
}

/// Manages a single file-system watcher for the active project.
pub struct FileWatcher {
    debouncer: Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>,
    watched_path: Option<PathBuf>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            debouncer: None,
            watched_path: None,
        }
    }

    /// Start watching `project_path` recursively. Events are sent to `tx`.
    /// Any previous watcher is stopped first.
    pub fn start(
        &mut self,
        project_path: &str,
        tx: broadcast::Sender<FileChangeEvent>,
    ) -> Result<(), String> {
        self.stop();

        let canonical = std::fs::canonicalize(project_path)
            .map_err(|e| format!("Invalid project path: {e}"))?;

        let project_str = canonical.to_string_lossy().to_string();
        let canonical_clone = canonical.clone();

        let mut debouncer = new_debouncer(
            std::time::Duration::from_millis(500),
            move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
                let events = match result {
                    Ok(events) => events,
                    Err(e) => {
                        warn!("file watcher error: {e:?}");
                        return;
                    }
                };

                let dominated_by_git = events.iter().all(|e| is_git_path(&e.path));
                if dominated_by_git {
                    return;
                }

                // At least one non-.git change — notify
                let has_relevant = events
                    .iter()
                    .any(|e| e.kind == DebouncedEventKind::Any && !is_git_path(&e.path));
                if has_relevant {
                    debug!(project = %canonical_clone.display(), "file change detected");
                    let _ = tx.send(FileChangeEvent {
                        project_path: project_str.clone(),
                    });
                }
            },
        )
        .map_err(|e| format!("Failed to create watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&canonical, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {e}"))?;

        debug!(path = %canonical.display(), "file watcher started");
        self.debouncer = Some(debouncer);
        self.watched_path = Some(canonical);
        Ok(())
    }

    /// Stop the current watcher if any.
    pub fn stop(&mut self) {
        if let Some(path) = self.watched_path.take() {
            debug!(path = %path.display(), "file watcher stopped");
        }
        self.debouncer = None;
    }
}

/// Check if a path is inside a `.git` directory.
fn is_git_path(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == ".git")
}

/// Shared watcher handle stored in AppState.
pub type SharedFileWatcher = Arc<Mutex<FileWatcher>>;

pub fn new_shared() -> SharedFileWatcher {
    Arc::new(Mutex::new(FileWatcher::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn is_git_path_detects_git_dirs() {
        assert!(is_git_path(&PathBuf::from("/project/.git/HEAD")));
        assert!(is_git_path(&PathBuf::from("/project/.git/refs/heads/main")));
        assert!(is_git_path(&PathBuf::from(".git/config")));
    }

    #[test]
    fn is_git_path_allows_normal_paths() {
        assert!(!is_git_path(&PathBuf::from("/project/src/main.rs")));
        assert!(!is_git_path(&PathBuf::from("/project/.gitignore")));
        assert!(!is_git_path(&PathBuf::from(
            "/project/.github/workflows/ci.yml"
        )));
    }

    #[test]
    fn watcher_starts_and_stops() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let mut watcher = FileWatcher::new();

        assert!(watcher.start(dir.path().to_str().unwrap(), tx).is_ok());
        assert!(watcher.watched_path.is_some());

        watcher.stop();
        assert!(watcher.watched_path.is_none());
        assert!(watcher.debouncer.is_none());
    }

    #[test]
    fn watcher_start_replaces_previous() {
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let mut watcher = FileWatcher::new();

        watcher
            .start(dir1.path().to_str().unwrap(), tx.clone())
            .unwrap();
        let first_path = watcher.watched_path.clone();

        watcher.start(dir2.path().to_str().unwrap(), tx).unwrap();
        assert_ne!(first_path, watcher.watched_path);

        watcher.stop();
    }
}
