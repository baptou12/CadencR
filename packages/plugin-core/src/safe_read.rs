//! The one bounded regular-file reader every plugin inspection uses.
//!
//! Plugin folders are user-writable and inspected without trust, so a file is
//! read only when it is a regular file both before and after opening it: the
//! open refuses to follow a symlink (`O_NOFOLLOW`) or block on a FIFO
//! (`O_NONBLOCK`), and the opened inode must be the one that was inspected.

use std::fs::{self, File, OpenOptions};
use std::io::Read as _;
use std::path::Path;

/// Read `path` when it is a regular file of at most `limit` bytes.
pub fn read_regular_bounded(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let before = fs::symlink_metadata(path)?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(std::io::Error::other(
            "must be a regular file (symlinks and special files are forbidden)",
        ));
    }
    if before.len() > limit {
        return Err(too_large(limit));
    }
    let file = open_regular(path, &before)?;
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(too_large(limit));
    }
    Ok(bytes)
}

fn too_large(limit: u64) -> std::io::Error {
    std::io::Error::other(format!("exceeds the {limit}-byte file limit"))
}

#[cfg(unix)]
fn open_regular(path: &Path, before: &fs::Metadata) -> std::io::Result<File> {
    use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let after = file.metadata()?;
    if !after.is_file() || before.dev() != after.dev() || before.ino() != after.ino() {
        return Err(std::io::Error::other("changed while being read"));
    }
    Ok(file)
}

#[cfg(not(unix))]
fn open_regular(path: &Path, before: &fs::Metadata) -> std::io::Result<File> {
    let file = OpenOptions::new().read(true).open(path)?;
    let after = file.metadata()?;
    if !after.is_file() || before.len() != after.len() {
        return Err(std::io::Error::other("changed while being read"));
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_bounded_regular_files_only() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("a.json");
        std::fs::write(&file, "1234").unwrap();
        assert_eq!(read_regular_bounded(&file, 4).unwrap(), b"1234");
        assert!(read_regular_bounded(&file, 3).is_err());
        assert!(read_regular_bounded(root.path(), 1024).is_err());
        assert_eq!(
            read_regular_bounded(&root.path().join("missing"), 4)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::NotFound
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("a.json");
        std::fs::write(&file, "1").unwrap();
        let link = root.path().join("link.json");
        std::os::unix::fs::symlink(&file, &link).unwrap();
        assert!(read_regular_bounded(&link, 4).is_err());
    }
}
