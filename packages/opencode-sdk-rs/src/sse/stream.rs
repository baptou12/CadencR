use futures_util::StreamExt;
use reqwest_eventsource::{Event, EventSource};

use crate::error::SdkError;
use crate::event_parsing::parse_sse_event;
use crate::types::SseEvent;

/// Thin wrapper around `reqwest_eventsource::EventSource` that decodes
/// each SSE message into our typed `SseEvent`. Reconnect / watchdog logic
/// lives in `runner.rs`; this struct only owns one connection at a time.
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

    /// Read the next SSE event. Returns `None` on EOF, `Some(Err(_))` on
    /// transport / parse failure, `Some(Ok(_))` on a typed event. Yields a
    /// synthetic `SseEvent::ServerConnected` on `Event::Open`, which the
    /// dispatcher uses as a "we're alive" signal for the watchdog.
    pub async fn next(&mut self) -> Option<Result<SseEvent, SdkError>> {
        match self.inner.next().await? {
            Ok(Event::Open) => Some(Ok(SseEvent::ServerConnected)),
            Ok(Event::Message(message)) => Some(
                serde_json::from_str::<serde_json::Value>(&message.data)
                    .map(parse_sse_event)
                    .map_err(SdkError::from),
            ),
            Err(error) => Some(Err(SdkError::from(error))),
        }
    }
}
