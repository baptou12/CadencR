use std::collections::HashMap;
use std::sync::Arc;

use once_cell::sync::Lazy;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::warn;

use super::lifecycle::{DispatcherStatus, LifecycleBus};
use super::runner;
use crate::client::OpenCodeClient;
use crate::sse_reconcile::ReconnectState;
use crate::types::SseEvent;

pub struct SseDispatcher {
    // Use unbounded fan-out channels so a slow Cadencr consumer cannot block
    // the shared OpenCode SSE reader and freeze every later event in the turn.
    pub(super) subscribers: Arc<Mutex<HashMap<String, Vec<mpsc::UnboundedSender<SseEvent>>>>>,
    pub(super) permission_subscribers: Arc<Mutex<Vec<mpsc::UnboundedSender<SseEvent>>>>,
    pub(super) reconnect_state: Arc<Mutex<ReconnectState>>,
    pub(super) session_roots: Arc<Mutex<HashMap<String, String>>>,
    pub(super) lifecycle: LifecycleBus,
}

impl SseDispatcher {
    /// Construct a dispatcher without spawning the reconnect runner. Tests
    /// use this to drive `dispatch_event` directly; production code goes
    /// through `start()` (see `runner.rs`).
    pub(super) fn new() -> Self {
        Self {
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            permission_subscribers: Arc::new(Mutex::new(Vec::new())),
            reconnect_state: Arc::new(Mutex::new(ReconnectState::default())),
            session_roots: Arc::new(Mutex::new(HashMap::new())),
            lifecycle: LifecycleBus::new(),
        }
    }

    pub async fn start(client: OpenCodeClient, directory: Option<String>) -> Arc<Self> {
        let dispatcher = Arc::new(Self::new());
        runner::spawn(Arc::clone(&dispatcher), client, directory);
        dispatcher
    }

    /// Subscribe to live events for `session_id`. Multiple callers may
    /// subscribe to the same session; each gets its own receiver.
    pub async fn subscribe(&self, session_id: &str) -> mpsc::UnboundedReceiver<SseEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut subscribers = self.subscribers.lock().await;
        subscribers
            .entry(session_id.to_string())
            .or_default()
            .push(tx);
        self.session_roots
            .lock()
            .await
            .entry(session_id.to_string())
            .or_insert_with(|| session_id.to_string());
        rx
    }

    pub async fn unsubscribe(&self, session_id: &str) {
        self.subscribers.lock().await.remove(session_id);
    }

    pub async fn subscribe_permissions(&self) -> mpsc::UnboundedReceiver<SseEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.permission_subscribers.lock().await.push(tx);
        rx
    }

    /// Subscribe to dispatcher health/transition events. Used by the
    /// service adapter to surface degraded streams to the UI instead of
    /// leaving an infinite silent loader.
    pub fn subscribe_status(&self) -> broadcast::Receiver<DispatcherStatus> {
        self.lifecycle.subscribe()
    }

    pub(super) async fn dispatch_live(&self, event: SseEvent) {
        self.reconnect_state.lock().await.record_event(&event);
        self.dispatch_event(event).await;
    }

    pub(super) async fn dispatch_event(&self, event: SseEvent) {
        self.update_session_root(&event).await;
        if let Some(session_id) = event.session_id() {
            let root_session_id = self.resolve_root_session_id(session_id).await;
            let mut subscribers = self.subscribers.lock().await;
            if let Some(session_subscribers) = subscribers.get_mut(session_id) {
                retain_live_senders(session_subscribers, &event);
            }
            if let Some(root_session_id) = root_session_id.filter(|root| root != session_id) {
                if let Some(root_subscribers) = subscribers.get_mut(root_session_id.as_str()) {
                    retain_live_senders(root_subscribers, &event);
                }
            }
        }
        if matches!(
            event,
            SseEvent::PermissionCreated(_)
                | SseEvent::PermissionUpdated { .. }
                | SseEvent::QuestionCreated(_)
                | SseEvent::QuestionUpdated { .. }
        ) {
            let mut subscribers = self.permission_subscribers.lock().await;
            retain_live_senders(&mut subscribers, &event);
        }
    }

    /// Drop every subscriber sender so receivers in the service adapter
    /// observe `None` from `recv().await` and trigger their auto-resubscribe
    /// path. THIS IS THE SMOKING-GUN FIX for the silent UI freeze (see plan
    /// finding #1): without this, a stalled / reconnecting upstream leaves
    /// the receivers blocked forever.
    pub(super) async fn drop_all_subscribers(&self) -> usize {
        let mut subs = self.subscribers.lock().await;
        let session_count: usize = subs.values().map(Vec::len).sum();
        subs.clear();
        let mut perms = self.permission_subscribers.lock().await;
        let perm_count = perms.len();
        perms.clear();
        let total = session_count + perm_count;
        if total > 0 {
            warn!(
                session_subscribers = session_count,
                permission_subscribers = perm_count,
                "opencode SSE: dropped subscribers on disconnect (auto-resubscribe will fire)"
            );
        }
        total
    }

    pub(super) async fn subscribed_root_session_ids(&self) -> Vec<String> {
        let subscribed_session_ids = self
            .subscribers
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        if subscribed_session_ids.is_empty() {
            return Vec::new();
        }

        let session_roots = self.session_roots.lock().await;
        let mut seen = std::collections::HashSet::new();
        let mut roots = Vec::new();
        for session_id in subscribed_session_ids {
            let root = session_roots
                .get(&session_id)
                .cloned()
                .unwrap_or(session_id);
            if seen.insert(root.clone()) {
                roots.push(root);
            }
        }
        roots
    }

    async fn update_session_root(&self, event: &SseEvent) {
        let (session_id, parent_id) = match event {
            SseEvent::SessionCreated(session) | SseEvent::SessionUpdated(session) => {
                (session.id.clone(), session.parent_id.clone())
            }
            SseEvent::SessionDeleted { session_id } => {
                self.session_roots.lock().await.remove(session_id);
                return;
            }
            _ => return,
        };

        let mut session_roots = self.session_roots.lock().await;
        if let Some(parent_id) = parent_id {
            let root = session_roots.get(&parent_id).cloned().unwrap_or(parent_id);
            session_roots.insert(session_id, root);
            return;
        }

        session_roots
            .entry(session_id.clone())
            .or_insert(session_id);
    }

    async fn resolve_root_session_id(&self, session_id: &str) -> Option<String> {
        self.session_roots.lock().await.get(session_id).cloned()
    }
}

