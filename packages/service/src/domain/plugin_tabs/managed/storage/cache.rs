//! Immutable proofs are expensive to unpack; reuse them while every inode is unchanged.
use super::{invalid, io};
use crate::error::AppError;
use cadencr_plugin_core::tab::TabManifest;
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[derive(PartialEq, Eq)]
struct Stamp {
    length: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64, u32, u64),
}
struct Cached {
    manifest: TabManifest,
    files: BTreeMap<PathBuf, Stamp>,
}
static CACHE: OnceLock<Mutex<HashMap<PathBuf, Cached>>> = OnceLock::new();

fn stamp(path: &Path) -> Result<Stamp, AppError> {
    let meta = path.symlink_metadata().map_err(invalid)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(invalid("tab revision contains a non-regular file"));
    }
    Ok(Stamp {
        length: meta.len(),
        modified: meta.modified().map_err(invalid)?,
        #[cfg(unix)]
        identity: {
            use std::os::unix::fs::MetadataExt as _;
            (
                meta.dev(),
                meta.ino(),
                meta.ctime(),
                meta.ctime_nsec(),
                meta.mode(),
                meta.nlink(),
            )
        },
    })
}

pub(super) fn read(root: &Path, id: &str) -> Result<TabManifest, AppError> {
    let lease = super::lease(root, id)?.ok_or_else(|| invalid("managed tab is not installed"))?;
    read_directory(root, id, lease.directory())
}
pub(super) fn read_directory(root: &Path, id: &str, dir: &Path) -> Result<TabManifest, AppError> {
    let cache = CACHE.get_or_init(Mutex::default);
    {
        let entries = cache.lock().map_err(invalid)?;
        if let Some(entry) = entries.get(dir) {
            let mut unchanged = true;
            for (path, before) in &entry.files {
                if stamp(path)? != *before {
                    unchanged = false;
                    break;
                }
            }
            if unchanged {
                return Ok(entry.manifest.clone());
            }
        }
    }
    let revision = dir
        .parent()
        .ok_or_else(|| invalid("tab revision missing"))?;
    let archive = revision.join("archive.tar.gz");
    let receipt = revision.join("receipt.json");
    let mut stamps = BTreeMap::from([
        (archive.clone(), stamp(&archive)?),
        (receipt.clone(), stamp(&receipt)?),
    ]);
    let trust =
        crate::domain::agents::providers::installed::managed::trust::pinned_index_trust_store();
    let (_, files, manifest) = super::read_trusted_directory(root, id, dir, &trust)?;
    for (name, bytes) in files {
        let path = dir.join(name);
        let before = stamp(&path)?;
        if io::regular(&path, 32 * 1024 * 1024)? != bytes || stamp(&path)? != before {
            return Err(invalid("tab revision changed during verification"));
        }
        stamps.insert(path, before);
    }
    for path in [&archive, &receipt] {
        if stamps.get(path) != Some(&stamp(path)?) {
            return Err(invalid("tab proof changed during verification"));
        }
    }
    let mut entries = cache.lock().map_err(invalid)?;
    if entries.len() >= 32
        || entries
            .values()
            .map(|entry| entry.files.len())
            .sum::<usize>()
            + stamps.len()
            > 8192
    {
        entries.clear();
    }
    entries.insert(
        dir.to_owned(),
        Cached {
            manifest: manifest.clone(),
            files: stamps,
        },
    );
    Ok(manifest)
}

pub(super) fn verify_directory_asset(
    root: &Path,
    id: &str,
    dir: &Path,
    file: &Path,
) -> Result<(), AppError> {
    read_directory(root, id, dir)?;
    let canonical = dir.canonicalize().map_err(invalid)?;
    let relative = file.strip_prefix(&canonical).map_err(invalid)?;
    let key = dir.join(relative);
    let entries = CACHE.get_or_init(Mutex::default).lock().map_err(invalid)?;
    if entries
        .get(dir)
        .is_none_or(|entry| !entry.files.contains_key(&key))
    {
        return Err(invalid("asset is absent from the signed tab archive"));
    }
    Ok(())
}

/// A collected directory must never leave a stale authenticated cache entry.
pub(super) fn invalidate(directory: &Path) -> Result<(), AppError> {
    CACHE
        .get_or_init(Mutex::default)
        .lock()
        .map_err(invalid)?
        .remove(directory);
    Ok(())
}
