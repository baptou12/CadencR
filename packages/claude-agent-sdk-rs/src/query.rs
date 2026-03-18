use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use futures::Stream;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

use crate::error::SdkError;
use crate::mcp::McpServerConfig;
use crate::messages::SdkMessage;
use crate::options::Options;
use crate::permissions::{CanUseTool, PermissionMode, PermissionRequest};
use crate::transport::{find_cli, CliProcess};

// ── TurnState ────────────────────────────────────────────────────────────────

/// Represents whose "turn" it is in the agent conversation.
///
/// This is critical for Cadence's UI to know what to show:
/// - `AgentWorking` → show streaming output / spinner
/// - `TurnComplete` → show input box (session) or final result (non-session)
/// - `WaitingForPermission` → show approval UI
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnState {
    /// Claude is actively generating (streaming events flowing).
    AgentWorking,

    /// User's turn — CLI finished processing (`Result` message received).
    /// For session agents, user can send another message.
    /// For non-session agents, the agent is done.
    TurnComplete {
        result_subtype: String,
        is_error: bool,
    },

    /// User's turn — Claude is blocked waiting for permission/approval.
    /// The `canUseTool` callback is currently awaiting a response.
    WaitingForPermission {
        tool_name: String,
        tool_use_id: String,
    },
}

// ── Permission wire protocol helpers ─────────────────────────────────────────

/// Check if a raw JSON message from the CLI is a permission request.
///
/// The Claude Code CLI uses a bidirectional **control protocol** over
/// stdin/stdout for permission requests. When the CLI needs tool approval,
/// it emits a `control_request` message on stdout:
///
/// ```json
/// {
///   "type": "control_request",
///   "request_id": "req_1_abcd1234",
///   "request": {
///     "subtype": "can_use_tool",
///     "tool_name": "Write",
///     "input": { "file_path": "/tmp/test.txt", "content": "..." },
///     "permission_suggestions": []
///   }
/// }
/// ```
///
/// The SDK responds on stdin with a `control_response`:
///
/// ```json
/// {
///   "type": "control_response",
///   "response": {
///     "subtype": "success",
///     "request_id": "req_1_abcd1234",
///     "response": { "behavior": "allow", "updatedInput": { ... } }
///   }
/// }
/// ```
///
/// **Current simplification**: This implementation detects permission
/// requests by checking `type == "control_request"` and
/// `request.subtype == "can_use_tool"`. The `request_id` is echoed back
/// in the response. Other control request subtypes (e.g. `hook_callback`,
/// `mcp_message`) are ignored and passed through as `Unknown` messages.
///
/// A full control protocol implementation would handle all subtypes,
/// including the initialization handshake (`initialize` sent by the SDK
/// on startup via stdin).

/// Extract the `request.subtype` from a `control_request` message,
/// or `None` if this isn't a control_request.
fn control_request_subtype(value: &serde_json::Value) -> Option<&str> {
    if value.get("type").and_then(|t| t.as_str()) != Some("control_request") {
        return None;
    }
    value.pointer("/request/subtype").and_then(|s| s.as_str())
}

