//! Reclaim only complete, byte-identical managed artifacts, never arbitrary trees.
use super::{check_directory, invalid, io, owner, verify_identity, Receipt, LIMIT};
use crate::error::AppError;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, OnceLock, Weak},
};

mod admission;
mod coordination;
mod proof;
pub(super) use admission::{admit_owner, remove_empty_owner};
pub(super) use coordination::owner_state;
#[cfg(test)]
use proof::database;
use proof::{recognized, remove};

const MAX_REVISIONS: usize = 16;
const MAX_OWNERS: usize = 128;
#[derive(Default, Debug)]
pub(super) struct State {
    leases: HashMap<PathBuf, Weak<()>>,
}

/// Hold this for the whole guest/stream lifetime, not just filesystem lookup.
#[derive(Clone, Debug)]
pub struct RevisionLease {
    directory: PathBuf,
    root: PathBuf,
    id: String,
    _pin: Arc<()>,
    _owner: coordination::OwnerState,
}
impl RevisionLease {
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn read(&self) -> Result<cadencr_plugin_core::tab::TabManifest, AppError> {
        super::cache::read_directory(&self.root, &self.id, &self.directory)
    }
    pub fn verify_asset(&self, file: &Path) -> Result<(), AppError> {
        super::cache::verify_directory_asset(&self.root, &self.id, &self.directory, file)
    }
}
pub fn lease(root: &Path, id: &str) -> Result<Option<RevisionLease>, AppError> {
    owner(root, id)?;
    if !root.try_exists().map_err(invalid)? {
        return Ok(None);
    }
    let cell = owner_state(root, id)?;
    let mut state = cell.lock().map_err(invalid)?;
    let Some(directory) = super::directory(root, id)? else {
        return Ok(None);
    };
    state.leases.retain(|_, lease| lease.strong_count() > 0);
    let key = directory.canonicalize().map_err(invalid)?;
    let pin = state
        .leases
        .get(&key)
        .and_then(Weak::upgrade)
        .unwrap_or_else(|| Arc::new(()));
    state.leases.insert(key, Arc::downgrade(&pin));
    Ok(Some(RevisionLease {
        directory,
        root: root.to_owned(),
        id: id.to_owned(),
        _pin: pin,
        _owner: cell.clone(),
    }))
}

pub(super) fn prepare(root: &Path, id: &str, state: &State) -> Result<(), AppError> {
    let owned = owner(root, id)?;
    collect(root, id, state)?;
    // Count every entry, including unknown/interrupted staging. Unknown data is
    // preserved and consumes capacity rather than being silently deleted.
    if std::fs::read_dir(&owned)
        .map_err(invalid)?
        .take(MAX_REVISIONS + 1)
        .count()
        >= MAX_REVISIONS + usize::from(owned.join("active.json").try_exists().map_err(invalid)?)
    {
        return Err(full());
    }
    Ok(())
}
fn full() -> AppError {
    AppError::coded(axum::http::StatusCode::CONFLICT, "MANAGED_TAB_STORAGE_FULL",
        "Managed tab storage is full. Close running custom tabs and retry; retained unknown, changed, database, or interrupted files require manual review. No user files were removed.")
}

