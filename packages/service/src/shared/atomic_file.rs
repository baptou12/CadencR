//! Atomic file writes: write a sibling temp file, then rename over the target.
//!
//! Every user-editable JSON document the app owns (settings, themes) goes
//! through this, so a reader — or a directory watcher — never observes a
//! half-written file. The temp file is dot-prefixed both to keep it out of
//! directory listings and because the watchers filter dotfiles out, which is
//! what stops our own writes from broadcasting a partial document.

use std::path::Path;

use crate::error::AppError;

pub fn write_atomic(path: &Path, content: &str) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Internal(format!("path has no parent: {}", path.display())))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| AppError::Internal(format!("failed to create {}: {e}", parent.display())))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Internal(format!("path has no file name: {}", path.display())))?;
    let tmp = parent.join(format!(".{file_name}.tmp"));
    std::fs::write(&tmp, content)
        .map_err(|e| AppError::Internal(format!("failed to write {}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        // Don't leave a stale temp file behind for the next reader to trip over.
        let _ = std::fs::remove_file(&tmp);
        AppError::Internal(format!("failed to commit {}: {e}", path.display()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_through_a_temp_file_and_leaves_none_behind() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.json");
        write_atomic(&path, "{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");

        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with('.'))
            .collect();
        assert!(leftovers.is_empty(), "temp file must not survive");
    }

    #[test]
    fn creates_missing_parent_directories() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested/deeper/doc.json");
        write_atomic(&path, "x").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "x");
    }

    #[test]
    fn overwrites_an_existing_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.json");
        write_atomic(&path, "old").unwrap();
        write_atomic(&path, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }
}
