use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Validate that `file_path` (relative) resolved under `project_path` stays
/// within the project directory.  Returns the canonical absolute path.
pub fn validate_path(project_path: &str, relative_path: &str) -> Result<PathBuf, AppError> {
    let project = std::fs::canonicalize(project_path)
        .map_err(|e| AppError::BadRequest(format!("Invalid project path: {e}")))?;

    let target = project.join(relative_path);
    let canonical = std::fs::canonicalize(&target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("Path not found: {}", target.display()))
        } else {
            AppError::BadRequest(format!("Cannot access path: {e}"))
        }
    })?;

    if !canonical.starts_with(&project) {
        return Err(AppError::BadRequest(
            "Path is outside the project directory".to_string(),
        ));
    }

    Ok(canonical)
}

/// Validate path for writing — the file may not exist yet, so we canonicalize
/// the parent directory instead.
pub fn validate_path_for_write(project_path: &str, relative_path: &str) -> Result<PathBuf, AppError> {
    let project = std::fs::canonicalize(project_path)
        .map_err(|e| AppError::BadRequest(format!("Invalid project path: {e}")))?;

    let target = project.join(relative_path);

    let parent = target.parent().ok_or_else(|| {
        AppError::BadRequest("Invalid file path".to_string())
    })?;

    let canonical_parent = std::fs::canonicalize(parent).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound(format!("Parent directory not found: {}", parent.display()))
        } else {
            AppError::BadRequest(format!("Cannot access path: {e}"))
        }
    })?;

    if !canonical_parent.starts_with(&project) {
        return Err(AppError::BadRequest(
            "Path is outside the project directory".to_string(),
        ));
    }

    let file_name = target.file_name().ok_or_else(|| {
        AppError::BadRequest("Invalid file name".to_string())
    })?;

    Ok(canonical_parent.join(file_name))
}

/// Check if a file appears to be binary by looking for null bytes in the first 8KB.
pub fn is_binary(path: &Path) -> Result<bool, std::io::Error> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buf = [0u8; 8192];
    let n = file.read(&mut buf)?;
    Ok(buf[..n].contains(&0))
}

/// Build a gitignore matcher for the project root using the `ignore` crate.
pub fn build_gitignore(project_path: &Path) -> Option<ignore::gitignore::Gitignore> {
    let gitignore_path = project_path.join(".gitignore");
    if !gitignore_path.exists() {
        return None;
    }

    let mut builder = ignore::gitignore::GitignoreBuilder::new(project_path);
    builder.add(&gitignore_path);
    builder.build().ok()
}

/// Check if a path is matched by the gitignore rules.
pub fn is_gitignored(
    gitignore: Option<&ignore::gitignore::Gitignore>,
    path: &Path,
    is_dir: bool,
) -> bool {
    match gitignore {
        Some(gi) => gi.matched(path, is_dir).is_ignore(),
        None => false,
    }
}
