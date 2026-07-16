//! Process-global cancellation registry for Cadencr-managed user shell runs.

use std::collections::HashMap;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct UserShellRunRegistry {
    runs: Mutex<HashMap<i64, CancellationToken>>,
}

impl UserShellRunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(&self, session_id: i64) -> Result<CancellationToken, String> {
        let mut runs = self.runs.lock().await;
        if runs.contains_key(&session_id) {
            return Err("A user shell command is already running for this session.".to_string());
        }
        let cancellation = CancellationToken::new();
        runs.insert(session_id, cancellation.clone());
        Ok(cancellation)
    }

    pub async fn unregister(&self, session_id: i64) {
        self.runs.lock().await.remove(&session_id);
    }

    pub async fn cancel(&self, session_id: i64) -> bool {
        let runs = self.runs.lock().await;
        let Some(cancellation) = runs.get(&session_id) else {
            return false;
        };
        cancellation.cancel();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn one_run_per_session_can_be_cancelled() {
        let registry = UserShellRunRegistry::new();
        let cancellation = registry.register(7).await.unwrap();

        assert!(registry.register(7).await.is_err());
        assert!(registry.cancel(7).await);
        assert!(cancellation.is_cancelled());

        registry.unregister(7).await;
        assert!(!registry.cancel(7).await);
    }
}
