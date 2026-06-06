//! Filesystem helpers for the remote-access secrets (TLS private key, device
//! pepper). Both must never be world/group-readable, and must never *briefly*
//! be readable either — so we create them `0600` from the first byte rather
//! than writing at the umask default and tightening afterwards.

use std::path::Path;

use anyhow::{Context, Result};

/// Write secret `bytes` to `path`, owner-read/write only (`0600`). On Unix the
/// file is created with that mode atomically via `OpenOptions::mode`, closing
/// the window where it would otherwise exist at the umask default; the explicit
/// re-chmod afterwards covers the case where the file already existed (open with
/// `create` keeps a pre-existing file's mode). On non-Unix this is a plain write.
pub fn write_secret(path: &Path, bytes: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .with_context(|| format!("open {} (0600)", path.display()))?;
        file.write_all(bytes)
            .with_context(|| format!("write {}", path.display()))?;
        ensure_owner_only(path)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes).with_context(|| format!("write {}", path.display()))
    }
}

/// Re-assert `0600` on an existing secret file (no-op on non-Unix). Defensive:
/// our own writes already create it `0600`, but a file restored from a backup,
/// copied, or touched by the user could be looser — so we tighten it whenever we
/// load it, not only when we create it.
pub fn ensure_owner_only(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("chmod 600 {}", path.display()))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn writes_new_secret_owner_only() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("secret");
        write_secret(&path, b"top secret").unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(std::fs::read(&path).unwrap(), b"top secret");
    }

    #[test]
    fn tightens_a_loose_preexisting_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("secret");
        std::fs::write(&path, b"old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_secret(&path, b"new").unwrap();
        assert_eq!(mode(&path), 0o600, "rewrite must re-tighten perms");

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        ensure_owner_only(&path).unwrap();
        assert_eq!(mode(&path), 0o600, "load-time tighten must fix perms");
    }
}
