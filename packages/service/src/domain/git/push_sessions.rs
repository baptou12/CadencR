//! Active-push session registry.
//!
//! When `POST /api/git/push` runs, the backend opens a PTY and starts
//! `git push` inside it. ssh on the other end of the PTY may emit prompts
//! (`Enter passphrase for key …`, `Are you sure you want to continue
//! connecting (yes/no)?`, `password:` for HTTPS remotes) on stdout — those
//! reach the frontend through the existing `push.output` WS envelopes.
//!
//! The user types an answer in the dialog. To get that answer back to the
//! PTY's stdin we need a side channel: a small registry mapping
//! `feature_id → stdin_tx` so an HTTP `POST /api/git/push-input` from the
//! frontend can route the bytes to the right active session.
//!
//! Lifetime: the push handler `register`s on entry, holds the token for
//! the lifetime of the push, and `unregister`s on exit (success or error).
//! No grace period — once the push is done, the channel is closed and any
//! late input is silently ignored.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

/// One active push session: just the input-half of the PTY stdin channel.
/// The output-half (broadcast of `push.output` envelopes) lives in the
/// caller's WS sender snapshot — same pattern as the commit dialog.
type StdinTx = mpsc::UnboundedSender<String>;

#[derive(Default)]
pub struct PushSessionRegistry {
    inner: Mutex<HashMap<i64, StdinTx>>,
}

impl PushSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new active session. Returns `false` if a session already
    /// exists for this feature — the caller should refuse to start a
    /// concurrent push (the dialog is single-instance per feature anyway).
    pub async fn register(&self, feature_id: i64, stdin_tx: StdinTx) -> bool {
        let mut inner = self.inner.lock().await;
        if inner.contains_key(&feature_id) {
            return false;
        }
        inner.insert(feature_id, stdin_tx);
        true
    }

    /// Forward user-typed input (passphrase, `yes`, etc.) to the session's
    /// PTY stdin. Returns `true` if there's an active session for this
    /// feature *and* the channel is still open. The frontend uses the
    /// boolean to decide whether to surface "no active push" to the user.
    pub async fn send_input(&self, feature_id: i64, text: String) -> bool {
        let inner = self.inner.lock().await;
        match inner.get(&feature_id) {
            Some(tx) => tx.send(text).is_ok(),
            None => false,
        }
    }

    /// Drop the session token. Idempotent.
    pub async fn unregister(&self, feature_id: i64) {
        self.inner.lock().await.remove(&feature_id);
    }
}

#[allow(dead_code)]
pub type SharedPushSessions = Arc<PushSessionRegistry>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_send_unregister_roundtrip() {
        let reg = PushSessionRegistry::new();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();

        assert!(reg.register(7, tx).await);
        assert!(
            reg.send_input(7, "hunter2\n".into()).await,
            "send to active session must succeed"
        );
        assert_eq!(rx.recv().await.as_deref(), Some("hunter2\n"));

        reg.unregister(7).await;
        assert!(
            !reg.send_input(7, "late\n".into()).await,
            "input after unregister must report no-op"
        );
    }

    #[tokio::test]
    async fn register_refuses_duplicate_feature_id() {
        let reg = PushSessionRegistry::new();
        let (tx1, _rx1) = mpsc::unbounded_channel::<String>();
        let (tx2, _rx2) = mpsc::unbounded_channel::<String>();

        assert!(reg.register(7, tx1).await);
        assert!(
            !reg.register(7, tx2).await,
            "second register for the same feature must refuse"
        );
    }

    #[tokio::test]
    async fn send_to_unknown_feature_is_false() {
        let reg = PushSessionRegistry::new();
        assert!(!reg.send_input(42, "x".into()).await);
    }
}
