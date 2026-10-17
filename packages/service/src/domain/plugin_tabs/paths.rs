//! Where custom tabs live on disk, and what an id is allowed to be.

use std::path::PathBuf;

use axum::http::StatusCode;
use cadencr_plugin_core::tab::is_valid_tab_id;

use crate::error::AppError;

/// `~/.cadencr/plugins/tabs` in production: the sibling of `plugins/themes`,
/// never inside the app bundle. Per-test isolated in test builds (see
/// `settings_store::dir::sibling_dir`) — resolve it *before* `spawn_blocking`.
pub fn tabs_dir() -> PathBuf {
    crate::domain::settings_store::dir::sibling_dir("plugins").join("tabs")
}

/// The folder of tab `id`. Refuses anything that is not a tab id — the id is a
/// path segment here and a URL host label in the Electron host, so `.`, `/`
/// and uppercase can never reach either.
pub fn plugin_dir(id: &str) -> Result<PathBuf, AppError> {
    if !is_valid_tab_id(id) {
        return Err(AppError::coded(
            StatusCode::BAD_REQUEST,
            "PLUGIN_TAB_ID_INVALID",
            format!("`{id}` is not a valid custom tab id"),
        ));
    }
    let local = tabs_dir().join(id);
    match local.symlink_metadata() {
        Ok(_) => return Ok(local),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(AppError::Internal(format!(
                "cannot inspect local tab: {error}"
            )))
        }
    }
    Ok(super::managed::storage::directory(&super::managed::storage::root(), id)?.unwrap_or(local))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_dir_is_the_themes_sibling_under_plugins() {
        let dir = tabs_dir();
        assert_eq!(dir.file_name().unwrap(), "tabs");
        assert_eq!(dir.parent().unwrap().file_name().unwrap(), "plugins");
        assert_eq!(
            dir.parent().unwrap(),
            crate::domain::themes::paths::themes_dir().parent().unwrap()
        );
    }

    #[test]
    fn plugin_dir_refuses_traversal_and_non_label_ids() {
        for id in ["", "..", "../x", "a/b", "A", "-a", "a.b", "a b"] {
            assert!(plugin_dir(id).is_err(), "{id}");
        }
        assert_eq!(plugin_dir("graph").unwrap(), tabs_dir().join("graph"));
    }
}