/// Parse a raw JSON permission request (control_request) into a typed
/// `PermissionRequest`.
///
/// Extracts fields from the nested `request` object within the
/// `control_request` envelope. The `request_id` is stored in
/// `tool_use_id` so it can be echoed back in the response.
fn parse_permission_request(value: &serde_json::Value) -> PermissionRequest {
    let request = value
        .get("request")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let request_id = value
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    PermissionRequest {
        tool_name: request
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        input: request
            .get("input")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        tool_use_id: request_id.to_string(),
        agent_id: request
            .get("agent_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        suggestions: request
            .get("permission_suggestions")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        blocked_path: request
            .get("blocked_path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        decision_reason: request
            .get("decision_reason")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }
}

// ── Query ────────────────────────────────────────────────────────────────────

/// A running Claude Code CLI query with streaming output and turn management.
///
/// `Query` implements [`Stream<Item = Result<SdkMessage, SdkError>>`] —
/// consume it with `while let Some(msg) = query.next().await { ... }`.
///
/// # Architecture
///
/// A background tokio task reads from the CLI process stdout, handles
/// permission requests internally (calling the `CanUseTool` handler and
/// writing responses back to stdin), and forwards all other messages
/// through an mpsc channel. This keeps the Stream interface clean while
/// supporting the blocking permission protocol.
///
/// # Turn management
///
/// Check [`turn_state()`](Query::turn_state) to determine the current state:
/// - `AgentWorking` — Claude is streaming
/// - `TurnComplete` — CLI sent a `Result` message, turn is over
/// - `WaitingForPermission` — blocked on `canUseTool` callback
pub struct Query {
    /// Channel receiving parsed SdkMessages from the background task.
    message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,

    /// Handle to write to CLI stdin (for stream_input, control commands).
    process_stdin: Arc<Mutex<Option<BufWriter<ChildStdin>>>>,

    /// Session ID captured from System init message.
    session_id: Arc<Mutex<Option<String>>>,

    /// Current turn state.
    turn_state: Arc<Mutex<TurnState>>,

    /// Background reader task handle (for cleanup).
    reader_task: Option<tokio::task::JoinHandle<()>>,

    /// Channel to signal the reader task to send SIGINT to the CLI process.
    interrupt_tx: mpsc::Sender<()>,

    /// Channel to signal the reader task to gracefully kill the CLI process.
    kill_tx: mpsc::Sender<()>,

    /// Cancellation token.
    _cancel_token: Option<CancellationToken>,
}

impl Stream for Query {
    type Item = Result<SdkMessage, SdkError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.message_rx.poll_recv(cx)
    }
}

impl Query {
    /// Take the message receiver out of the query.
    ///
    /// This is useful when you need to read messages independently of other
    /// Query operations (e.g. to avoid holding a mutex while awaiting messages).
    /// After calling this, the `Stream` impl will always return `None`.
    pub fn take_message_rx(&mut self) -> mpsc::Receiver<Result<SdkMessage, SdkError>> {
        let (_, dummy_rx) = mpsc::channel(1);
        std::mem::replace(&mut self.message_rx, dummy_rx)
    }

    /// Get the session ID (captured from System init message).
    pub async fn session_id(&self) -> Option<String> {
        self.session_id.lock().await.clone()
    }

    /// Get the current turn state.
    pub async fn turn_state(&self) -> TurnState {
        self.turn_state.lock().await.clone()
    }

    /// Interrupt the agent (SIGINT). The CLI will finish its current turn
    /// and emit a `Result` message. The session can be resumed later.
    ///
    /// The signal is routed through a channel to the background reader task,
    /// which owns the `CliProcess` and calls its `interrupt()` method.
    /// This avoids caching a stale PID (the process could have exited and
    /// the PID could have been reused by the OS).
    pub async fn interrupt(&self) -> Result<(), SdkError> {
        self.interrupt_tx
            .send(())
            .await
            .map_err(|_| SdkError::InputClosed)?;
        Ok(())
    }

    /// Gracefully kill the child process (SIGTERM → wait 5s → SIGKILL) and
    /// stop the background reader task.
    ///
    /// After this call the stream will end.
    pub async fn close(&mut self) {
        // Signal the reader loop to kill the child process.
        let _ = self.kill_tx.send(()).await;

        // Wait for the reader task to finish (it will break after killing).
        if let Some(task) = self.reader_task.take() {
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                task,
            )
            .await;
        }

        // Drop stdin for good measure.
        self.process_stdin.lock().await.take();
    }

    /// Send a user message for multi-turn interaction.
    ///
    /// Only valid when `turn_state()` is `TurnComplete` (for session agents).
    /// This writes a `user` message to CLI stdin and resets the turn state
    /// to `AgentWorking`.
    pub async fn stream_input(&self, content: serde_json::Value) -> Result<(), SdkError> {
        let session_id = self
            .session_id
            .lock()
            .await
            .clone()
            .unwrap_or_default();

        let msg = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": content },
            "parent_tool_use_id": null,
            "session_id": session_id
        });

        self.write_stdin_json(&msg).await?;

        // Reset turn state back to working
        *self.turn_state.lock().await = TurnState::AgentWorking;
        Ok(())
    }

    /// Create a stub `Query` for testing (no real CLI process).
    /// The returned `Query` has the given `session_id` pre-set and a dummy
    /// message channel that will never produce messages.
    #[doc(hidden)]
    pub fn new_test_stub(session_id: Option<String>) -> Self {
        let (msg_tx, message_rx) = mpsc::channel(1);
        drop(msg_tx); // close immediately so stream_input will fail
        let (interrupt_tx, _interrupt_rx) = mpsc::channel(1);
        let (kill_tx, _kill_rx) = mpsc::channel(1);
        Self {
            message_rx,
            process_stdin: Arc::new(Mutex::new(None)),
            session_id: Arc::new(Mutex::new(session_id)),
            turn_state: Arc::new(Mutex::new(TurnState::AgentWorking)),
            reader_task: None,
            interrupt_tx,
            kill_tx,
            _cancel_token: None,
        }
    }

    /// Close stdin (no more user input). The CLI will finish its current
    /// turn and exit.
    pub async fn close_input(&self) -> Result<(), SdkError> {
        self.process_stdin.lock().await.take();
        Ok(())
    }

    /// Change model mid-session (writes control command to stdin).
    pub async fn set_model(&self, model: &str) -> Result<(), SdkError> {
        let cmd = serde_json::json!({
            "type": "control",
            "command": "set_model",
            "model": model
        });
        self.write_stdin_json(&cmd).await
    }

    /// Change permission mode mid-session.
    pub async fn set_permission_mode(&self, mode: PermissionMode) -> Result<(), SdkError> {
        let cmd = serde_json::json!({
            "type": "control",
            "command": "set_permission_mode",
            "permission_mode": mode.as_cli_flag()
        });
        self.write_stdin_json(&cmd).await
    }

    /// Hot-swap MCP servers mid-session.
    pub async fn set_mcp_servers(
        &self,
        servers: HashMap<String, McpServerConfig>,
    ) -> Result<(), SdkError> {
        let cmd = serde_json::json!({
            "type": "control",
            "command": "set_mcp_servers",
            "mcp_servers": servers
        });
        self.write_stdin_json(&cmd).await
    }

    /// Write a JSON value to the CLI's stdin as newline-terminated NDJSON.
    async fn write_stdin_json(&self, value: &serde_json::Value) -> Result<(), SdkError> {
        write_to_stdin(&self.process_stdin, value).await
    }
}