pub(super) fn collect(root: &Path, id: &str, state: &State) -> Result<(), AppError> {
    let owned = owner(root, id)?;
    check_directory(root, &owned)?;
    let active = super::directory(root, id)?;
    for entry in std::fs::read_dir(&owned).map_err(invalid)? {
        let entry = entry.map_err(invalid)?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(is_digest(&name) || name.starts_with(".stage-")) {
            continue;
        }
        let directory = path.join(id);
        if active.as_ref() == Some(&directory)
            || directory
                .canonicalize()
                .ok()
                .and_then(|key| state.leases.get(&key))
                .is_some_and(|pin| pin.strong_count() > 0)
        {
            continue;
        }
        // An unrecognized or modified artifact is not ours to remove. Its
        // occupied slot remains visible to admission; deletion errors propagate.
        if let Ok(plan) = recognized(root, id, &path) {
            remove(&path, &plan)?;
            super::cache::invalidate(&directory)?;
        }
    }
    Ok(())
}
fn is_digest(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::super::{commit, deactivate, directory, fixtures::fixture_revision, secure};
    use super::*;

    fn install(temp: &Path, root: &Path, revision: usize) -> PathBuf {
        let (receipt, archive, files, _) =
            fixture_revision(&temp.join(format!("fixture-{revision}")), revision);
        commit(root, &receipt, &archive, &files).unwrap();
        directory(root, "graph").unwrap().unwrap()
    }

    #[test]
    fn repeated_updates_reclaim_history_but_preserve_current_and_leased_revisions() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("managed");
        let first = install(temp.path(), &root, 0);
        let held = lease(&root, "graph").unwrap().unwrap();
        let second = install(temp.path(), &root, 1);
        for revision in 2..40 {
            let previous = directory(&root, "graph").unwrap().unwrap();
            let current = install(temp.path(), &root, revision);
            assert!(current.exists());
            assert!(
                previous.exists(),
                "the previous active revision is retained"
            );
            assert!(first.exists(), "a reader's selected revision stays intact");
            assert!(std::fs::read_dir(root.join("graph")).unwrap().count() <= 4);
        }
        assert!(!second.exists());
        drop(held);
        install(temp.path(), &root, 40);
        assert!(!first.exists());
    }

    #[test]
    fn uninstall_preserves_leased_assets_and_releases_them_on_next_collection() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("managed");
        let first = install(temp.path(), &root, 0);
        let held = lease(&root, "graph").unwrap().unwrap();
        deactivate(&root, "graph").unwrap();
        assert!(directory(&root, "graph").unwrap().is_none());
        assert!(first.exists());
        drop(held);
        install(temp.path(), &root, 1);
        assert!(!first.exists());
        deactivate(&root, "graph").unwrap();
        assert!(!root.join("graph").exists());
    }

    #[test]
    fn modified_unknown_database_and_incomplete_stage_files_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("managed");
        let first = install(temp.path(), &root, 0);
        let database = first.join("dist/state.bin");
        std::fs::write(&database, b"SQLite format 3\0precious").unwrap();
        let second = install(temp.path(), &root, 1);
        std::fs::write(second.join("dist/index.html"), "editable work").unwrap();
        let stage = root.join("graph/.stage-interrupted");
        secure(&root, &stage).unwrap();
        std::fs::write(stage.join("notes.txt"), "user notes").unwrap();
        let third = install(temp.path(), &root, 2);
        std::fs::write(third.join("dist/cache.db"), "db").unwrap();
        install(temp.path(), &root, 3);
        deactivate(&root, "graph").unwrap();
        assert_eq!(
            std::fs::read(database).unwrap(),
            b"SQLite format 3\0precious"
        );
        assert_eq!(
            std::fs::read_to_string(second.join("dist/index.html")).unwrap(),
            "editable work"
        );
        assert!(third.join("dist/cache.db").exists());
        assert!(stage.join("notes.txt").exists());
    }

    #[test]
    fn complete_interrupted_stages_are_reclaimed_unknown_entries_consume_capacity() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("managed");
        let first = install(temp.path(), &root, 0);
        let staged = root.join("graph/.stage-interrupted");
        std::fs::rename(first.parent().unwrap(), &staged).unwrap();
        // A crash before activation: remove the dangling pointer, never any DB.
        std::fs::remove_file(root.join("graph/active.json")).unwrap();
        install(temp.path(), &root, 1);
        assert!(!staged.exists());
        for number in 0..MAX_REVISIONS - 1 {
            std::fs::write(root.join(format!("graph/unknown-{number}")), "preserve").unwrap();
        }
        let (receipt, archive, files, _) = fixture_revision(&temp.path().join("next"), 2);
        assert!(matches!(
            commit(&root, &receipt, &archive, &files),
            Err(AppError::Coded {
                code: "MANAGED_TAB_STORAGE_FULL",
                ..
            })
        ));
        assert!(directory(&root, "graph")
            .unwrap()
            .unwrap()
            .join("tab.json")
            .is_file());
    }

    #[test]
    fn full_in_use_history_refuses_growth_then_recovers_after_readers_close() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("managed");
        let mut readers = Vec::new();
        for revision in 0..MAX_REVISIONS {
            install(temp.path(), &root, revision);
            readers.push(lease(&root, "graph").unwrap().unwrap());
        }
        let current = directory(&root, "graph").unwrap().unwrap();
        let (receipt, archive, files, _) =
            fixture_revision(&temp.path().join("next"), MAX_REVISIONS);
        assert!(matches!(
            commit(&root, &receipt, &archive, &files),
            Err(AppError::Coded {
                code: "MANAGED_TAB_STORAGE_FULL",
                ..
            })
        ));
        assert_eq!(directory(&root, "graph").unwrap().unwrap(), current);
        assert!(readers.iter().all(|reader| reader.directory().exists()));
        drop(readers);
        commit(&root, &receipt, &archive, &files).unwrap();
        assert!(std::fs::read_dir(root.join("graph")).unwrap().count() <= 3);
    }

    #[test]
    fn database_detection_covers_suffixes_and_sqlite_magic_without_suffix() {
        assert!(database(
            Path::new("dist/value.bin"),
            b"SQLite format 3\0data"
        ));
        for name in [
            "state.db",
            "state.db-wal",
            "state.sqlite-shm",
            "state.sqlite3",
            "cache.MDB",
            "a.duckdb",
        ] {
            assert!(database(Path::new(name), b"data"));
        }
        assert!(!database(Path::new("dist/app.js"), b"script"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_hardlinks_are_never_collected_or_followed() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("managed");
        let first = install(temp.path(), &root, 0);
        let outside = temp.path().join("database.db");
        std::fs::write(&outside, "precious").unwrap();
        symlink(&outside, first.join("dist/database-link")).unwrap();
        let second = install(temp.path(), &root, 1);
        let hardlink = temp.path().join("retained.html");
        std::fs::hard_link(second.join("dist/index.html"), &hardlink).unwrap();
        install(temp.path(), &root, 2);
        deactivate(&root, "graph").unwrap();
        assert!(first.exists());
        assert!(second.exists());
        assert_eq!(std::fs::read_to_string(outside).unwrap(), "precious");
        assert_eq!(
            std::fs::read_to_string(hardlink).unwrap(),
            "<html>Graph</html>"
        );
    }
}
