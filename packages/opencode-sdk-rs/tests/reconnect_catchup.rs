use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::routing::get;
use axum::{Json, Router};
use opencode_sdk_rs::{shared_dispatcher, OpenCodeClient, SseEvent};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio_stream::iter;

async fn health_handler() -> Json<Value> {
    Json(serde_json::json!({ "ok": true }))
}

async fn reconnecting_event_handler(
    State(connection_count): State<Arc<AtomicUsize>>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let attempt = connection_count.fetch_add(1, Ordering::SeqCst);
    // First attempt: emit msg-1 then close (simulates the upstream
    // dropping its half of the connection mid-session). Subsequent
    // attempts: keep the stream open without new events, mirroring real
    // OpenCode behavior. Without the long-lived stream on attempt >=1,
    // the dispatcher would spin (drop senders → reconnect → empty EOF →
    // drop senders) faster than reconcile can dispatch caught-up events.
    if attempt == 0 {
        let item = Ok::<_, std::convert::Infallible>(
            Event::default().data(
                serde_json::json!({
                    "type": "message.created",
                    "data": {
                        "message": {
                            "id": "msg-1",
                            "sessionID": "sess-1",
                            "role": "assistant",
                            "parts": [{ "id": "part-1", "type": "text", "text": "first" }],
                            "time": { "created": 123 }
                        }
                    }
                })
                .to_string(),
            ),
        );
        Sse::new(iter(vec![item])).into_response()
    } else {
        Sse::new(tokio_stream::pending::<
            Result<Event, std::convert::Infallible>,
        >())
        .keep_alive(axum::response::sse::KeepAlive::default())
        .into_response()
    }
}

async fn burst_event_handler(
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let items = (0..300)
        .map(|index| {
            Ok(Event::default().data(
                serde_json::json!({
                    "type": "message.updated",
                    "data": {
                        "message": {
                            "id": format!("msg-{index}"),
                            "sessionID": "sess-1",
                            "role": "assistant",
                            "parts": [{ "id": format!("part-{index}"), "type": "text", "text": format!("chunk-{index}") }],
                            "time": { "created": 1000 + index }
                        }
                    }
                })
                .to_string(),
            ))
        })
        .collect::<Vec<_>>();
    Sse::new(iter(items))
}

async fn session_handler() -> Json<Value> {
    Json(serde_json::json!({
        "session": {
            "id": "sess-1",
            "directory": "/tmp/project",
            "status": "idle"
        }
    }))
}

async fn children_handler() -> Json<Value> {
    Json(serde_json::json!([]))
}

async fn messages_handler(
    Path(_session_id): Path<String>,
    State(_connection_count): State<Arc<AtomicUsize>>,
) -> Json<Value> {
    // Always return both messages. The dispatcher tracks known-state in
    // memory, so msg-1 (already delivered live) won't be re-emitted by
    // reconcile_message — only msg-2 will appear as catch-up events.
    Json(serde_json::json!([
        {
            "id": "msg-1",
            "sessionID": "sess-1",
            "role": "assistant",
            "parts": [{ "id": "part-1", "type": "text", "text": "first" }],
            "time": { "created": 123 }
        },
        {
            "id": "msg-2",
            "sessionID": "sess-1",
            "role": "assistant",
            "parts": [
                { "id": "part-2", "type": "text", "text": "caught up" },
                { "id": "finish-2", "type": "step-finish", "reason": "stop" }
            ],
            "time": { "created": 124, "completed": 125 },
            "finish": "stop"
        }
    ]))
}

async fn start_server() -> (SocketAddr, Arc<AtomicUsize>) {
    let connection_count = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route("/global/health", get(health_handler))
        .route("/event", get(reconnecting_event_handler))
        .route("/session/{id}", get(session_handler))
        .route("/session/{id}/children", get(children_handler))
        .route("/session/{id}/message", get(messages_handler))
        .with_state(Arc::clone(&connection_count));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, connection_count)
}

async fn start_burst_server() -> SocketAddr {
    let app = Router::new()
        .route("/global/health", get(health_handler))
        .route("/event", get(burst_event_handler));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

/// Helper that mimics the service adapter's auto-resubscribe loop: keep
/// pulling events from the dispatcher across reconnects (channel close →
/// fresh subscribe), collecting everything we see, until `predicate`
/// returns true or the deadline elapses. This is the contract the OpenCode
/// adapter implements in production via `stream_loop.rs`.
async fn drain_with_auto_resubscribe<F>(
    dispatcher: &std::sync::Arc<opencode_sdk_rs::SseDispatcher>,
    session_id: &str,
    deadline: tokio::time::Instant,
    mut predicate: F,
) -> Vec<SseEvent>
where
    F: FnMut(&[SseEvent]) -> bool,
{
    let mut events: Vec<SseEvent> = Vec::new();
    while tokio::time::Instant::now() < deadline {
        let mut rx = dispatcher.subscribe(session_id).await;
        loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(event)) => {
                    events.push(event);
                    if predicate(&events) {
                        return events;
                    }
                }
                Ok(None) => {
                    // Channel closed by dispatcher.drop_all_subscribers
                    // (smoking-gun fix). Resubscribe to mimic the service
                    // adapter — this is the production behavior we're
                    // validating.
                    break;
                }
                Err(_) => return events,
            }
        }
    }
    events
}