static SHARED_DISPATCHERS: Lazy<Arc<Mutex<HashMap<String, Arc<SseDispatcher>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub async fn shared_dispatcher(
    client: OpenCodeClient,
    directory: Option<String>,
) -> Arc<SseDispatcher> {
    let key = match &directory {
        Some(directory) => format!("{}|{directory}", client.base_url()),
        None => client.base_url().to_string(),
    };
    let mut dispatchers = SHARED_DISPATCHERS.lock().await;
    if let Some(existing) = dispatchers.get(&key) {
        return Arc::clone(existing);
    }
    let created = SseDispatcher::start(client, directory).await;
    dispatchers.insert(key, Arc::clone(&created));
    created
}

fn retain_live_senders(subscribers: &mut Vec<mpsc::UnboundedSender<SseEvent>>, event: &SseEvent) {
    let mut next = Vec::with_capacity(subscribers.len());
    for sender in subscribers.drain(..) {
        if sender.send(event.clone()).is_ok() {
            next.push(sender);
        } else {
            warn!("Pruned dead SSE subscriber");
        }
    }
    *subscribers = next;
}

#[cfg(test)]
mod tests {
    use super::SseDispatcher;
    use crate::types::{Message, MessageRole, Session, SessionStatus, SseEvent};

    #[tokio::test]
    async fn drop_all_subscribers_closes_every_receiver() {
        let dispatcher = SseDispatcher::new();
        let mut rx_a = dispatcher.subscribe("ses_a").await;
        let mut rx_b = dispatcher.subscribe("ses_b").await;
        let mut rx_perm = dispatcher.subscribe_permissions().await;

        let total = dispatcher.drop_all_subscribers().await;
        assert_eq!(total, 3, "expected 3 subscribers to be dropped");

        // Receivers must observe None now; previously they would block
        // forever and freeze the UI loader.
        assert!(
            rx_a.recv().await.is_none(),
            "ses_a receiver should be closed"
        );
        assert!(
            rx_b.recv().await.is_none(),
            "ses_b receiver should be closed"
        );
        assert!(
            rx_perm.recv().await.is_none(),
            "permission receiver should be closed"
        );
    }

    #[tokio::test]
    async fn child_session_events_are_forwarded_to_root_subscriber() {
        let dispatcher = SseDispatcher::new();
        let mut root_rx = dispatcher.subscribe("root").await;
        dispatcher
            .dispatch_event(SseEvent::SessionCreated(Session {
                id: "child".to_string(),
                title: None,
                directory: "/tmp".to_string(),
                status: SessionStatus::Active,
                parent_id: Some("root".to_string()),
                created_at: None,
                updated_at: None,
            }))
            .await;

        let forwarded = root_rx
            .recv()
            .await
            .expect("expected forwarded child event");
        match forwarded {
            SseEvent::SessionCreated(session) => {
                assert_eq!(session.id, "child");
                assert_eq!(session.parent_id.as_deref(), Some("root"));
            }
            other => panic!("expected session created event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn child_status_updates_do_not_clobber_root_mapping() {
        let dispatcher = SseDispatcher::new();
        let mut root_rx = dispatcher.subscribe("root").await;
        dispatcher
            .dispatch_event(SseEvent::SessionCreated(Session {
                id: "child".to_string(),
                title: None,
                directory: "/tmp".to_string(),
                status: SessionStatus::Active,
                parent_id: Some("root".to_string()),
                created_at: None,
                updated_at: None,
            }))
            .await;
        let _ = root_rx.recv().await;

        dispatcher
            .dispatch_event(SseEvent::SessionUpdated(Session {
                id: "child".to_string(),
                title: None,
                directory: String::new(),
                status: SessionStatus::Active,
                parent_id: None,
                created_at: None,
                updated_at: None,
            }))
            .await;
        let _ = root_rx.recv().await;

        dispatcher
            .dispatch_event(SseEvent::MessageUpdated(Message {
                id: "msg_1".to_string(),
                session_id: "child".to_string(),
                role: MessageRole::Assistant,
                parts: Vec::new(),
                created_at: None,
                model: Some("openai/gpt-5.4".to_string()),
                tokens: None,
                finished: false,
            }))
            .await;

        let forwarded = root_rx
            .recv()
            .await
            .expect("expected forwarded child message");
        match forwarded {
            SseEvent::MessageUpdated(message) => {
                assert_eq!(message.session_id, "child");
                assert!(matches!(message.role, MessageRole::Assistant));
            }
            other => panic!("expected child message update, got {other:?}"),
        }
    }
}
