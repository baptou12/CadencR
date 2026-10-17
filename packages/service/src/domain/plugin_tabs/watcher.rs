//! Watches `~/.cadencr/plugins/tabs` and broadcasts when a tab changes.
//!
//! "Every change to `tab.json` or `dist/` reloads live instances": the author's
//! `vite build --watch` rewrites `dist/`, and clients subscribed through
//! `app/subscribe.plugin_tab_events` receive `app/plugin_tab_changed
//! {plugin_id}` and refetch or reload. `node_modules`, sources and dot-files
//! are ignored — they are not what Cadencr loads.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use tokio::sync::broadcast;
use tracing::warn;

use crate::shared::file_watch::watch_dir_coalesced;

/// Collapses a build's burst of writes into one event per batch.
const DEBOUNCE: Duration = Duration::from_millis(250);

/// Tab `plugin_id` changed on disk: its manifest, icon or build output.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PluginTabChangedEvent {
    pub plugin_id: String,
}

/// Start watching `dir` (created first: `notify` cannot watch a missing path,
/// and the first tab would otherwise never reload live). A rebuild touches
/// many files of one tab; each debounced batch yields one event per tab.
pub fn start(dir: &Path, tx: broadcast::Sender<PluginTabChangedEvent>) {
    if let Err(error) = crate::remote::secure_fs::create_dir_owner_only(dir) {
        warn!(dir = %dir.display(), "failed to create the custom tabs dir: {error}");
        return;
    }
    let roots = roots_of(dir);
    watch_dir_coalesced(dir, RecursiveMode::Recursive, DEBOUNCE, tx, move |path| {
        let plugin_id = changed_plugin_id(&roots, path)?;
        Some(PluginTabChangedEvent { plugin_id })
    });
}

/// The watched root as given and canonicalized: macOS reports `/private/var/…`
/// for a `/var/…` watch.
fn roots_of(dir: &Path) -> Vec<PathBuf> {
    let mut roots = vec![dir.to_path_buf()];
    if let Ok(canonical) = dir.canonicalize() {
        if canonical != dir {
            roots.push(canonical);
        }
    }
    roots
}

/// The tab id when `path` is `<root>/<id>/tab.json`, anything under
/// `<root>/<id>/dist/`, or an `.svg` (any case, any depth) — never inside a
/// dot-folder or `node_modules`. Walks the components lazily: a dependency
/// install reports thousands of paths, and most are refused at the second one.
fn changed_plugin_id(roots: &[PathBuf], path: &Path) -> Option<String> {
    let relative = roots.iter().find_map(|root| path.strip_prefix(root).ok())?;
    let mut segments = relative.components().map(|component| match component {
        Component::Normal(segment) => segment.to_str(),
        _ => None,
    });
    let id = segments.next()??;
    if id.starts_with('.') {
        return None;
    }
    let (mut first, mut last, mut depth) = (None, None, 0);
    for segment in segments {
        let segment = segment?;
        if segment.starts_with('.') || segment == "node_modules" {
            return None;
        }
        first.get_or_insert(segment);
        last = Some(segment);
        depth += 1;
    }
    let relevant = first == Some("dist")
        || (depth == 1 && first == Some(cadencr_plugin_core::tab::MANIFEST_FILE_NAME))
        || last.is_some_and(|name| name.to_ascii_lowercase().ends_with(".svg"));
    relevant.then(|| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(path: &str) -> Option<String> {
        changed_plugin_id(&[PathBuf::from("/t/tabs")], Path::new(path))
    }

    #[test]
    fn recognizes_manifest_icon_and_build_output() {
        assert_eq!(id("/t/tabs/graph/tab.json").as_deref(), Some("graph"));
        assert_eq!(id("/t/tabs/graph/icon.svg").as_deref(), Some("graph"));
        assert_eq!(
            id("/t/tabs/graph/assets/Icon.SVG").as_deref(),
            Some("graph")
        );
        assert_eq!(id("/t/tabs/graph/dist").as_deref(), Some("graph"));
        assert_eq!(
            id("/t/tabs/graph/dist/assets/app.js").as_deref(),
            Some("graph")
        );
    }

    #[test]
    fn ignores_sources_dependencies_and_dot_files() {
        for path in [
            "/t/tabs",
            "/t/tabs/graph",
            "/t/tabs/graph/src/App.tsx",
            "/t/tabs/graph/node_modules/react/index.js",
            "/t/tabs/graph/.git/index",
            "/t/tabs/graph/.tab.json.tmp",
            "/t/tabs/graph/dist/.vite/manifest.json",
            "/t/tabs/graph/src/tab.json",
            "/t/tabs/graph/node_modules/pkg/logo.svg",
            "/t/tabs/.trash/tab.json",
            "/elsewhere/graph/tab.json",
        ] {
            assert_eq!(id(path), None, "{path}");
        }
    }

    #[test]
    fn matches_either_spelling_of_the_root() {
        let roots = [PathBuf::from("/var/t"), PathBuf::from("/private/var/t")];
        assert_eq!(
            changed_plugin_id(&roots, Path::new("/private/var/t/g/tab.json")).as_deref(),
            Some("g")
        );
    }
}
