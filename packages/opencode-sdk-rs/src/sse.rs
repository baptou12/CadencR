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
}

impl SseDispatcher {
    pub async fn start(client: OpenCodeClient, directory: Option<String>) -> Arc<Self> {
        let dispatcher = Arc::new(Self {
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            permission_subscribers: Arc::new(Mutex::new(Vec::new())),
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
        if let Some(session_id) = event.session_id() {
            let mut subscribers = self.subscribers.lock().await;
            if let Some(session_subscribers) = subscribers.get_mut(session_id) {
                retain_live_senders(session_subscribers, &event).await;
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
        }
    }
    *subscribers = next;
}