impl Drop for Query {
    fn drop(&mut self) {
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
    }
}

// ── Shared stdin write helper ────────────────────────────────────────────────

/// Write a JSON value to the CLI's stdin as newline-terminated NDJSON.
///
/// Used by both `Query` methods and the background `reader_loop` to avoid
/// duplicating the lock-serialize-write-flush sequence.
async fn write_to_stdin(
    process_stdin: &Mutex<Option<BufWriter<ChildStdin>>>,
    value: &serde_json::Value,
) -> Result<(), SdkError> {
    let mut guard = process_stdin.lock().await;
    let stdin = guard.as_mut().ok_or(SdkError::InputClosed)?;
    let json = serde_json::to_string(value).map_err(SdkError::SerializationError)?;
    debug!(stdin_json = %json, "writing to CLI stdin");
    stdin
        .write_all(json.as_bytes())
        .await
        .map_err(SdkError::IoError)?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(SdkError::IoError)?;
    stdin.flush().await.map_err(SdkError::IoError)?;
    Ok(())
}

// ── Background reader task ───────────────────────────────────────────────────

/// Core background loop that reads from CLI stdout, handles permission
/// requests, and forwards messages to the channel.
async fn reader_loop(
    mut process: CliProcess,
    process_stdin: Arc<Mutex<Option<BufWriter<ChildStdin>>>>,
    tx: mpsc::Sender<Result<SdkMessage, SdkError>>,
    can_use_tool: Option<Box<dyn CanUseTool>>,
    session_id: Arc<Mutex<Option<String>>>,
    turn_state: Arc<Mutex<TurnState>>,
    cancel_token: Option<CancellationToken>,
    mut interrupt_rx: mpsc::Receiver<()>,
    mut kill_rx: mpsc::Receiver<()>,
) {
    loop {
        // Select between reading the next message, receiving an interrupt signal,
        // and cancellation. The cancellation branch ensures we break out even if
        // the reader is blocked waiting for CLI output.
        let raw = tokio::select! {
            result = process.read_message() => {
                match result {
                    Ok(Some(value)) => value,
                    Ok(None) => {
                        // EOF — process exited, check exit code
                        let (code, stderr) = process.wait_with_stderr().await;
                        if code.unwrap_or(0) != 0 {
                            let _ = tx
                                .send(Err(SdkError::ProcessExit { code, stderr }))
                                .await;
                        }
                        debug!("CLI process exited (code={code:?})");
                        break;
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e)).await;
                        break;
                    }
                }
            }
            _ = interrupt_rx.recv() => {
                debug!("interrupt signal received, sending SIGINT to CLI process");
                if let Err(e) = process.interrupt().await {
                    warn!("failed to interrupt CLI process: {e}");
                }
                continue;
            }
            _ = kill_rx.recv() => {
                debug!("kill signal received, terminating CLI process");
                if let Err(e) = process.kill().await {
                    warn!("failed to kill CLI process: {e}");
                }
                break;
            }
            _ = async {
                if let Some(ref token) = cancel_token {
                    token.cancelled().await
                } else {
                    std::future::pending().await
                }
            } => {
                let _ = tx.send(Err(SdkError::Cancelled)).await;
                break;
            }
        };

        // Skip control_response messages (e.g. the CLI's reply to our
        // initialize control_request). These are not SDK messages.
        if raw.get("type").and_then(|t| t.as_str()) == Some("control_response") {
            debug!("received control_response, skipping");
            continue;
        }

        // Handle `initialize` control_request from the CLI (if it sends one).
        // Respond so the CLI knows we support the control protocol.
        if control_request_subtype(&raw) == Some("initialize") {
            let request_id = raw
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            debug!("received initialize control request, responding");
            let response_json = serde_json::json!({
                "type": "control_response",
                "response": {
                    "subtype": "success",
                    "request_id": request_id,
                    "response": {}
                }
            });
            if let Err(e) = write_to_stdin(&process_stdin, &response_json).await {
                let _ = tx.send(Err(e)).await;
                break;
            }
            continue;
        }

        // Check if this is a permission request (canUseTool protocol)
        if control_request_subtype(&raw) == Some("can_use_tool") {
            let request = parse_permission_request(&raw);
            debug!(tool = %request.tool_name, "received permission request");

            // Save request_id before request is moved into the callback
            let request_id = request.tool_use_id.clone();

            if let Some(ref can_use_tool) = can_use_tool {
                // Update turn state — we're now waiting for user
                *turn_state.lock().await = TurnState::WaitingForPermission {
                    tool_name: request.tool_name.clone(),
                    tool_use_id: request_id.clone(),
                };

                // BLOCK here until the CanUseTool callback resolves.
                // This is the mechanism for AskUserQuestion, ExitPlanMode, etc.
                let result = can_use_tool.can_use_tool(request).await;

                // Write permission response back to CLI stdin as a control_response
                let inner_response = match serde_json::to_value(&result) {
                    Ok(v) => v,
                    Err(e) => {
                        error!("failed to serialize permission response: {e}");
                        let _ = tx.send(Err(SdkError::SerializationError(e))).await;
                        break;
                    }
                };
                let response_json = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": request_id,
                        "response": inner_response
                    }
                });

                if let Err(e) = write_to_stdin(&process_stdin, &response_json).await {
                    let _ = tx.send(Err(e)).await;
                    break;
                }

                // Back to agent working
                *turn_state.lock().await = TurnState::AgentWorking;
            } else {
                // No handler — auto-allow
                warn!("no canUseTool handler, auto-allowing tool use");
                let auto_allow = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": request.tool_use_id,
                        "response": { "behavior": "allow" }
                    }
                });
                if let Err(e) = write_to_stdin(&process_stdin, &auto_allow).await {
                    let _ = tx.send(Err(e)).await;
                    break;
                }
            }

            continue; // Don't yield permission requests to the caller
        }

        // Parse into SdkMessage
        let message: SdkMessage = match serde_json::from_value(raw.clone()) {
            Ok(msg) => msg,
            Err(_) => SdkMessage::Unknown(raw),
        };

        // Capture session_id from System init
        if let Some(sid) = message.session_id() {
            let mut guard = session_id.lock().await;
            if guard.is_none() {
                debug!(session_id = sid, "captured session ID");
                *guard = Some(sid.to_string());
            }
        }

        // Update turn state on Result message
        if let SdkMessage::Result {
            ref subtype,
            is_error,
            ..
        } = message
        {
            *turn_state.lock().await = TurnState::TurnComplete {
                result_subtype: subtype.clone(),
                is_error,
            };
        }

        // Send message to caller
        if tx.send(Ok(message)).await.is_err() {
            debug!("receiver dropped, stopping reader loop");
            break;
        }
    }
}

