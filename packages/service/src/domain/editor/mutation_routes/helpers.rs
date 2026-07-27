#[cfg(unix)]
use std::ffi::CString;
use std::path::Path;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Reject names that contain path separators or traversal segments. The new
/// name is always a single path component — the caller chooses the parent.
pub(super) fn validate_simple_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::BadRequest("Name cannot be empty".to_string()));
    }
    if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(AppError::BadRequest(
            "Name must be a single path component".to_string(),
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn path_c_string(path: &Path) -> std::io::Result<CString> {
    use std::os::unix::ffi::OsStrExt;

    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))
}

/// Atomically rename without replacing an existing destination.
pub(super) fn rename_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let source = path_c_string(source)?;
        let destination = path_c_string(destination)?;
        // SAFETY: both pointers come from live `CString` values and remain
        // valid for the duration of the call.
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                destination.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let source = path_c_string(source)?;
        let destination = path_c_string(destination)?;
        // SAFETY: both pointers come from live `CString` values and remain
        // valid for the duration of the call.
        let result =
            unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(windows)]
    {
        std::fs::rename(source, destination)
    }
    #[cfg(all(
        unix,
        not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "ios"
        ))
    ))]
    {
        let _ = (source, destination);
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "atomic no-replace rename is unsupported on this platform",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    pub(super) fn validate_simple_name_rejects_separators_and_traversal() {
        assert!(validate_simple_name("foo.txt").is_ok());
        assert!(validate_simple_name("").is_err());
        assert!(validate_simple_name("a/b").is_err());
        assert!(validate_simple_name("a\\b").is_err());
        assert!(validate_simple_name("..").is_err());
        assert!(validate_simple_name(".").is_err());
    }

    #[test]
    fn rename_no_replace_preserves_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let destination = dir.path().join("destination");
        std::fs::write(&source, "source").unwrap();
        std::fs::write(&destination, "destination").unwrap();

        let error = rename_no_replace(&source, &destination).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "source");
        assert_eq!(
            std::fs::read_to_string(&destination).unwrap(),
            "destination"
        );
    }

    #[test]
    fn rename_no_replace_moves_file_and_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file");
        let moved_file = dir.path().join("moved-file");
        std::fs::write(&file, "content").unwrap();
        rename_no_replace(&file, &moved_file).unwrap();
        assert_eq!(std::fs::read_to_string(&moved_file).unwrap(), "content");

        let folder = dir.path().join("folder");
        let moved_folder = dir.path().join("moved-folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("nested"), "content").unwrap();
        rename_no_replace(&folder, &moved_folder).unwrap();
        assert_eq!(
            std::fs::read_to_string(moved_folder.join("nested")).unwrap(),
            "content"
        );
    }
}
