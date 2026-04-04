use std::path::{Path, PathBuf};
use std::time::SystemTime;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};

use crate::error::AppError;

/// A file match result with path and matched character positions.
pub struct FileMatch {
    pub path: String,
    pub positions: Vec<u32>,
}

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

/// Return the `limit` most recently modified files under `project_path`.
pub fn recent_files(project_path: &str, limit: usize) -> Result<Vec<String>, AppError> {
    let project = std::fs::canonicalize(project_path)
        .map_err(|e| AppError::BadRequest(format!("Invalid project path: {e}")))?;

    let mut entries: Vec<(String, SystemTime)> = Vec::new();

    for result in ignore::WalkBuilder::new(&project).build() {
        let entry = result.map_err(|e| AppError::Internal(e.to_string()))?;
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(true) {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(&project)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .to_string_lossy()
            .to_string();

        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        entries.push((relative, mtime));
    }

    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries.truncate(limit);

    Ok(entries.into_iter().map(|(path, _)| path).collect())
}

/// Fuzzy-search files under `project_path` matching `query`.
/// Returns up to `limit` results sorted by match score, with match positions.
pub fn fuzzy_search_files(
    project_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<FileMatch>, AppError> {
    let project = std::fs::canonicalize(project_path)
        .map_err(|e| AppError::BadRequest(format!("Invalid project path: {e}")))?;

    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut scored: Vec<(String, u32, Vec<u32>)> = Vec::new();
    let mut buf = Vec::new();

    for result in ignore::WalkBuilder::new(&project).build() {
        let entry = result.map_err(|e| AppError::Internal(e.to_string()))?;
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(true) {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(&project)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .to_string_lossy()
            .to_string();

        let haystack = Utf32Str::new(&relative, &mut buf);
        let mut indices = Vec::new();

        if let Some(score) = pattern.indices(haystack, &mut matcher, &mut indices) {
            scored.push((relative, score, indices));
        }
    }

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.truncate(limit);

    Ok(scored
        .into_iter()
        .map(|(path, _, positions)| FileMatch { path, positions })
        .collect())
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
