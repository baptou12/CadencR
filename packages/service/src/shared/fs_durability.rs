use std::path::Path;

#[cfg(unix)]
pub fn sync_directory(path: &Path) -> std::io::Result<()> {
    std::fs::File::open(path)?.sync_all()
}

#[cfg(not(unix))]
pub fn sync_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