// ── Public constructor ───────────────────────────────────────────────────────

/// Spawn a Claude CLI query and return a streaming [`Query`] handle.
///
/// The `Query` implements [`Stream<Item = Result<SdkMessage, SdkError>>`].
/// Iterate it with `while let Some(msg) = query.next().await` using
/// [`StreamExt`](futures::StreamExt).
///
/// # Turn management
///
/// - While streaming, [`Query::turn_state()`] is [`TurnState::AgentWorking`]
/// - When a `Result` message arrives, it becomes [`TurnState::TurnComplete`]
/// - When `canUseTool` blocks, it becomes [`TurnState::WaitingForPermission`]
///
/// # Example
///
/// ```no_run
/// use claude_agent_sdk_rs::{query, Options, TurnState};
/// use futures::StreamExt;
///
/// # async fn example() -> Result<(), claude_agent_sdk_rs::SdkError> {
/// let options = Options::default();
/// let mut q = query("Hello Claude".into(), options).await?;
///
/// while let Some(msg) = q.next().await {
///     match msg {
///         Ok(msg) => println!("{msg:?}"),
///         Err(e) => eprintln!("error: {e}"),
///     }
/// }
/// # Ok(())
/// # }
/// ```
pub async fn query(content: serde_json::Value, mut options: Options) -> Result<Query, SdkError> {
    let cli_path = find_cli(options.path_to_cli.as_deref())?;
    let mut process = CliProcess::spawn(&cli_path, &options).await?;

    // Take stdin out of the process — Query and the reader loop share it
    // via Arc<Mutex<..>> so the reader loop can write permission responses
    // and Query can write user messages / control commands.
    let stdin = process.take_stdin();
    let process_stdin = Arc::new(Mutex::new(stdin));

    // Send the initialize control request so the CLI knows we support
    // the bidirectional control protocol (canUseTool, AskUserQuestion, etc.).
    let init_request_id = format!("init_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos());
    let init_msg = serde_json::json!({
        "type": "control_request",
        "request_id": init_request_id,
        "request": {
            "subtype": "initialize",
            "systemPrompt": options.system_prompt.as_deref(),
        }
    });
    debug!("sending initialize control_request to CLI stdin");
    write_to_stdin(&process_stdin, &init_msg).await?;

    // Write initial prompt to stdin
    let prompt_msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
        "session_id": ""
    });
    write_to_stdin(&process_stdin, &prompt_msg).await?;

    // Extract runtime-only fields from options
    let can_use_tool = options.can_use_tool.take();
    let cancel_token = options.abort_signal.take();

    // Set up channel and shared state
    let (tx, rx) = mpsc::channel(256);
    let (interrupt_tx, interrupt_rx) = mpsc::channel(4);
    let (kill_tx, kill_rx) = mpsc::channel(1);
    let session_id = Arc::new(Mutex::new(None));
    let turn_state = Arc::new(Mutex::new(TurnState::AgentWorking));

    // Spawn background reader
    let reader_task = tokio::spawn(reader_loop(
        process,
        Arc::clone(&process_stdin),
        tx,
        can_use_tool,
        Arc::clone(&session_id),
        Arc::clone(&turn_state),
        cancel_token.clone(),
        interrupt_rx,
        kill_rx,
    ));

    Ok(Query {
        message_rx: rx,
        process_stdin,
        session_id,
        turn_state,
        reader_task: Some(reader_task),
        interrupt_tx,
        kill_tx,
        _cancel_token: cancel_token,
    })
}

