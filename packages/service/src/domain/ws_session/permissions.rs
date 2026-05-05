use std::path::{Path, PathBuf};

/// Canonicalize a worktree path once for reuse across runtime setup.
pub fn canonicalize_worktree(worktree_path: &Path) -> PathBuf {
    worktree_path
        .canonicalize()
        .unwrap_or_else(|_| worktree_path.to_path_buf())
}
