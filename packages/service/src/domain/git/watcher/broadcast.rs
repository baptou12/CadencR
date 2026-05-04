use std::path::Path;
use std::sync::atomic::Ordering;

use axum::extract::ws::Message;
use tokio::sync::mpsc;

use super::debouncer::{self, now_ms};
use super::handle::RecomputePing;
use super::registry::GitWatcherRegistry;
use super::subscription::broadcast_envelope;
use crate::app_state::AppState;

impl GitWatcherRegistry {
    /// Send an arbitrary envelope to every WS subscriber registered for
    /// `feature_id`, regardless of which worktree they're attached to.
    #[allow(dead_code)]
    pub async fn broadcast_to_feature(
        &self,
        feature_id: i64,
        envelope: &crate::domain::ws_session::protocol::WsEnvelope,
    ) {
        let senders = self.snapshot_subscribers(feature_id).await;
        broadcast_envelope(&senders, envelope);
    }

    /// Clone every WS sender currently subscribed for `feature_id`. Used by
    /// long-running streaming endpoints (commit) that want to broadcast many
    /// chunks without re-acquiring the registry lock per chunk.
    pub async fn snapshot_subscribers(
        &self,
        feature_id: i64,
    ) -> Vec<mpsc::UnboundedSender<Message>> {
        let inner = self.inner.lock().await;
        inner
            .handles
            .values()
            .flat_map(|h| h.subscribers.iter())
            .filter(|s| s.feature_id == feature_id)
            .map(|s| s.sender.clone())
            .collect()
    }

    /// Send `envelope` synchronously to every cloned WS sender in `senders`.
    /// This is the lock-free path used by streaming chunk emissions.
    pub fn broadcast_to_senders(
        senders: &[mpsc::UnboundedSender<Message>],
        envelope: &crate::domain::ws_session::protocol::WsEnvelope,
    ) {
        broadcast_envelope(senders, envelope);
    }

    /// Synchronously run `compute_status` for every feature subscribed to
    /// `worktree_path` and broadcast the resulting `git.status` envelopes.
    pub async fn recompute_now(&self, worktree_path: &Path, state: &AppState) {
        let canonical =
            std::fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf());
        debouncer::recompute_for_path(&self.inner, &canonical, state).await;
    }

    /// Push an explicit "recompute now" through the watcher and start the
    /// dedupe window so our own write doesn't bounce back as an fs event.
    pub async fn nudge(&self, worktree_path: &Path) {
        let canonical =
            std::fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf());
        let inner = self.inner.lock().await;
        if let Some(handle) = inner.handles.get(&canonical) {
            handle.last_nudge_ms.store(now_ms(), Ordering::Relaxed);
            let _ = handle.ping_tx.send(RecomputePing::Explicit);
        }
    }

    /// Drop every handle and abort their compute tasks.
    #[allow(dead_code)]
    pub async fn shutdown(&self) {
        let mut inner = self.inner.lock().await;
        let drained: Vec<_> = inner.handles.drain().collect();
        drop(inner);
        for (_, mut handle) in drained {
            let _ = handle.ping_tx.send(RecomputePing::Shutdown);
            handle.cancel_grace();
            handle.compute_task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    use super::super::handle::{spawn_handle, Subscriber};

    fn git_init(dir: &Path) {
        Command::new("git")
            .arg("init")
            .arg("-q")
            .current_dir(dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .status()
            .unwrap();
    }

    #[tokio::test]
    async fn nudge_sets_dedupe_window() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path());

        let registry = GitWatcherRegistry::new();
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let handle = spawn_handle(registry.inner.clone(), canonical.clone(), state).unwrap();
        let last_nudge = handle.last_nudge_ms.clone();
        {
            let mut inner = registry.inner.lock().await;
            inner.handles.insert(canonical.clone(), handle);
        }

        registry.nudge(&canonical).await;
        let stamped = last_nudge.load(Ordering::Relaxed);
        assert!(stamped > 0, "nudge should stamp last_nudge_ms");
        assert!(now_ms() - stamped < debouncer::NUDGE_DEDUPE_MS);

        registry.shutdown().await;
    }

    #[tokio::test]
    async fn recompute_now_broadcasts_synchronously() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path());
        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "init", "-q"])
            .current_dir(dir.path())
            .status()
            .unwrap();

        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let registry = GitWatcherRegistry::new();
        let handle =
            spawn_handle(registry.inner.clone(), canonical.clone(), state.clone()).unwrap();

        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        {
            let mut inner = registry.inner.lock().await;
            let mut handle = handle;
            handle.subscribers.push(Subscriber {
                feature_id: 42,
                sender: tx,
            });
            inner.handles.insert(canonical.clone(), handle);
        }

        registry.recompute_now(&canonical, &state).await;
        let msg = rx
            .try_recv()
            .expect("recompute_now must broadcast synchronously");
        let Message::Text(text) = msg else {
            panic!("expected text envelope, got {msg:?}");
        };
        assert!(text.contains("\"action\":\"status\""), "got: {text}");

        registry.shutdown().await;
    }

    #[tokio::test]
    async fn shutdown_drops_all_handles() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path());
        let canonical = std::fs::canonicalize(dir.path()).unwrap();

        let registry = GitWatcherRegistry::new();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let handle = spawn_handle(registry.inner.clone(), canonical.clone(), state).unwrap();
        {
            let mut inner = registry.inner.lock().await;
            inner.handles.insert(canonical, handle);
        }
        assert_eq!(registry.handle_count().await, 1);
        registry.shutdown().await;
        assert_eq!(registry.handle_count().await, 0);
    }
}