// ── Supported commands ───────────────────────────────────────────────────────

/// Fetch available slash commands for a given working directory.
///
/// Spawns a lightweight CLI subprocess, reads the first `system.init` message
/// to extract the `slash_commands` list, then kills the subprocess. This avoids
/// starting a full query/session just to discover available commands.
///
/// The CLI's init message only provides command names (strings), so the returned
/// `SlashCommand` values have `description: None`.
///
/// # Timeout
///
/// If the CLI doesn't emit an init message within 10 seconds, returns
/// [`SdkError::Timeout`].
pub async fn supported_commands(
    cwd: &str,
    path_to_cli: Option<&std::path::Path>,
) -> Result<Vec<crate::types::SlashCommand>, SdkError> {
    use crate::transport::{find_cli, CliProcess};
    use crate::messages::{SdkMessage, SystemMessage};

    let cli_path = find_cli(path_to_cli)?;

    // Build minimal options — just enough to spawn the CLI and get init message.
    let options = Options {
        cwd: std::path::PathBuf::from(cwd),
        ..Options::default()
    };

    let mut process = CliProcess::spawn(&cli_path, &options).await?;

    // Write the initialize control request + a dummy prompt to trigger init.
    let stdin = process.take_stdin();
    let process_stdin = tokio::sync::Mutex::new(stdin);

    let init_request_id = format!(
        "init_cmd_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let init_msg = serde_json::json!({
        "type": "control_request",
        "request_id": init_request_id,
        "request": { "subtype": "initialize" }
    });
    write_to_stdin(&process_stdin, &init_msg).await?;

    let prompt_msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": "noop" },
        "parent_tool_use_id": null,
        "session_id": ""
    });
    write_to_stdin(&process_stdin, &prompt_msg).await?;

    // Read messages until we get the system init, with a 10s timeout.
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match process.read_message().await? {
                Some(raw) => {
                    // Skip control_response messages
                    if raw.get("type").and_then(|t| t.as_str()) == Some("control_response") {
                        continue;
                    }
                    // Handle initialize control_request from CLI
                    if control_request_subtype(&raw) == Some("initialize") {
                        let request_id = raw
                            .get("request_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let response_json = serde_json::json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "success",
                                "request_id": request_id,
                                "response": {}
                            }
                        });
                        write_to_stdin(&process_stdin, &response_json).await?;
                        continue;
                    }
                    // Try parsing as SdkMessage
                    let message: SdkMessage = match serde_json::from_value(raw) {
                        Ok(msg) => msg,
                        Err(_) => continue,
                    };
                    if let SdkMessage::System(SystemMessage::Init { slash_commands, .. }) = message
                    {
                        return Ok::<Vec<crate::types::SlashCommand>, SdkError>(
                            slash_commands
                                .into_iter()
                                .map(|name| crate::types::SlashCommand {
                                    name,
                                    description: None,
                                })
                                .collect(),
                        );
                    }
                    // Not the init message, keep reading
                }
                None => {
                    // EOF before init
                    let (code, stderr) = process.wait_with_stderr().await;
                    return Err(SdkError::ProcessExit { code, stderr });
                }
            }
        }
    })
    .await;

    // Kill the subprocess regardless of outcome.
    let _ = process.kill().await;

    match result {
        Ok(commands) => commands,
        Err(_elapsed) => Err(SdkError::Timeout),
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;

    #[test]
    fn turn_state_equality() {
        let a = TurnState::AgentWorking;
        let b = TurnState::AgentWorking;
        assert_eq!(a, b);

        let c = TurnState::TurnComplete {
            result_subtype: "success".to_string(),
            is_error: false,
        };
        let d = TurnState::TurnComplete {
            result_subtype: "success".to_string(),
            is_error: false,
        };
        assert_eq!(c, d);

        assert_ne!(a, c);
    }

    #[test]
    fn control_request_subtype_extracts_correctly() {
        let pr = serde_json::json!({
            "type": "control_request",
            "request_id": "req_1_abc123",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Write",
                "input": { "path": "/tmp/foo" }
            }
        });
        assert_eq!(control_request_subtype(&pr), Some("can_use_tool"));

        let not_pr = serde_json::json!({ "type": "stream_event" });
        assert_eq!(control_request_subtype(&not_pr), None);

        let hook_req = serde_json::json!({
            "type": "control_request",
            "request_id": "req_2",
            "request": { "subtype": "hook_callback" }
        });
        assert_eq!(control_request_subtype(&hook_req), Some("hook_callback"));

        let init_req = serde_json::json!({
            "type": "control_request",
            "request_id": "req_3",
            "request": { "subtype": "initialize" }
        });
        assert_eq!(control_request_subtype(&init_req), Some("initialize"));
    }

    #[test]
    fn parse_permission_request_extracts_fields() {
        let pr = serde_json::json!({
            "type": "control_request",
            "request_id": "req_1_abc",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Edit",
                "input": { "file": "main.rs" },
                "agent_id": "agent_1",
                "blocked_path": "/src/main.rs",
                "decision_reason": "file write",
                "permission_suggestions": []
            }
        });
        let req = parse_permission_request(&pr);
        assert_eq!(req.tool_name, "Edit");
        assert_eq!(req.tool_use_id, "req_1_abc"); // request_id becomes tool_use_id
        assert_eq!(req.agent_id, Some("agent_1".to_string()));
        assert_eq!(req.blocked_path, Some("/src/main.rs".to_string()));
        assert_eq!(req.decision_reason, Some("file write".to_string()));
    }

    #[tokio::test]
    async fn query_stream_from_mock_cli() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: emit a system init, a stream event, and a result
        let script = r#"#!/bin/sh
