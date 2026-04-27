use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;

use crate::discovery::resolved_codex_command;
use crate::error::SdkError;
use crate::parse::{parse_model, parse_thread_handle, parse_turn_handle};
use crate::protocol::{
    app_server_args, decode_inbound_message, mcp_server_status_list_params, InboundMessage,
};
use crate::types::{AppServerEvent, CodexModel, ThreadHandle, TurnHandle};

type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, SdkError>>>;

#[derive(Clone)]
pub struct CodexAppServerClient {
    inner: Arc<Inner>,
}

#[derive(Debug, Clone, Default)]
pub struct AppServerSpawnOptions {
    pub env: Option<HashMap<String, String>>,
    pub enable_features: Vec<String>,
}

struct Inner {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Arc<StdMutex<PendingMap>>,
    events: broadcast::Sender<AppServerEvent>,
    reader_task: Mutex<Option<JoinHandle<()>>>,
}

struct PendingRequestGuard {
    pending: Arc<StdMutex<PendingMap>>,
    id: u64,
}

impl Drop for PendingRequestGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&self.id);
        }
    }
}

struct ReaderState {
    pending: Arc<StdMutex<PendingMap>>,
    events: broadcast::Sender<AppServerEvent>,
}

impl CodexAppServerClient {
    pub async fn spawn_with_options(options: AppServerSpawnOptions) -> Result<Self, SdkError> {
        let mut command = Command::new(resolved_codex_command().await?);
        command.args(app_server_args(&options.enable_features));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        if let Some(env) = options.env {
            command.envs(env);
        }
        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SdkError::Protocol("missing app-server stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SdkError::Protocol("missing app-server stdout".to_string()))?;
        let (events, _) = broadcast::channel(512);
        let inner = Arc::new(Inner {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending: Arc::new(StdMutex::new(HashMap::new())),
            events,
            reader_task: Mutex::new(None),
        });
        let reader_task = spawn_reader(
            ReaderState {
                pending: Arc::clone(&inner.pending),
                events: inner.events.clone(),
            },
            stdout,
        );
        *inner.reader_task.lock().await = Some(reader_task);
        Ok(Self { inner })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AppServerEvent> {
        self.inner.events.subscribe()
    }

    pub async fn initialize(&self) -> Result<Value, SdkError> {
        let response = self
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "cadence",
                        "title": "Cadence",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {
                        "experimentalApi": true,
                    },
                }),
            )
            .await?;
        self.notify("initialized", json!({})).await?;
        Ok(response)
    }

    pub async fn initialize_with_timeout(&self, timeout: Duration) -> Result<Value, SdkError> {
        tokio::time::timeout(timeout, self.initialize())
            .await
            .map_err(|_| SdkError::Timeout("initialize"))?
    }

    pub async fn model_list(&self) -> Result<Vec<CodexModel>, SdkError> {
        let mut cursor = Value::Null;
        let mut models = Vec::new();
        loop {
            let result = self
                .request(
                    "model/list",
                    json!({
                        "cursor": cursor,
                        "limit": 100,
                        "includeHidden": false,
                    }),
                )
                .await?;
            models.extend(
                result
                    .get("data")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(parse_model),
            );
            cursor = result.get("nextCursor").cloned().unwrap_or(Value::Null);
            if cursor.is_null() {
                break;
            }
        }
        Ok(models)
    }

    pub async fn thread_start(&self, params: Value) -> Result<ThreadHandle, SdkError> {
        let result = self.request("thread/start", params).await?;
        parse_thread_handle(&result)
    }

    pub async fn thread_resume(&self, params: Value) -> Result<ThreadHandle, SdkError> {
        let result = self.request("thread/resume", params).await?;
        parse_thread_handle(&result)
    }

    pub async fn thread_unsubscribe(&self, thread_id: &str) -> Result<(), SdkError> {
        self.request("thread/unsubscribe", json!({ "threadId": thread_id }))
            .await
            .map(|_| ())
    }

    pub async fn thread_compact_start(&self, thread_id: &str) -> Result<(), SdkError> {
        self.request("thread/compact/start", json!({ "threadId": thread_id }))
            .await
            .map(|_| ())
    }

    pub async fn turn_start(&self, params: Value) -> Result<TurnHandle, SdkError> {
        let result = self.request("turn/start", params).await?;
        parse_turn_handle(&result)
    }

    pub async fn turn_steer(
        &self,
        thread_id: &str,
        turn_id: &str,
        input: Vec<Value>,
    ) -> Result<(), SdkError> {
        self.request(
            "turn/steer",
            json!({
                "threadId": thread_id,
                "expectedTurnId": turn_id,
                "input": input,
            }),
        )
        .await
        .map(|_| ())
    }

    pub async fn turn_interrupt(&self, thread_id: &str, turn_id: &str) -> Result<(), SdkError> {
        self.request(
            "turn/interrupt",
            json!({
                "threadId": thread_id,
                "turnId": turn_id,
            }),
        )
        .await
        .map(|_| ())
    }

    pub async fn mcp_server_status_list(&self) -> Result<Value, SdkError> {
        let mut cursor = Value::Null;
        let mut data = Vec::new();
        loop {
            let result = self
                .request(
                    "mcpServerStatus/list",
                    mcp_server_status_list_params(cursor),
                )
                .await?;
            data.extend(
                result
                    .get("data")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .cloned(),
            );
            cursor = result.get("nextCursor").cloned().unwrap_or(Value::Null);
            if cursor.is_null() {
                break;
            }
        }
        Ok(json!({ "data": data }))
    }

    pub async fn respond_server_request(&self, id: Value, result: Value) -> Result<(), SdkError> {
        self.write_json(json!({ "id": id, "result": result })).await
    }

    pub async fn reject_server_request(
        &self,
        id: Value,
        code: i64,
        message: &str,
    ) -> Result<(), SdkError> {
        self.write_json(json!({
            "id": id,
            "error": {
                "code": code,
                "message": message,
            },
        }))
        .await
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, SdkError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .map_err(|_| SdkError::Protocol("pending request lock poisoned".to_string()))?
            .insert(id, tx);
        let pending_guard = PendingRequestGuard {
            pending: Arc::clone(&self.inner.pending),
            id,
        };
        let write_result = self
            .write_json(json!({
                "id": id,
                "method": method,
                "params": params,
            }))
            .await;
        if let Err(error) = write_result {
            return Err(error);
        }
        let result = rx.await.map_err(|_| SdkError::ResponseClosed)?;
        drop(pending_guard);
        result
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), SdkError> {
        self.write_json(json!({
            "method": method,
            "params": params,
        }))
        .await
    }

    pub async fn shutdown(&self) {
        let mut child = self.inner.child.lock().await;
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        drop(child);
        if let Some(reader_task) = self.inner.reader_task.lock().await.take() {
            let _ = tokio::time::timeout(Duration::from_secs(2), reader_task).await;
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.inner
            .child
            .try_lock()
            .ok()
            .and_then(|child| child.id())
    }

    async fn write_json(&self, message: Value) -> Result<(), SdkError> {
        let raw = serde_json::to_vec(&message)?;
        let mut stdin = self.inner.stdin.lock().await;
        stdin.write_all(&raw).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }
}

fn spawn_reader(state: ReaderState, stdout: tokio::process::ChildStdout) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => handle_message(&state, message).await,
                    Err(error) => tracing::warn!(%error, "failed to parse codex app-server line"),
                },
                Ok(None) => break,
                Err(error) => {
                    tracing::warn!(%error, "codex app-server stdout read failed");
                    break;
                }
            }
        }

        if let Ok(mut pending) = state.pending.lock() {
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err(SdkError::ProcessExited));
            }
        }
        let _ = state.events.send(AppServerEvent::ProcessExited);
    })
}

async fn handle_message(state: &ReaderState, message: Value) {
    match decode_inbound_message(message) {
        InboundMessage::Event(event) => {
            let _ = state.events.send(event);
        }
        InboundMessage::Response { id, result } => {
            let tx = state
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&id));
            if let Some(tx) = tx {
                let _ = tx.send(result);
            }
        }
        InboundMessage::Ignore => {}
    }
}
