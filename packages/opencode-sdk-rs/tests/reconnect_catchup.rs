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
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let attempt = connection_count.fetch_add(1, Ordering::SeqCst);
    let items = if attempt == 0 {
        vec![Ok(Event::default().data(
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
        ))]
    } else {
        Vec::new()
    };
    Sse::new(iter(items))
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
    State(connection_count): State<Arc<AtomicUsize>>,
) -> Json<Value> {
    let messages = if connection_count.load(Ordering::SeqCst) >= 2 {
        serde_json::json!([
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
        ])
    } else {
        serde_json::json!([
            {
                "id": "msg-1",
                "sessionID": "sess-1",
                "role": "assistant",
                "parts": [{ "id": "part-1", "type": "text", "text": "first" }],
                "time": { "created": 123 }
            }
        ])
    };
    Json(messages)
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

#[tokio::test]
async fn shared_dispatcher_catches_up_missed_messages_after_reconnect() {
    let (addr, connection_count) = start_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));
    let dispatcher = shared_dispatcher(client, None).await;
    let mut rx = dispatcher.subscribe("sess-1").await;

    let mut saw_live_msg_1 = false;
    let mut saw_catchup_msg_2 = false;
    let mut saw_catchup_part_2 = false;
    let mut saw_catchup_finish = false;

    for _ in 0..8 {
        let event = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
            .await
            .expect("expected reconnect/catch-up event")
            .expect("channel should stay open");
        match event {
            SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message) => {
                if message.id == "msg-1" {
                    saw_live_msg_1 = true;
                }
                if message.id == "msg-2" {
                    saw_catchup_msg_2 = true;
                }
            }
            SseEvent::PartCreated {
                message_id, part, ..
            } => {
                if message_id == "msg-2" {
                    if matches!(part, opencode_sdk_rs::MessagePart::Text { .. }) {
                        saw_catchup_part_2 = true;
                    }
                    if matches!(part, opencode_sdk_rs::MessagePart::StepFinish { .. }) {
                        saw_catchup_finish = true;
                    }
                }
            }
            _ => {}
        }
        if saw_live_msg_1 && saw_catchup_msg_2 && saw_catchup_part_2 && saw_catchup_finish {
            break;
        }
    }

    assert!(saw_live_msg_1, "expected original live SSE event");
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
        connection_count.load(Ordering::SeqCst) >= 2,
        "dispatcher should reconnect before reconciling missed events"
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
