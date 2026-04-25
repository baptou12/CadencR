use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_stream::iter;

use opencode_sdk_rs::{
    parse_sse_event, shared_dispatcher, OpenCodeClient, PromptOptions, PromptPart, SessionStatus,
    SseEvent,
};

#[derive(Default)]
struct ServerState {
    session_directory: Option<String>,
    prompt_payload: Option<Value>,
    prompt_path_session_id: Option<String>,
    question_reply_directory: Option<String>,
    question_reply_payload: Option<Value>,
}

async fn health_handler() -> Json<Value> {
    Json(serde_json::json!({ "healthy": true, "version": "1.14.24" }))
}

async fn create_session_handler(
    State(state): State<Arc<Mutex<ServerState>>>,
    headers: axum::http::HeaderMap,
) -> Json<Value> {
    let directory = headers
        .get("x-opencode-directory")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    state.lock().await.session_directory = directory;
    Json(serde_json::json!({
        "session": {
            "id": "sess-1",
            "title": "Test Session",
            "directory": "/tmp/project",
            "status": "idle"
        }
    }))
}

async fn prompt_async_handler(
    State(state): State<Arc<Mutex<ServerState>>>,
    Path(session_id): Path<String>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let mut locked = state.lock().await;
    locked.prompt_path_session_id = Some(session_id);
    locked.prompt_payload = Some(payload);
    Json(serde_json::json!({ "ok": true }))
}

async fn question_reply_handler(
    State(state): State<Arc<Mutex<ServerState>>>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let directory = headers
        .get("x-opencode-directory")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let mut locked = state.lock().await;
    locked.question_reply_directory = directory;
    locked.question_reply_payload = Some(payload);
    Json(serde_json::json!({ "ok": true }))
}

async fn providers_handler() -> Json<Value> {
    Json(serde_json::json!([
        { "id": "anthropic", "models": ["claude-sonnet"] }
    ]))
}

async fn event_handler(
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let items = vec![
        Ok(Event::default().data(
            serde_json::json!({
                "type": "message.part.created",
                "data": {
                    "session_id": "sess-1",
                    "message_id": "msg-1",
                    "part": { "type": "text", "id": "part-1", "text": "Hello" }
                }
            })
            .to_string(),
        )),
        Ok(Event::default().data(
            serde_json::json!({
                "type": "session.updated",
                "data": {
                    "session": {
                        "id": "sess-1",
                        "directory": "/tmp/project",
                        "status": "idle"
                    }
                }
            })
            .to_string(),
        )),
    ];
    Sse::new(iter(items))
}

async fn start_server() -> (SocketAddr, Arc<Mutex<ServerState>>) {
    let state = Arc::new(Mutex::new(ServerState::default()));
    let app = Router::new()
        .route("/global/health", get(health_handler))
        .route("/session", post(create_session_handler))
        .route("/session/{id}/prompt_async", post(prompt_async_handler))
        .route("/question/{id}/reply", post(question_reply_handler))
        .route("/config/providers", get(providers_handler))
        .route("/event", get(event_handler))
        .with_state(Arc::clone(&state));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, state)
}

async fn reconnecting_event_handler(
    State(connection_count): State<Arc<AtomicUsize>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let attempt = connection_count.fetch_add(1, Ordering::SeqCst);
    let message_id = if attempt == 0 { "msg-1" } else { "msg-2" };
    let text = if attempt == 0 { "first" } else { "second" };
    let items = vec![Ok(Event::default().data(
        serde_json::json!({
            "type": "message.created",
            "data": {
                "message": {
                    "id": message_id,
                    "sessionID": "sess-1",
                    "role": "assistant",
                    "parts": [{ "id": format!("part-{attempt}"), "type": "text", "text": text }],
                    "time": { "created": 123 + attempt }
                }
            }
        })
        .to_string(),
    ))];
    Sse::new(iter(items))
}

async fn start_reconnecting_server() -> (SocketAddr, Arc<AtomicUsize>) {
    let connection_count = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route("/global/health", get(health_handler))
        .route("/event", get(reconnecting_event_handler))
        .with_state(Arc::clone(&connection_count));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, connection_count)
}

