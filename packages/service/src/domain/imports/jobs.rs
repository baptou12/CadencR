//! In-memory registry of in-flight import jobs.
//!
//! Imports run as a `tokio::spawn`-ed task that mutates the matching entry;
//! the HTTP polling endpoint just clones the entry. We don't persist jobs:
//! a service restart drops them, and the user simply re-runs the import
//! (already-imported sessions are skipped, so this is safe).

use std::sync::Arc;

use dashmap::DashMap;

use super::models::{ImportJobState, ImportJobStatus};

#[derive(Clone, Default)]
pub struct ImportJobRegistry {
    inner: Arc<DashMap<String, ImportJobState>>,
}

impl ImportJobRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a freshly-created job in `Running` status.
    pub fn insert_running(&self, job_id: String, total: u32) {
        let state = ImportJobState {
            job_id: job_id.clone(),
            status: ImportJobStatus::Running,
            total,
            completed: 0,
            imported: Vec::new(),
            skipped: Vec::new(),
        };
        self.inner.insert(job_id, state);
    }

    pub fn get(&self, job_id: &str) -> Option<ImportJobState> {
        self.inner.get(job_id).map(|e| e.clone())
    }

    /// Apply a mutation to the job state. No-op if the job is missing.
    pub fn update<F>(&self, job_id: &str, f: F)
    where
        F: FnOnce(&mut ImportJobState),
    {
        if let Some(mut entry) = self.inner.get_mut(job_id) {
            f(entry.value_mut());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_get_round_trip() {
        let r = ImportJobRegistry::new();
        r.insert_running("job-1".into(), 3);
        let fetched = r.get("job-1").unwrap();
        assert!(matches!(fetched.status, ImportJobStatus::Running));
        assert_eq!(fetched.total, 3);
        assert_eq!(fetched.completed, 0);
    }

    #[test]
    fn update_mutates_in_place() {
        let r = ImportJobRegistry::new();
        r.insert_running("job-2".into(), 2);
        r.update("job-2", |s| {
            s.completed = 1;
            s.status = ImportJobStatus::Done;
        });
        let fetched = r.get("job-2").unwrap();
        assert_eq!(fetched.completed, 1);
        assert!(matches!(fetched.status, ImportJobStatus::Done));
    }

    #[test]
    fn update_missing_is_noop() {
        let r = ImportJobRegistry::new();
        r.update("nope", |s| s.completed = 99);
        assert!(r.get("nope").is_none());
    }
}
