//! File-content fetchers used by the diff viewer (single + batch) and
//! `ls-files` listing.

use std::path::Path;

use crate::domain::git::file_size::classify_content;
use crate::domain::git::models::FileContentBatchItem;
use crate::error::AppError;
use crate::shared::git_cli::run_git_safe_refs;

use super::util::run_git_quiet;

/// Get file content at a given ref, or from working tree if ref is None.
pub async fn get_file_content(
    worktree_path: &Path,
    file_path: &str,
    ref_spec: Option<&str>,
) -> Result<String, AppError> {
    match ref_spec {
        None => {
            // Read from working tree — validate against path traversal
            let full_path = worktree_path.join(file_path);
            let canonical_wt = worktree_path
                .canonicalize()
                .map_err(|e| AppError::BadRequest(format!("Invalid worktree path: {e}")))?;
            let canonical_file = full_path
                .canonicalize()
                .map_err(|_| AppError::BadRequest("File not found".into()))?;
            if !canonical_file.starts_with(&canonical_wt) {
                return Err(AppError::BadRequest("Path traversal not allowed".into()));
            }
            Ok(tokio::fs::read_to_string(&canonical_file)
                .await
                .unwrap_or_default())
        }
        Some(r) => {
            let show_arg = format!("{r}:{file_path}");
            Ok(
                run_git_safe_refs(&["show"], &[], &[&show_arg], worktree_path)
                    .await
                    .unwrap_or_default(),
            )
        }
    }
}

/// Get file content for multiple files (batch).
///
/// We fetch both sides of every file (same per-file cost as the original
/// implementation) and then derive size + binary + large flags from the
/// returned content. For binary files or files whose largest side meets
/// `LARGE_FILE_BYTES`, content is omitted from the response — the frontend
/// renders a placeholder and pulls the content via the single-file endpoint
/// on opt-in. Deriving metadata from the already-fetched content avoids
/// adding extra git calls per file (which was making the batch slow and
/// produced visible empty blocks while the diff view loaded).
pub async fn get_file_content_batch(
    git_path: &Path,
    file_paths: &[String],
    old_ref: &str,
    new_ref: Option<&str>,
) -> Result<Vec<FileContentBatchItem>, AppError> {
    if file_paths.is_empty() {
        return Ok(Vec::new());
    }

    use futures::stream::{self, StreamExt};

    let git_path = git_path.to_path_buf();
    let old_ref = old_ref.to_string();
    let new_ref = new_ref.map(|s| s.to_string());

    let items: Vec<FileContentBatchItem> = stream::iter(file_paths.to_vec())
        .map(|file_path| {
            let git_path = git_path.clone();
            let old_ref = old_ref.clone();
            let new_ref = new_ref.clone();
            async move {
                let (old, new) = tokio::join!(
                    get_file_content(&git_path, &file_path, Some(&old_ref)),
                    get_file_content(&git_path, &file_path, new_ref.as_deref()),
                );
                classify_content(
                    file_path,
                    old.unwrap_or_default(),
                    new.unwrap_or_default(),
                    /* keep_large_content */ false,
                )
            }
        })
        .buffer_unordered(20)
        .collect()
        .await;

    Ok(items)
}

/// List all git-tracked files.
pub async fn list_files(worktree_path: &Path) -> Result<Vec<String>, AppError> {
    let stdout = run_git_quiet(&["ls-files"], worktree_path).await;
    Ok(stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect())
}