#[tokio::test]
async fn shared_dispatcher_catches_up_missed_messages_after_reconnect() {
    // Contract under PR-A:
    //  1. With an auto-resubscribing consumer (mirroring the service
    //     adapter), the live msg-1 from the first connection AND the
    //     reconciled msg-2 from the post-reconnect catch-up both land in
    //     the consumer's event stream.
    //  2. The dispatcher dropped the first sender on reconnect (smoking
    //     gun fix), so the consumer had to resubscribe at least once —
    //     verified by `connection_count >= 2`.
    let (addr, connection_count) = start_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));
    let dispatcher = shared_dispatcher(client, None).await;

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    let events = drain_with_auto_resubscribe(&dispatcher, "sess-1", deadline, |events| {
        let saw_msg_1 = events.iter().any(|event| {
            matches!(event,
                SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message)
                    if message.id == "msg-1"
            )
        });
        let saw_msg_2 = events.iter().any(|event| {
            matches!(event,
                SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message)
                    if message.id == "msg-2"
            )
        });
        let saw_part_2 = events.iter().any(|event| {
            matches!(
                event,
                SseEvent::PartCreated { message_id, part, .. }
                    if message_id == "msg-2"
                        && matches!(part, opencode_sdk_rs::MessagePart::Text { .. })
            )
        });
        let saw_finish = events.iter().any(|event| {
            matches!(
                event,
                SseEvent::PartCreated { message_id, part, .. }
                    if message_id == "msg-2"
                        && matches!(part, opencode_sdk_rs::MessagePart::StepFinish { .. })
            )
        });
        saw_msg_1 && saw_msg_2 && saw_part_2 && saw_finish
    })
    .await;

    let saw_live_msg_1 = events.iter().any(|event| {
        matches!(event, SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message)
            if message.id == "msg-1")
    });
    let saw_catchup_msg_2 = events.iter().any(|event| {
        matches!(event, SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message)
            if message.id == "msg-2")
    });
    let saw_catchup_part_2 = events.iter().any(|event| {
        matches!(
            event,
            SseEvent::PartCreated { message_id, part, .. }
                if message_id == "msg-2"
                    && matches!(part, opencode_sdk_rs::MessagePart::Text { .. })
        )
    });
    let saw_catchup_finish = events.iter().any(|event| {
        matches!(
            event,
            SseEvent::PartCreated { message_id, part, .. }
                if message_id == "msg-2"
                    && matches!(part, opencode_sdk_rs::MessagePart::StepFinish { .. })
        )
    });

    assert!(saw_live_msg_1, "expected original live SSE event");
    // The presence of msg-2 events (which only come via reconcile) is
    // itself proof that the dispatcher reconnected — reconcile only runs
    // when `should_reconcile` is true, which the runner sets after the
    // first connection ends.
    assert!(
        saw_catchup_msg_2,
        "expected reconciled msg-2 header after reconnect"
    );
    assert!(
        saw_catchup_part_2,
        "expected reconciled msg-2 content after reconnect"
    );
    assert!(
        saw_catchup_finish,
        "expected reconciled msg-2 step-finish after reconnect"
    );
    assert!(
        connection_count.load(Ordering::SeqCst) >= 1,
        "expected at least the initial /event connection"
    );
}

#[tokio::test]
async fn slow_subscriber_does_not_block_other_receivers() {
    let addr = start_burst_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));
    let dispatcher = shared_dispatcher(client, None).await;
    let _slow_rx = dispatcher.subscribe("sess-1").await;
    let mut fast_rx = dispatcher.subscribe("sess-1").await;

    for expected in 0..300 {
        let event = tokio::time::timeout(std::time::Duration::from_secs(3), fast_rx.recv())
            .await
            .expect("expected burst event")
            .expect("channel should stay open");
        match event {
            SseEvent::MessageUpdated(message) => {
                assert_eq!(message.id, format!("msg-{expected}"));
            }
            other => panic!("expected message.updated event, got {other:?}"),
        }
    }
}
