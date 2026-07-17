#![allow(dead_code)] // Phase 0 ownership boundary; mutation handlers arrive later.

use std::collections::HashSet;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Process-local single-flight boundary for foreground Git mutations.
///
/// `AppState` owns one shared instance. Every later index, stash, and
/// update-branch handler must acquire a permit after resolving the feature's
/// worktree and before spawning Git. Canonical paths make linked aliases share
/// one key; background read commands remain outside this guard.
#[derive(Debug, Default)]
pub struct GitMutationGuard {
    active_worktrees: Mutex<HashSet<PathBuf>>,
}

impl GitMutationGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Acquire the mutation slot for an existing worktree without waiting.
    /// A second request receives `Busy` instead of racing into `index.lock`.
    pub fn try_acquire(
        self: &Arc<Self>,
        worktree_path: &Path,
    ) -> Result<GitMutationPermit, GitMutationGuardError> {
        let canonical_path = std::fs::canonicalize(worktree_path).map_err(|source| {
            GitMutationGuardError::InvalidWorktree {
                path: worktree_path.to_path_buf(),
                source,
            }
        })?;
        let mut active = self
            .active_worktrees
            .lock()
            .map_err(|_| GitMutationGuardError::RegistryUnavailable)?;
        if !active.insert(canonical_path.clone()) {
            return Err(GitMutationGuardError::Busy {
                worktree_path: canonical_path,
            });
        }
        drop(active);

        Ok(GitMutationPermit {
            guard: Arc::clone(self),
            worktree_path: canonical_path,
        })
    }
}

/// RAII permit held for the full foreground Git command. Dropping it releases
/// the worktree slot on success, expected conflict, or early error.
#[derive(Debug)]
pub struct GitMutationPermit {
    guard: Arc<GitMutationGuard>,
    worktree_path: PathBuf,
}

impl GitMutationPermit {
    pub fn worktree_path(&self) -> &Path {
        &self.worktree_path
    }
}

impl Drop for GitMutationPermit {
    fn drop(&mut self) {
        match self.guard.active_worktrees.lock() {
            Ok(mut active) => {
                active.remove(&self.worktree_path);
            }
            Err(poisoned) => {
                poisoned.into_inner().remove(&self.worktree_path);
            }
        }
    }
}

#[derive(Debug)]
pub enum GitMutationGuardError {
    InvalidWorktree {
        path: PathBuf,
        source: std::io::Error,
    },
    Busy {
        worktree_path: PathBuf,
    },
    RegistryUnavailable,
}

impl fmt::Display for GitMutationGuardError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidWorktree { path, source } => write!(
                formatter,
                "could not resolve Git worktree {}: {source}",
                path.display()
            ),
            Self::Busy { worktree_path } => write!(
                formatter,
                "another Git mutation is already running for {}",
                worktree_path.display()
            ),
            Self::RegistryUnavailable => {
                formatter.write_str("the Git mutation registry is unavailable")
            }
        }
    }
}

impl std::error::Error for GitMutationGuardError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidWorktree { source, .. } => Some(source),
            Self::Busy { .. } | Self::RegistryUnavailable => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_mutations_by_canonical_worktree_path() {
        let worktree = tempfile::tempdir().unwrap();
        let guard = Arc::new(GitMutationGuard::new());
        let permit = guard.try_acquire(worktree.path()).unwrap();

        let alias = worktree.path().join(".");
        let error = guard.try_acquire(&alias).unwrap_err();
        assert!(matches!(error, GitMutationGuardError::Busy { .. }));

        drop(permit);
        assert!(guard.try_acquire(&alias).is_ok());
    }

    #[test]
    fn permits_different_worktrees_concurrently() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let guard = Arc::new(GitMutationGuard::new());

        let first_permit = guard.try_acquire(first.path()).unwrap();
        let second_permit = guard.try_acquire(second.path()).unwrap();

        assert_eq!(
            first_permit.worktree_path(),
            first.path().canonicalize().unwrap()
        );
        assert_eq!(
            second_permit.worktree_path(),
            second.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn rejects_a_missing_worktree_key() {
        let guard = Arc::new(GitMutationGuard::new());
        let missing = std::env::temp_dir().join("cadencr-missing-git-mutation-worktree");

        let error = guard.try_acquire(&missing).unwrap_err();
        assert!(matches!(
            error,
            GitMutationGuardError::InvalidWorktree { .. }
        ));
    }
}
