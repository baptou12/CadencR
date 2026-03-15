use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::protocol::SessionInitPayload;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WsSessionStatus {
    Initializing,
    Ready,
    Running,
    WaitingForPermission,
    Ended,
}

#[derive(Debug, Clone)]
pub struct WsSessionState {
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub messages: Vec<serde_json::Value>,
    pub status: WsSessionStatus,
}

#[async_trait]
pub trait SessionStore: Send + Sync {
    async fn create_session(&self, session_id: &str, config: SessionInitPayload) -> anyhow::Result<()>;
    async fn get_session(&self, session_id: &str) -> anyhow::Result<Option<WsSessionState>>;
    async fn update_status(&self, session_id: &str, status: WsSessionStatus) -> anyhow::Result<()>;
    async fn append_message(&self, session_id: &str, block: serde_json::Value) -> anyhow::Result<()>;
    async fn update_permission_mode(&self, session_id: &str, mode: &str) -> anyhow::Result<()>;
    async fn destroy_session(&self, session_id: &str) -> anyhow::Result<()>;
    async fn list_sessions(&self) -> anyhow::Result<Vec<String>>;
}

#[derive(Debug, Clone)]
pub struct InMemorySessionStore {
    sessions: Arc<RwLock<HashMap<String, WsSessionState>>>,
}

impl InMemorySessionStore {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for InMemorySessionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl SessionStore for InMemorySessionStore {
    async fn create_session(&self, session_id: &str, config: SessionInitPayload) -> anyhow::Result<()> {
        let state = WsSessionState {
            session_id: session_id.to_string(),
            created_at: Utc::now(),
            model: config.model,
            permission_mode: config.permission_mode,
            messages: Vec::new(),
            status: WsSessionStatus::Initializing,
        };
        self.sessions.write().await.insert(session_id.to_string(), state);
        Ok(())
    }

    async fn get_session(&self, session_id: &str) -> anyhow::Result<Option<WsSessionState>> {
        Ok(self.sessions.read().await.get(session_id).cloned())
    }

    async fn update_status(&self, session_id: &str, status: WsSessionStatus) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        match sessions.get_mut(session_id) {
            Some(s) => { s.status = status; Ok(()) }
            None => anyhow::bail!("session not found: {session_id}"),
        }
    }

    async fn append_message(&self, session_id: &str, block: serde_json::Value) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        match sessions.get_mut(session_id) {
            Some(s) => { s.messages.push(block); Ok(()) }
            None => anyhow::bail!("session not found: {session_id}"),
        }
    }

    async fn update_permission_mode(&self, session_id: &str, mode: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        match sessions.get_mut(session_id) {
            Some(s) => { s.permission_mode = Some(mode.to_string()); Ok(()) }
            None => anyhow::bail!("session not found: {session_id}"),
        }
    }

    async fn destroy_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.sessions.write().await.remove(session_id);
        Ok(())
    }

    async fn list_sessions(&self) -> anyhow::Result<Vec<String>> {
        Ok(self.sessions.read().await.keys().cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_and_get_session() {
        let store = InMemorySessionStore::new();
        let config = SessionInitPayload { model: Some("opus".into()), permission_mode: None, system_prompt: None, cwd: None };
        store.create_session("s1", config).await.unwrap();
        let session = store.get_session("s1").await.unwrap().unwrap();
        assert_eq!(session.session_id, "s1");
        assert_eq!(session.model.as_deref(), Some("opus"));
        assert_eq!(session.status, WsSessionStatus::Initializing);
    }

    #[tokio::test]
    async fn test_append_message() {
        let store = InMemorySessionStore::new();
        let config = SessionInitPayload { model: None, permission_mode: None, system_prompt: None, cwd: None };
        store.create_session("s1", config).await.unwrap();
        store.append_message("s1", serde_json::json!({"type": "text"})).await.unwrap();
        store.append_message("s1", serde_json::json!({"type": "tool"})).await.unwrap();
        let session = store.get_session("s1").await.unwrap().unwrap();
        assert_eq!(session.messages.len(), 2);
    }

    #[tokio::test]
    async fn test_destroy_session() {
        let store = InMemorySessionStore::new();
        let config = SessionInitPayload { model: None, permission_mode: None, system_prompt: None, cwd: None };
        store.create_session("s1", config).await.unwrap();
        store.destroy_session("s1").await.unwrap();
        assert!(store.get_session("s1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_get_nonexistent() {
        let store = InMemorySessionStore::new();
        assert!(store.get_session("nope").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_list_sessions() {
        let store = InMemorySessionStore::new();
        let config = SessionInitPayload { model: None, permission_mode: None, system_prompt: None, cwd: None };
        store.create_session("s1", config.clone()).await.unwrap();
        store.create_session("s2", config).await.unwrap();
        let mut ids = store.list_sessions().await.unwrap();
        ids.sort();
        assert_eq!(ids, vec!["s1", "s2"]);
    }
}
