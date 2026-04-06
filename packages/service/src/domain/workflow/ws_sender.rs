use axum::extract::ws::Message;
use tokio::sync::mpsc;

use crate::domain::ws_session::protocol::*;

use super::engine::to_value;

/// WebSocket sender that can be detached (on WS disconnect) and reattached
/// (on reconnect) without dropping the engine. Messages sent while detached
/// are silently dropped.
#[derive(Clone)]
pub struct WsSender {
    inner: std::sync::Arc<std::sync::Mutex<Option<mpsc::UnboundedSender<Message>>>>,
}

impl WsSender {
    pub fn new(tx: mpsc::UnboundedSender<Message>) -> Self {
        Self {
            inner: std::sync::Arc::new(std::sync::Mutex::new(Some(tx))),
        }
    }

    /// Send a message. Returns Ok if sent or if detached (silently drops).
    pub fn send(&self, msg: Message) -> Result<(), mpsc::error::SendError<Message>> {
        let guard = self.inner.lock().unwrap();
        if let Some(ref tx) = *guard {
            tx.send(msg)
        } else {
            Ok(()) // detached — silently drop
        }
    }

    /// Detach the underlying sender (on WS disconnect). Messages will be dropped.
    pub fn detach(&self) {
        let mut guard = self.inner.lock().unwrap();
        *guard = None;
    }

    /// Reattach a new underlying sender (on WS reconnect).
    pub fn reattach(&self, tx: mpsc::UnboundedSender<Message>) {
        let mut guard = self.inner.lock().unwrap();
        *guard = Some(tx);
    }

    /// Check if a sender is currently attached.
    pub fn is_attached(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    /// Get a clone of the raw underlying sender (for interop with code that
    /// still takes `mpsc::UnboundedSender<Message>`).  Returns None if detached.
    pub fn raw_clone(&self) -> Option<mpsc::UnboundedSender<Message>> {
        self.inner.lock().unwrap().clone()
    }
}

/// Send a `feature.updated` envelope over the given WebSocket sender.
pub fn send_feature_updated_envelope(sender: &WsSender, feature_id: i64, changed: &[&str]) {
    let payload = FeatureUpdatedPayload {
        feature_id,
        changed: changed.iter().map(|s| s.to_string()).collect(),
    };
    let envelope = WsEnvelope::new("feature", "updated", to_value(payload));
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}
