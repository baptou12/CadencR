//! Keep consuming the SDK's lossy broadcast while descendant metadata is read.
//! Replay in order: a root completion must not overtake an unresolved child.
use std::collections::VecDeque;
use std::future::Future;

use codex_app_server_sdk_rs::AppServerEvent;
use serde_json::Value;
use tokio::sync::broadcast;

use crate::domain::agents::adapter::RuntimeError;

const MAX_EVENTS: usize = 8_192;
const MAX_RETAINED_BYTES: usize = 16 * 1024 * 1024;

pub(super) struct EventBuffer {
    source: broadcast::Receiver<AppServerEvent>,
    queued: VecDeque<(AppServerEvent, usize)>,
    retained_bytes: usize,
    closed: bool,
}

impl EventBuffer {
    pub(super) fn new(source: broadcast::Receiver<AppServerEvent>) -> Self {
        Self {
            source,
            queued: VecDeque::new(),
            retained_bytes: 0,
            closed: false,
        }
    }

    pub(super) async fn recv(&mut self) -> Result<AppServerEvent, broadcast::error::RecvError> {
        if let Some((event, bytes)) = self.queued.pop_front() {
            self.retained_bytes -= bytes;
            return Ok(event);
        }
        self.source.recv().await
    }

    pub(super) async fn during<F: Future>(&mut self, work: F) -> Result<F::Output, RuntimeError> {
        tokio::pin!(work);
        loop {
            tokio::select! {
                // Don't read/measure/allocate on ordinary notifications with no recovery.
                biased;
                result = &mut work => return Ok(result),
                event = self.source.recv(), if !self.closed => match event {
                    Ok(event) => self.push(event)?,
                    Err(broadcast::error::RecvError::Closed) => self.closed = true,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => return Err(
                        RuntimeError::new(format!("Codex event stream lost {skipped} events during descendant recovery"))),
                },
            }
        }
    }

    fn push(&mut self, event: AppServerEvent) -> Result<(), RuntimeError> {
        let bytes = event_size(&event);
        if self.queued.len() >= MAX_EVENTS || bytes > MAX_RETAINED_BYTES - self.retained_bytes {
            return Err(RuntimeError::new(
                "Codex descendant recovery event buffer exceeded its safety limit",
            ));
        }
        self.retained_bytes += bytes;
        self.queued.push_back((event, bytes));
        Ok(())
    }
}

fn event_size(event: &AppServerEvent) -> usize {
    std::mem::size_of::<AppServerEvent>()
        + match event {
            AppServerEvent::Notification { method, params } => {
                method.capacity() + value_size(params)
            }
            AppServerEvent::ServerRequest { id, method, params } => {
                method.capacity() + value_size(id) + value_size(params)
            }
            AppServerEvent::TransportError { message } => message.capacity(),
            AppServerEvent::ProcessExited { .. } => 0,
        }
}

// Include container/node overhead, not just string bytes; no serialization copy.
fn value_size(value: &Value) -> usize {
    std::mem::size_of::<Value>()
        + match value {
            Value::String(text) => text.capacity(),
            Value::Array(items) => {
                items.iter().map(value_size).sum::<usize>()
                    + (items.capacity() - items.len()) * std::mem::size_of::<Value>()
            }
            Value::Object(fields) => fields
                .iter()
                .map(|(key, value)| key.capacity() + 128 + value_size(value))
                .sum(),
            _ => 0,
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::oneshot;

    fn event(id: usize) -> AppServerEvent {
        AppServerEvent::Notification {
            method: "item/agentMessage/delta".into(),
            params: json!({"n": id}),
        }
    }

    #[tokio::test]
    async fn delayed_lookup_preserves_burst_approval_and_completion_in_order() {
        let (tx, rx) = broadcast::channel(512);
        let mut buffer = EventBuffer::new(rx);
        let (done, wait) = oneshot::channel();
        tokio::spawn(async move {
            for n in 0..1_600 {
                tx.send(event(n)).unwrap();
                tokio::task::yield_now().await;
            }
            tx.send(AppServerEvent::ServerRequest {
                id: json!(42),
                method: "approval".into(),
                params: json!({}),
            })
            .unwrap();
            tx.send(AppServerEvent::Notification {
                method: "turn/completed".into(),
                params: json!({}),
            })
            .unwrap();
            done.send(()).unwrap();
        });
        buffer.during(wait).await.unwrap().unwrap();
        for n in 0..1_600 {
            let AppServerEvent::Notification { params, .. } = buffer.recv().await.unwrap() else {
                panic!("delta")
            };
            assert_eq!(params["n"], n);
        }
        assert!(matches!(
            buffer.recv().await.unwrap(),
            AppServerEvent::ServerRequest { .. }
        ));
        assert!(
            matches!(buffer.recv().await.unwrap(), AppServerEvent::Notification { method, .. } if method == "turn/completed")
        );
        assert_eq!(buffer.retained_bytes, 0);
        assert!(buffer.recv().await.is_err());
    }

    #[tokio::test]
    async fn loss_is_an_error_instead_of_a_silent_success() {
        let (tx, rx) = broadcast::channel(1);
        tx.send(event(0)).unwrap();
        tx.send(event(1)).unwrap();
        let error = EventBuffer::new(rx)
            .during(std::future::pending::<()>())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("lost"));
    }

    #[test]
    fn memory_and_event_limits_fail_without_discarding_prior_events() {
        let (_tx, rx) = broadcast::channel(1);
        let mut buffer = EventBuffer::new(rx);
        buffer.push(event(0)).unwrap();
        assert!(buffer
            .push(AppServerEvent::Notification {
                method: "large".into(),
                params: json!("x".repeat(MAX_RETAINED_BYTES))
            })
            .is_err());
        assert_eq!(buffer.queued.len(), 1);
        for n in 1..MAX_EVENTS {
            buffer.push(event(n)).unwrap();
        }
        assert!(buffer.push(event(MAX_EVENTS)).is_err());
        assert_eq!(buffer.queued.len(), MAX_EVENTS);
    }
}
