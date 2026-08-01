//! Debounced directory watching, shared by the settings and theme stores.
//!
//! Both exist for the same reason: the app owns a directory of JSON documents
//! the user is invited to edit in their own editor, and an external save has to
//! reach connected clients live. The only per-caller differences are the
//! debounce window, whether the walk is recursive, and which paths count — so
//! those are the parameters and everything else lives here.
//!
//! Best-effort by design: a watcher that fails to start costs live refresh, not
//! the documents themselves, so failures are logged and never fatal.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, Debouncer};
use tokio::sync::broadcast;
use tracing::{debug, warn};

/// Keeps every started debouncer (and its underlying OS watcher) alive for the
/// process lifetime. Dropping one would silently stop its notifications.
static WATCHERS: Mutex<Vec<Debouncer<RecommendedWatcher>>> = Mutex::new(Vec::new());

/// Watch `dir`, mapping each changed path to an event via `to_event` and
/// broadcasting the ones that map to `Some`.
pub fn watch_dir<T, F>(
    dir: &Path,
    mode: RecursiveMode,
    debounce: Duration,
    tx: broadcast::Sender<T>,
    to_event: F,
) where
    T: Clone + Send + 'static,
    F: Fn(&Path) -> Option<T> + Send + 'static,
{
    let label = dir.display().to_string();
    let mut debouncer = match new_debouncer(debounce, {
        let label = label.clone();
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let events = match result {
                Ok(events) => events,
                Err(e) => {
                    warn!(dir = %label, "watcher error: {e:?}");
                    return;
                }
            };
            for event in events {
                if let Some(payload) = to_event(&event.path) {
                    let _ = tx.send(payload);
                }
            }
        }
    }) {
        Ok(debouncer) => debouncer,
        Err(e) => {
            warn!(dir = %label, "failed to create watcher: {e}");
            return;
        }
    };

    if let Err(e) = debouncer.watcher().watch(dir, mode) {
        warn!(dir = %label, "failed to watch dir: {e}");
        return;
    }
    if let Ok(mut watchers) = WATCHERS.lock() {
        watchers.push(debouncer);
    }
    debug!(dir = %label, "watcher started");
}
