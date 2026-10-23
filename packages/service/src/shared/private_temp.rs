//! A scratch directory other local users cannot pre-create, read, or swap.
//!
//! macOS hands every user a private `$TMPDIR` (`/var/folders/…`), so
//! `std::env::temp_dir()` is already safe there and stays the location. On
//! Linux `temp_dir()` is the world-writable `/tmp`: a fixed name such as
//! `/tmp/cadencr-codex-attachments` can be squatted by another user, and a
//! predictable file name can be planted ahead of time. There we create one
//! `0700` directory per process with a random name and keep it for the
//! process lifetime.

use std::path::PathBuf;
use std::sync::OnceLock;

/// Parent directory for short-lived Cadencr scratch files.
pub fn private_temp_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "macos") {
        return Ok(std::env::temp_dir());
    }
    process_private_dir()
}

/// The per-process `0700` directory (the non-macOS branch). Recreated with the
/// same restrictive mode if a `/tmp` cleaner removed it under a long-running
/// service; `create_dir` fails rather than adopting a directory someone else
/// made in the meantime.
fn process_private_dir() -> Result<PathBuf, String> {
    static DIR: OnceLock<Result<tempfile::TempDir, String>> = OnceLock::new();
    let dir = DIR
        .get_or_init(|| {
            let mut builder = tempfile::Builder::new();
            builder.prefix("cadencr-");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                builder.permissions(std::fs::Permissions::from_mode(0o700));
            }
            builder
                .tempdir()
                .map_err(|error| format!("create private temp directory: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)?
        .path()
        .to_path_buf();
    if !dir.is_dir() {
        create_owner_only_dir(&dir)?;
    }
    Ok(dir)
}

fn create_owner_only_dir(dir: &std::path::Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(dir)
        .map_err(|error| format!("recreate private temp directory {}: {error}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_private_dir_is_stable_and_owner_only() {
        let first = process_private_dir().unwrap();
        assert_eq!(process_private_dir().unwrap(), first);
        assert!(first.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&first).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
    }

    #[test]
    fn recreate_refuses_an_existing_directory() {
        let parent = tempfile::tempdir().unwrap();
        let taken = parent.path().join("taken");
        std::fs::create_dir(&taken).unwrap();
        assert!(create_owner_only_dir(&taken).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keeps_the_per_user_tmpdir() {
        assert_eq!(private_temp_dir().unwrap(), std::env::temp_dir());
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn other_platforms_use_the_process_private_dir() {
        assert_eq!(private_temp_dir().unwrap(), process_private_dir().unwrap());
    }
}
