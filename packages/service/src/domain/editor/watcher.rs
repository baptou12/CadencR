use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ignore::gitignore::Gitignore;
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::domain::editor::service::{build_gitignore, is_gitignored_or_ancestor};

/// Minimum gap between successive change emissions under sustained churn.
/// Mirrors the git watcher's `MIN_RECOMPUTE_GAP_MS` so an agent (or a build)
/// writing files can't drive a `file_tree.changed` flood — the raw debounced
/// events still fire, but at most one emission leaves per second.
const MIN_EMIT_GAP_MS: i64 = 1000;

/// Lightweight signal sent when watched files change.
#[derive(Clone, Debug)]
pub struct FileChangeEvent {
    pub project_path: String,
}

/// Manages a single file-system watcher for the active project.
pub struct FileWatcher {
    debouncer: Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>,
    watched_path: Option<PathBuf>,
    /// Ping sender feeding the churn-cap emit task. Dropping it (via `stop`)
    /// closes the channel and lets the task exit.
    ping_tx: Option<mpsc::UnboundedSender<()>>,
    emit_task: Option<JoinHandle<()>>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            debouncer: None,
            watched_path: None,
            ping_tx: None,
            emit_task: None,
        }
    }

    /// Start watching `project_path` recursively. Events are sent to `tx`.
    /// Any previous watcher is stopped first.
    ///
    /// Two layers keep this from flooding the frontend on a churny monorepo:
    ///  - gitignored paths (`node_modules/`, `target/`, `dist/`, …) and `.git`
    ///    internals are filtered out before an emission is ever scheduled;
    ///  - a churn-cap emit task collapses sustained bursts to ~1 emission/sec.
    pub fn start(
        &mut self,
        project_path: &str,
        tx: broadcast::Sender<FileChangeEvent>,
    ) -> Result<(), String> {
        self.stop();

        let canonical = std::fs::canonicalize(project_path)
            .map_err(|e| format!("Invalid project path: {e}"))?;
        let project_str = canonical.to_string_lossy().to_string();

        // Build the gitignore matcher once at startup so the hot callback only
        // does a cheap match. `None` (no `.gitignore`) means "filter nothing",
        // which preserves the previous behaviour for non-git projects.
        let gitignore = Arc::new(build_gitignore(&canonical));

        let (ping_tx, ping_rx) = mpsc::unbounded_channel::<()>();
        let emit_task = spawn_emit_task(tx, project_str, ping_rx);

        let debouncer = build_debouncer(canonical.clone(), gitignore, ping_tx.clone())?;

        debug!(path = %canonical.display(), "file watcher started");
        self.debouncer = Some(debouncer);
        self.watched_path = Some(canonical);
        self.ping_tx = Some(ping_tx);
        self.emit_task = Some(emit_task);
        Ok(())
    }

    /// Stop the current watcher if any.
    pub fn stop(&mut self) {
        if let Some(path) = self.watched_path.take() {
            debug!(path = %path.display(), "file watcher stopped");
        }
        // Drop the debouncer (its callback holds one ping sender) and our own
        // ping sender, closing the channel so the emit task exits.
        self.debouncer = None;
        self.ping_tx = None;
        if let Some(task) = self.emit_task.take() {
            task.abort();
        }
    }
}

/// Build the `notify-debouncer-mini` and start the recursive watch. The
/// callback filters `.git` internals and gitignored paths, then pings the
/// emit task for any remaining relevant change.
fn build_debouncer(
    canonical: PathBuf,
    gitignore: Arc<Option<Gitignore>>,
    ping_tx: mpsc::UnboundedSender<()>,
) -> Result<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>, String> {
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let events = match result {
                Ok(events) => events,
                Err(e) => {
                    warn!("file watcher error: {e:?}");
                    return;
                }
            };
            let matcher = (*gitignore).as_ref();
            let has_relevant = events
                .iter()
                .any(|e| e.kind == DebouncedEventKind::Any && !is_noise(matcher, &e.path));
            if has_relevant {
                let _ = ping_tx.send(());
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    debouncer
        .watcher()
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    Ok(debouncer)
}

/// The churn-cap emit task: mirrors the git watcher's `MIN_RECOMPUTE_GAP_MS`
/// pacing. The first change after a quiet period emits immediately; sustained
/// churn is paced to one emission per `MIN_EMIT_GAP_MS`, and the final change
/// after a burst still emits (so the tree never settles stale).
fn spawn_emit_task(
    tx: broadcast::Sender<FileChangeEvent>,
    project_path: String,
    mut ping_rx: mpsc::UnboundedReceiver<()>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut last_emit_ms: i64 = 0;
        while ping_rx.recv().await.is_some() {
            let delay = emit_delay_ms(last_emit_ms, now_ms());
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay as u64)).await;
                // Coalesce every ping that piled up during the wait.
                while ping_rx.try_recv().is_ok() {}
            }
            last_emit_ms = now_ms();
            let _ = tx.send(FileChangeEvent {
                project_path: project_path.clone(),
            });
        }
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// How long to wait before the next emission, given when we last emitted and
/// the current time. `0` means emit now (leading edge or the gap has already
/// elapsed); otherwise it's the remaining slice of `MIN_EMIT_GAP_MS`.
fn emit_delay_ms(last_emit_ms: i64, now_ms: i64) -> i64 {
    (MIN_EMIT_GAP_MS - (now_ms - last_emit_ms)).max(0)
}