read -r INPUT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_123","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"stream_event","uuid":"u2","session_id":"sess_123","parent_tool_use_id":null,"event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}'
echo '{"type":"result","subtype":"success","uuid":"u3","session_id":"sess_123","duration_ms":100,"duration_api_ms":80,"is_error":false,"num_turns":1,"result":"Hello","errors":null,"stop_reason":"end_turn","total_cost_usd":0.001,"usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options).await.unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // Should get: System(Init), StreamEvent, Result
        assert!(messages.len() >= 3, "got {} messages", messages.len());

        // Verify session_id was captured
        let sid = q.session_id().await;
        assert_eq!(sid, Some("sess_123".to_string()));

        // Verify turn state is TurnComplete
        let state = q.turn_state().await;
        assert!(matches!(
            state,
            TurnState::TurnComplete {
                ref result_subtype,
                is_error: false,
            } if result_subtype == "success"
        ));
    }

    #[tokio::test]
    async fn close_kills_child_process() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: emit system init then sleep forever (simulates a long-running process)
        let script = r#"#!/bin/sh
read -r INPUT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_close","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
sleep 300
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options).await.unwrap();

        // Read the system init message
        let msg = q.next().await;
        assert!(msg.is_some());

        // Close should kill the process and the stream should end
        q.close().await;

        // After close, the stream should be done (no more messages)
        let remaining = q.next().await;
        assert!(remaining.is_none(), "stream should end after close()");
    }

    #[tokio::test]
    async fn take_message_rx_drains_stream_and_receiver_works() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: emit system init and a result
        let script = r#"#!/bin/sh
