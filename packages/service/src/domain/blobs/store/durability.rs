use std::path::Path;

pub(super) fn ensure_blob_directories(root: &Path, shard: &Path) -> std::io::Result<()> {
    ensure_blob_directories_with(root, shard, crate::shared::fs_durability::sync_directory)
}

fn ensure_blob_directories_with(
    root: &Path,
    shard: &Path,
    sync: impl Fn(&Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    match std::fs::metadata(shard) {
        Ok(metadata) if metadata.is_dir() => return Ok(()),
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("blob shard is not a directory: {}", shard.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let root_missing = shard == root || !root.try_exists()?;
    std::fs::create_dir_all(shard)?;

    // Persist directory entries from the leaf upward. A successful blob write
    // may be the only copy left after the caller updates SQLite, so a power loss
    // must not be able to forget a newly created shard or blob root.
    if shard != root {
        sync(shard)?;
    }
    sync(root)?;
    if root_missing {
        if let Some(parent) = root.parent() {
            sync(parent)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[test]
    fn syncs_a_new_root_and_its_parent() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("blobs");
        let synced = Mutex::new(Vec::new());

        ensure_blob_directories_with(&root, &root, |path| {
            synced.lock().unwrap().push(path.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(
            synced.into_inner().unwrap(),
            vec![root, parent.path().to_path_buf()]
        );
    }

    #[test]
    fn syncs_a_new_shard_and_the_existing_root() {
        let root = tempfile::tempdir().unwrap();
        let shard = root.path().join("ab");
        let synced = Mutex::new(Vec::new());

        ensure_blob_directories_with(root.path(), &shard, |path| {
            synced.lock().unwrap().push(path.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(
            synced.into_inner().unwrap(),
            vec![shard, root.path().to_path_buf()]
        );
    }

    #[test]
    fn rejects_an_existing_non_directory_shard() {
        let root = tempfile::tempdir().unwrap();
        let shard = root.path().join("ab");
        std::fs::write(&shard, b"not a directory").unwrap();

        let error = ensure_blob_directories_with(root.path(), &shard, |_| Ok(())).unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&shard).unwrap(), b"not a directory");
    }
}
