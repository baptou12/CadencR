use super::invalid;
use crate::error::AppError;
use std::path::Path;

pub fn secure(root: &Path, path: &Path) -> Result<(), AppError> {
    if !path.starts_with(root) {
        return Err(invalid("managed tab path escapes storage"));
    }
    if path != root {
        secure(
            root,
            path.parent()
                .ok_or_else(|| invalid("storage parent missing"))?,
        )?;
    }
    match path.symlink_metadata() {
        Ok(meta) => {
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err(invalid("tab directory must be real"));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt as _;
                if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
                    return Err(invalid("tab storage must be owner-only"));
                }
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            crate::remote::secure_fs::create_dir_owner_only(path).map_err(invalid)
        }
        Err(e) => Err(invalid(e)),
    }
}
pub fn write_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    use std::io::Write as _;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(invalid)?;
    file.write_all(bytes).map_err(invalid)?;
    file.sync_all().map_err(invalid)
}

pub(super) fn check_directory(root: &Path, path: &Path) -> Result<(), AppError> {
    if !path.starts_with(root) {
        return Err(invalid("tab directory escapes storage"));
    }
    for ancestor in path.ancestors() {
        let meta = ancestor.symlink_metadata().map_err(invalid)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(invalid("tab storage contains a symlink or non-directory"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
                return Err(invalid("tab storage permissions are unsafe"));
            }
        }
        if ancestor == root {
            break;
        }
    }
    Ok(())
}