read -r INPUT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_take","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"result","subtype":"success","uuid":"u2","session_id":"sess_take","duration_ms":10,"duration_api_ms":5,"is_error":false,"num_turns":1,"result":"ok","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options).await.unwrap();

        // Take the receiver out
        let mut rx = q.take_message_rx();

        // After take, Stream impl should return None
        let stream_result = q.next().await;
        assert!(stream_result.is_none(), "stream should return None after take_message_rx");

        // The taken receiver should still get messages
        let mut messages = Vec::new();
        while let Some(msg) = rx.recv().await {
            messages.push(msg.unwrap());
        }

        assert!(messages.len() >= 2, "receiver should get messages, got {}", messages.len());
    }

    #[tokio::test]
    async fn query_handles_permission_request() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: handle initialize, read user prompt, emit a permission request, read the response, then emit result
        let script = r#"#!/bin/sh
read -r INIT_REQ
echo '{"type":"control_response","response":{"subtype":"success","request_id":"init_perm","response":{"pid":9999}}}'
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_456","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"control_request","request_id":"req_1_perm","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"path":"/tmp/test.txt"}}}'
read -r RESPONSE
echo '{"type":"result","subtype":"success","uuid":"u3","session_id":"sess_456","duration_ms":50,"duration_api_ms":40,"is_error":false,"num_turns":1,"result":"done","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":5,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        // Use AllowAllTools handler
        let options = Options {
            path_to_cli: Some(script_path),
            can_use_tool: Some(Box::new(crate::permissions::AllowAllTools)),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options).await.unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // Permission request should NOT appear in messages (handled internally)
        // Should get: System(Init), Result
        assert!(messages.len() >= 2, "got {} messages", messages.len());
        assert!(messages
            .iter()
            .all(|m| !matches!(m, SdkMessage::Unknown(v) if control_request_subtype(v) == Some("can_use_tool"))));
    }

    #[tokio::test]
    async fn query_sends_initialize_and_skips_control_response() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: read the initialize request, respond with control_response,
        // then read the user prompt, emit system init + result.
        // The control_response should NOT appear as an SDK message.
        let script = r#"#!/bin/sh
