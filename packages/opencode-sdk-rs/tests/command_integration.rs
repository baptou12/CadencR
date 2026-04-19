use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use opencode_sdk_rs::{ModelRef, OpenCodeClient, PromptOptions, PromptPart};

#[derive(Default)]
struct ServerState {
    command_directory: Option<String>,
    prompt_directory: Option<String>,
    listed_commands: Vec<Value>,
    command_payload: Option<Value>,
    prompt_payload: Option<Value>,
    missing_command: Option<String>,
}

async fn command_list_handler(
    State(state): State<Arc<Mutex<ServerState>>>,
    headers: HeaderMap,
) -> Json<Vec<Value>> {
    state.lock().await.command_directory = headers
        .get("x-opencode-directory")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    Json(state.lock().await.listed_commands.clone())
}

async fn prompt_async_handler(
    State(state): State<Arc<Mutex<ServerState>>>,
    headers: HeaderMap,
    Path(_session_id): Path<String>,
    Json(payload): Json<Value>,
) -> StatusCode {
    let mut locked = state.lock().await;
    locked.prompt_directory = headers
        .get("x-opencode-directory")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    locked.prompt_payload = Some(payload);
    StatusCode::NO_CONTENT
}

async fn command_handler(
    State(state): State<Arc<Mutex<ServerState>>>,
    Path(_session_id): Path<String>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let mut locked = state.lock().await;
    locked.command_payload = Some(payload.clone());
    let command = payload
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if locked.missing_command.as_deref() == Some(command) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "name": "UnknownError",
                "data": {
                    "message": format!("Command not found: \"{command}\"")
                }
            })),
        );
    }

    (StatusCode::NO_CONTENT, Json(Value::Null))
}

async fn start_server(state: Arc<Mutex<ServerState>>) -> SocketAddr {
    let app = Router::new()
        .route("/command", get(command_list_handler))
        .route("/session/{id}/prompt_async", post(prompt_async_handler))
        .route("/session/{id}/command", post(command_handler))
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

fn prompt_options() -> PromptOptions {
    PromptOptions {
        agent: Some("build".to_string()),
        model: Some(ModelRef {
            provider_id: "anthropic".to_string(),
            model_id: "claude-sonnet".to_string(),
        }),
        system: Some("system prompt".to_string()),
        variant: None,
    }
}

#[tokio::test]
async fn list_commands_in_directory_returns_server_commands() {
    let state = Arc::new(Mutex::new(ServerState {
        listed_commands: vec![json!({
            "name": "finish-job",
            "description": "Finish the current change",
            "template": "Use finish-job"
        })],
        ..ServerState::default()
    }));
    let addr = start_server(Arc::clone(&state)).await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));

    let commands = client
        .list_commands_in_directory(Some("/tmp/worktree"))
        .await
        .unwrap();

    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].name, "finish-job");
    assert_eq!(
        commands[0].description.as_deref(),
        Some("Finish the current change")
    );
    assert_eq!(
        state.lock().await.command_directory.as_deref(),
        Some("/tmp/worktree")
    );
}

#[tokio::test]
async fn slash_input_uses_command_endpoint() {
    let state = Arc::new(Mutex::new(ServerState::default()));
    let addr = start_server(Arc::clone(&state)).await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));

    client
        .send_prompt_or_command_in_directory(
            "ses_123",
            Some("/tmp/worktree"),
            vec![PromptPart::Text {
                text: "/review src/lib.rs".to_string(),
            }],
            prompt_options(),
        )
        .await
        .unwrap();

    let locked = state.lock().await;
    let payload = locked.command_payload.clone().unwrap();
    assert_eq!(payload["command"], "review");
    assert_eq!(payload["arguments"], "src/lib.rs");
    assert_eq!(payload["agent"], "build");
    assert_eq!(payload["model"], "anthropic/claude-sonnet");
    assert!(locked.prompt_payload.is_none());
}

#[tokio::test]
async fn unknown_command_falls_back_to_prompt_async() {
    let temp = TempDir::new().unwrap();
    std::fs::create_dir_all(temp.path().join(".git")).unwrap();
    std::fs::create_dir_all(temp.path().join(".agents/skills/finish-job")).unwrap();
    std::fs::write(
        temp.path().join(".agents/skills/finish-job/SKILL.md"),
        "---\nname: finish-job\ndescription: Finish the current change\nuser-invocable: true\n---\n# Finish Job\n",
    )
    .unwrap();

    let state = Arc::new(Mutex::new(ServerState {
        missing_command: Some("finish-job".to_string()),
        ..ServerState::default()
    }));
    let addr = start_server(Arc::clone(&state)).await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));

    client
        .send_prompt_or_command_in_directory(
            "ses_456",
            Some(temp.path().to_str().unwrap()),
            vec![PromptPart::Text {
                text: "/finish-job tighten tests".to_string(),
            }],
            prompt_options(),
        )
        .await
        .unwrap();

    let locked = state.lock().await;
    assert_eq!(
        locked.command_payload.as_ref().unwrap()["command"],
        "finish-job"
    );
    let prompt = locked.prompt_payload.clone().unwrap();
    assert_eq!(
        prompt["parts"][0]["text"],
        "Use the `finish-job` skill for this request.\n\nAdditional scope or notes:\ntighten tests"
    );
    assert_eq!(prompt["agent"], "build");
    assert_eq!(
        locked.prompt_directory.as_deref(),
        Some(temp.path().to_str().unwrap())
    );
}

#[tokio::test]
async fn plain_prompt_uses_prompt_async_endpoint() {
    let state = Arc::new(Mutex::new(ServerState::default()));
    let addr = start_server(Arc::clone(&state)).await;
    let client = OpenCodeClient::with_base_url(format!("http://{addr}"));

    client
        .send_prompt_or_command_in_directory(
            "ses_789",
            Some("/tmp/worktree"),
            vec![PromptPart::Text {
                text: "Explain this failure".to_string(),
            }],
            prompt_options(),
        )
        .await
        .unwrap();

    let locked = state.lock().await;
    assert!(locked.command_payload.is_none());
    assert_eq!(
        locked.prompt_payload.as_ref().unwrap()["parts"][0]["text"],
        "Explain this failure"
    );
}