/// A change we should ignore: `.git` internals, or anything gitignored
/// (including files nested under an ignored directory like `node_modules/`).
fn is_noise(gitignore: Option<&Gitignore>, path: &Path) -> bool {
    is_git_path(path) || is_gitignored_or_ancestor(gitignore, path, false)
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

    /// The `ignore` crate only applies `.gitignore` inside a git repo, so an
    /// empty `.git` dir is enough for the matcher to take effect.
    #[test]
    fn is_noise_filters_gitignored_paths_including_nested() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\ntarget/\ndist/\n").unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();

        let matcher = build_gitignore(root);
        let m = matcher.as_ref();

        // A file nested deep inside an ignored directory must be filtered.
        assert!(is_noise(m, &root.join("node_modules/pkg/index.js")));
        assert!(is_noise(m, &root.join("target/debug/build/foo")));
        assert!(is_noise(m, &root.join("dist/bundle.js")));
        // `.git` internals are always noise.
        assert!(is_noise(m, &root.join(".git/index")));
        // Real source changes are not noise.
        assert!(!is_noise(m, &root.join("src/main.rs")));
        assert!(!is_noise(m, &root.join("README.md")));
    }

    #[test]
    fn is_noise_without_gitignore_only_filters_git() {
        // No matcher (project without a `.gitignore`): only `.git` is noise.
        assert!(is_noise(None, &PathBuf::from("/project/.git/index")));
        assert!(!is_noise(
            None,
            &PathBuf::from("/project/node_modules/x.js")
        ));
        assert!(!is_noise(None, &PathBuf::from("/project/src/main.rs")));
    }

    #[tokio::test]
    async fn watcher_starts_and_stops() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let mut watcher = FileWatcher::new();

        assert!(watcher.start(dir.path().to_str().unwrap(), tx).is_ok());
        assert!(watcher.watched_path.is_some());

        watcher.stop();
        assert!(watcher.watched_path.is_none());
        assert!(watcher.debouncer.is_none());
        assert!(watcher.ping_tx.is_none());
    }

    #[tokio::test]
    async fn watcher_start_replaces_previous() {
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

    /// The churn-cap pacing, tested deterministically without the wall clock:
    /// a fresh emit (or a fully-elapsed gap) waits 0ms; a change mid-gap waits
    /// the remaining slice so emissions can't leave faster than one per gap.
    #[test]
    fn emit_delay_enforces_min_gap() {
        // Leading edge: last_emit far in the past → emit immediately.
        assert_eq!(emit_delay_ms(0, 1_700_000_000_000), 0);
        // A change 200ms after the last emit waits the remaining 800ms.
        assert_eq!(emit_delay_ms(1_000, 1_200), MIN_EMIT_GAP_MS - 200);
        // A change once the full gap has elapsed emits immediately.
        assert_eq!(emit_delay_ms(1_000, 1_000 + MIN_EMIT_GAP_MS), 0);
        assert_eq!(emit_delay_ms(1_000, 5_000), 0);
    }

    /// The emit task delivers a change for the first ping. Uses a generous
    /// timeout (not a fixed sleep) so it stays robust under parallel test load.
    #[tokio::test]
    async fn emit_task_delivers_leading_change() {
        let (tx, mut rx) = broadcast::channel::<FileChangeEvent>(64);
        let (ping_tx, ping_rx) = mpsc::unbounded_channel::<()>();
        let task = spawn_emit_task(tx, "/proj".to_string(), ping_rx);

        ping_tx.send(()).unwrap();
        let received = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("leading change should be emitted")
            .expect("channel open");
        assert_eq!(received.project_path, "/proj");

        drop(ping_tx);
        let _ = task.await;
    }
}