read -r INIT_REQ
echo '{"type":"control_response","response":{"subtype":"success","request_id":"init_test","response":{"pid":1234}}}'
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_init","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"result","subtype":"success","uuid":"u2","session_id":"sess_init","duration_ms":10,"duration_api_ms":5,"is_error":false,"num_turns":1,"result":"ok","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options).await.unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // control_response should be filtered out — only System(Init) + Result
        assert_eq!(messages.len(), 2, "expected 2 messages, got {}", messages.len());
        assert!(messages
            .iter()
            .all(|m| !matches!(m, SdkMessage::Unknown(v) if v.get("type").and_then(|t| t.as_str()) == Some("control_response"))));

        let sid = q.session_id().await;
        assert_eq!(sid, Some("sess_init".to_string()));
    }

    #[tokio::test]
    async fn query_responds_to_initialize_control_request_from_cli() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: read init + prompt from SDK, then send its OWN initialize
        // control_request (the CLI sometimes sends this). The SDK must respond
        // so the CLI continues. Then emit system init + result.
        let script = r#"#!/bin/sh
read -r SDK_INIT
read -r USER_PROMPT
echo '{"type":"control_request","request_id":"cli_init_1","request":{"subtype":"initialize"}}'
read -r SDK_RESPONSE
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_clinit","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"result","subtype":"success","uuid":"u2","session_id":"sess_clinit","duration_ms":10,"duration_api_ms":5,"is_error":false,"num_turns":1,"result":"ok","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options).await.unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // The CLI's initialize request should be handled (responded to) and not
        // forwarded as a message. We should only see System(Init) + Result.
        assert_eq!(messages.len(), 2, "expected 2 messages, got {}", messages.len());

        let sid = q.session_id().await;
        assert_eq!(sid, Some("sess_clinit".to_string()));
    }

    #[tokio::test]
    async fn supported_commands_extracts_slash_commands() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: read init + prompt, emit system init with slash_commands, then exit
        let script = r#"#!/bin/sh
read -r INIT_REQ
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_cmd","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":["compact","review","init"],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"result","subtype":"success","uuid":"u2","session_id":"sess_cmd","duration_ms":10,"duration_api_ms":5,"is_error":false,"num_turns":1,"result":"ok","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let commands = supported_commands(
            "/tmp",
            Some(script_path.as_path()),
        )
        .await
        .unwrap();

        assert_eq!(commands.len(), 3);
        assert_eq!(commands[0].name, "compact");
        assert_eq!(commands[1].name, "review");
        assert_eq!(commands[2].name, "init");
        assert!(commands[0].description.is_none());
    }
}