#[tokio::test]
async fn client_create_session_and_prompt_async_use_expected_payload() {
    let (addr, state) = start_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));

    let session = client.create_session("/tmp/worktree").await.unwrap();
    assert_eq!(session.id, "sess-1");
    assert!(matches!(session.status, SessionStatus::Idle));

    let options = PromptOptions {
        model: Some(opencode_sdk_rs::ModelRef {
            provider_id: "anthropic".to_string(),
            model_id: "claude-sonnet".to_string(),
        }),
        agent: Some("build".to_string()),
        system: Some("System prompt".to_string()),
        variant: None,
    };
    client
        .prompt_async(
            "sess-1",
            vec![PromptPart::Text {
                text: "Hello from test".to_string(),
            }],
            options,
        )
        .await
        .unwrap();

    let locked = state.lock().await;
    assert_eq!(locked.session_directory.as_deref(), Some("/tmp/worktree"));
    assert_eq!(locked.prompt_path_session_id.as_deref(), Some("sess-1"));
    let payload = locked.prompt_payload.clone().unwrap();
    assert_eq!(payload["agent"], "build");
    assert_eq!(payload["system"], "System prompt");
    assert_eq!(payload["parts"][0]["type"], "text");
    assert_eq!(payload["parts"][0]["text"], "Hello from test");
    assert_eq!(payload["model"]["providerID"], "anthropic");
    assert_eq!(payload["model"]["modelID"], "claude-sonnet");
}

#[tokio::test]
async fn question_reply_in_directory_includes_scope_header() {
    let (addr, state) = start_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));

    client
        .reply_question_in_directory(
            "que_1",
            Some("/tmp/worktree"),
            vec![vec!["Alpha".to_string()], vec!["Beta".to_string()]],
        )
        .await
        .unwrap();

    let locked = state.lock().await;
    assert_eq!(
        locked.question_reply_directory.as_deref(),
        Some("/tmp/worktree")
    );
    let payload = locked.question_reply_payload.clone().unwrap();
    assert_eq!(payload["answers"][0][0], "Alpha");
    assert_eq!(payload["answers"][1][0], "Beta");
}

#[tokio::test]
async fn event_stream_parses_sse_messages_without_real_opencode() {
    let (addr, _) = start_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));
    let mut stream = client.event_stream().unwrap();

    let mut seen_part_created = false;
    let mut seen_session_updated = false;
    for _ in 0..6 {
        let next = stream.next().await;
        let Some(event) = next else {
            break;
        };
        let event = event.unwrap();
        match event {
            SseEvent::PartCreated {
                session_id,
                message_id,
                ..
            } => {
                assert_eq!(session_id, "sess-1");
                assert_eq!(message_id, "msg-1");
                seen_part_created = true;
            }
            SseEvent::SessionUpdated(session) => {
                assert_eq!(session.id, "sess-1");
                seen_session_updated = true;
            }
            _ => {}
        }
        if seen_part_created && seen_session_updated {
            break;
        }
    }

    assert!(seen_part_created, "expected message.part.created event");
    assert!(seen_session_updated, "expected session.updated event");
}

#[tokio::test]
async fn shared_dispatcher_reconnects_after_stream_end() {
    let (addr, connection_count) = start_reconnecting_server().await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));
    let dispatcher = shared_dispatcher(client, None).await;
    let mut rx = dispatcher.subscribe("sess-1").await;

    let first = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
        .await
        .expect("first event should arrive")
        .expect("channel should stay open");
    let second = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
        .await
        .expect("second event should arrive after reconnect")
        .expect("channel should stay open");

    match first {
        SseEvent::MessageCreated(message) => assert_eq!(message.id, "msg-1"),
        other => panic!("expected first message.created event, got {other:?}"),
    }
    match second {
        SseEvent::MessageCreated(message) => assert_eq!(message.id, "msg-2"),
        other => panic!("expected second message.created event, got {other:?}"),
    }

    assert!(
        connection_count.load(Ordering::SeqCst) >= 2,
        "dispatcher should reconnect after the server closes the first SSE stream"
    );
}

#[test]
fn parse_sse_event_handles_unknown_payload_shape() {
    let event = parse_sse_event(serde_json::json!({
        "type": "totally.unknown",
        "data": { "foo": "bar" }
    }));
    assert!(matches!(event, SseEvent::Unknown(_)));
}
