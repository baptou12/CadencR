use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest_eventsource::{Event, EventSource};
use tokio::sync::{mpsc, Mutex};
use tokio::time::sleep;
use tracing::warn;

use crate::client::OpenCodeClient;
use crate::error::SdkError;
use crate::event_parsing::parse_sse_event;
use crate::types::SseEvent;

pub struct SseStream {
    inner: EventSource,
}

impl SseStream {
    pub fn connect(request: reqwest::RequestBuilder) -> Result<Self, SdkError> {
        let request = request.header("accept", "text/event-stream");
        let inner =
            EventSource::new(request).map_err(|error| SdkError::Protocol(error.to_string()))?;
        Ok(Self { inner })
    }

    pub async fn next(&mut self) -> Option<Result<SseEvent, SdkError>> {
        loop {
            let event = self.inner.next().await?;
            match event {
                Ok(Event::Open) => return Some(Ok(SseEvent::ServerConnected)),
                Ok(Event::Message(message)) => {
                    let parsed = serde_json::from_str::<serde_json::Value>(&message.data)
                        .map(parse_sse_event)
                        .map_err(SdkError::from);
                    return Some(parsed);
                }
                Err(error) => return Some(Err(SdkError::from(error))),
            }
        }
    }
}

pub struct SseDispatcher {
    subscribers: Arc<Mutex<HashMap<String, Vec<mpsc::Sender<SseEvent>>>>>,
    permission_subscribers: Arc<Mutex<Vec<mpsc::Sender<SseEvent>>>>,
    session_roots: Arc<Mutex<HashMap<String, String>>>,
}

impl SseDispatcher {
    pub async fn start(client: OpenCodeClient, directory: Option<String>) -> Arc<Self> {
        let dispatcher = Arc::new(Self {
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            permission_subscribers: Arc::new(Mutex::new(Vec::new())),
            session_roots: Arc::new(Mutex::new(HashMap::new())),
        });
        let stream_dispatcher = Arc::clone(&dispatcher);
        tokio::spawn(async move {
            loop {
                let mut stream = match client.event_stream_for_directory(directory.as_deref()) {
                    Ok(stream) => stream,
                    Err(error) => {
                        warn!(error = %error, "failed to connect opencode SSE stream");
                        sleep(Duration::from_millis(250)).await;
                        continue;
                    }
                };

                let mut should_reconnect = false;
                while let Some(next) = stream.next().await {
                    match next {
                        Ok(event) => stream_dispatcher.dispatch(event).await,
                        Err(error) => {
                            warn!(error = %error, "opencode SSE stream error");
                            should_reconnect = true;
                            break;
                        }
                    }
                }

                if !should_reconnect {
                    warn!("opencode SSE stream ended; reconnecting");
                }
                sleep(Duration::from_millis(250)).await;
            }
        });
        dispatcher
    }

    pub async fn subscribe(&self, session_id: &str) -> mpsc::Receiver<SseEvent> {
        let (tx, rx) = mpsc::channel(256);
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

    pub async fn subscribe_permissions(&self) -> mpsc::Receiver<SseEvent> {
        let (tx, rx) = mpsc::channel(64);
        self.permission_subscribers.lock().await.push(tx);
        rx
    }

    async fn dispatch(&self, event: SseEvent) {
        self.update_session_root(&event).await;
        if let Some(session_id) = event.session_id() {
            let root_session_id = self.resolve_root_session_id(session_id).await;
            let mut subscribers = self.subscribers.lock().await;
            if let Some(session_subscribers) = subscribers.get_mut(session_id) {
                retain_live_senders(session_subscribers, &event).await;
            }
            if let Some(root_session_id) = root_session_id.filter(|root| root != session_id) {
                if let Some(root_subscribers) = subscribers.get_mut(root_session_id.as_str()) {
                    retain_live_senders(root_subscribers, &event).await;
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
            retain_live_senders(&mut subscribers, &event).await;
        }
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
            let root = session_roots
                .get(&parent_id)
                .cloned()
                .unwrap_or(parent_id);
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

async fn retain_live_senders(subscribers: &mut Vec<mpsc::Sender<SseEvent>>, event: &SseEvent) {
    let mut next = Vec::with_capacity(subscribers.len());
    for sender in subscribers.drain(..) {
        if sender.send(event.clone()).await.is_ok() {
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
    async fn child_session_events_are_forwarded_to_root_subscriber() {
        let dispatcher = SseDispatcher {
            subscribers: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            permission_subscribers: std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new())),
            session_roots: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
        };

        let mut root_rx = dispatcher.subscribe("root").await;
        dispatcher
            .dispatch(SseEvent::SessionCreated(Session {
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
        let dispatcher = SseDispatcher {
            subscribers: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            permission_subscribers: std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new())),
            session_roots: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
        };

        let mut root_rx = dispatcher.subscribe("root").await;
        dispatcher
            .dispatch(SseEvent::SessionCreated(Session {
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
            .dispatch(SseEvent::SessionUpdated(Session {
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
            .dispatch(SseEvent::MessageUpdated(Message {
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

        let forwarded = root_rx.recv().await.expect("expected forwarded child message");
        match forwarded {
            SseEvent::MessageUpdated(message) => {
                assert_eq!(message.session_id, "child");
                assert!(matches!(message.role, MessageRole::Assistant));
            }
            other => panic!("expected child message update, got {other:?}"),
        }
    }
}
