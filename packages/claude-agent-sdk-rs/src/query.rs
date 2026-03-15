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
/// The Claude Code CLI emits permission requests as JSON objects with
/// `type: "permission_request"` on stdout when it needs tool approval.
///
/// TODO: Verify exact wire format against the Claude Code CLI source.
/// The TS SDK uses a callback-based approach; the CLI subprocess protocol
/// may use a different message envelope. This implementation handles the
/// known format from the stream-json protocol.
fn is_permission_request(value: &serde_json::Value) -> bool {
    value.get("type").and_then(|t| t.as_str()) == Some("permission_request")
}

/// Parse a raw JSON permission request into a typed `PermissionRequest`.
fn parse_permission_request(value: &serde_json::Value) -> PermissionRequest {
    PermissionRequest {
        tool_name: value
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        input: value
            .get("input")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        tool_use_id: value
            .get("tool_use_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        agent_id: value
            .get("agent_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        suggestions: None, // Parsed from nested field if present
        blocked_path: value
            .get("blocked_path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        decision_reason: value
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

    /// Child process PID (for interrupt via SIGINT).
    child_pid: Arc<Mutex<Option<u32>>>,

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
    pub async fn interrupt(&self) -> Result<(), SdkError> {
        #[cfg(unix)]
        {
            let pid = self.child_pid.lock().await;
            if let Some(pid) = *pid {
                unsafe {
                    libc::kill(pid as libc::pid_t, libc::SIGINT);
                }
                debug!(pid, "sent SIGINT to CLI process");
            }
        }
        Ok(())
    }

    /// Kill the process and abort the background reader task.
    ///
    /// After this call the stream will end.
    pub async fn close(&mut self) {
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
        // Dropping stdin will signal EOF to the child
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
        let mut guard = self.process_stdin.lock().await;
        let stdin = guard.as_mut().ok_or(SdkError::InputClosed)?;
        let json = serde_json::to_string(value).map_err(SdkError::SerializationError)?;
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
}

impl Drop for Query {
    fn drop(&mut self) {
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
    }
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
) {
    loop {
        // Check cancellation
        if let Some(ref token) = cancel_token {
            if token.is_cancelled() {
                let _ = tx.send(Err(SdkError::Cancelled)).await;
                break;
            }
        }

        // Read next raw JSON value from stdout
        let raw = match process.read_message().await {
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
        };

        // Check if this is a permission request (canUseTool protocol)
        if is_permission_request(&raw) {
            let request = parse_permission_request(&raw);
            debug!(tool = %request.tool_name, "received permission request");

            if let Some(ref can_use_tool) = can_use_tool {
                // Update turn state — we're now waiting for user
                *turn_state.lock().await = TurnState::WaitingForPermission {
                    tool_name: request.tool_name.clone(),
                    tool_use_id: request.tool_use_id.clone(),
                };

                // BLOCK here until the CanUseTool callback resolves.
                // This is the mechanism for AskUserQuestion, ExitPlanMode, etc.
                let result = can_use_tool.can_use_tool(request).await;

                // Write permission response back to CLI stdin
                let response_json = match serde_json::to_value(&result) {
                    Ok(v) => v,
                    Err(e) => {
                        error!("failed to serialize permission response: {e}");
                        let _ = tx.send(Err(SdkError::SerializationError(e))).await;
                        break;
                    }
                };

                let write_result = {
                    let mut guard = process_stdin.lock().await;
                    if let Some(stdin) = guard.as_mut() {
                        let json =
                            serde_json::to_string(&response_json).expect("already serialized");
                        let r1 = stdin.write_all(json.as_bytes()).await;
                        let r2 = stdin.write_all(b"\n").await;
                        let r3 = stdin.flush().await;
                        r1.and(r2).and(r3).map_err(SdkError::IoError)
                    } else {
                        Err(SdkError::InputClosed)
                    }
                };

                if let Err(e) = write_result {
                    let _ = tx.send(Err(e)).await;
                    break;
                }

                // Back to agent working
                *turn_state.lock().await = TurnState::AgentWorking;
            } else {
                // No handler — auto-allow
                warn!("no canUseTool handler, auto-allowing tool use");
                let auto_allow = serde_json::json!({ "behavior": "allow" });
                let write_result = {
                    let mut guard = process_stdin.lock().await;
                    if let Some(stdin) = guard.as_mut() {
                        let json = serde_json::to_string(&auto_allow).expect("static json");
                        let r1 = stdin.write_all(json.as_bytes()).await;
                        let r2 = stdin.write_all(b"\n").await;
                        let r3 = stdin.flush().await;
                        r1.and(r2).and(r3).map_err(SdkError::IoError)
                    } else {
                        Err(SdkError::InputClosed)
                    }
                };

                if let Err(e) = write_result {
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
/// let mut q = query("Hello Claude", options).await?;
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
pub async fn query(prompt: impl Into<String>, mut options: Options) -> Result<Query, SdkError> {
    let cli_path = find_cli(options.path_to_cli.as_deref())?;
    let mut process = CliProcess::spawn(&cli_path, &options).await?;

    // Capture PID before we move anything
    let pid = process.pid();

    // Take stdin out of the process — Query and the reader loop share it
    // via Arc<Mutex<..>> so the reader loop can write permission responses
    // and Query can write user messages / control commands.
    let stdin = process.take_stdin();
    let process_stdin = Arc::new(Mutex::new(stdin));

    // Write initial prompt to stdin
    let prompt_msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": prompt.into() },
        "parent_tool_use_id": null,
        "session_id": ""
    });
    {
        let mut guard = process_stdin.lock().await;
        if let Some(ref mut stdin) = *guard {
            let json =
                serde_json::to_string(&prompt_msg).map_err(SdkError::SerializationError)?;
            stdin
                .write_all(json.as_bytes())
                .await
                .map_err(SdkError::IoError)?;
            stdin
                .write_all(b"\n")
                .await
                .map_err(SdkError::IoError)?;
            stdin.flush().await.map_err(SdkError::IoError)?;
        } else {
            return Err(SdkError::InputClosed);
        }
    }

    // Extract runtime-only fields from options
    let can_use_tool = options.can_use_tool.take();
    let cancel_token = options.abort_signal.take();

    // Set up channel and shared state
    let (tx, rx) = mpsc::channel(256);
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
    ));

    Ok(Query {
        message_rx: rx,
        process_stdin,
        session_id,
        turn_state,
        reader_task: Some(reader_task),
        child_pid: Arc::new(Mutex::new(pid)),
        _cancel_token: cancel_token,
    })
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
    fn is_permission_request_works() {
        let pr = serde_json::json!({
            "type": "permission_request",
            "tool_name": "Write",
            "tool_use_id": "abc123",
            "input": { "path": "/tmp/foo" }
        });
        assert!(is_permission_request(&pr));

        let not_pr = serde_json::json!({ "type": "stream_event" });
        assert!(!is_permission_request(&not_pr));
    }

    #[test]
    fn parse_permission_request_extracts_fields() {
        let pr = serde_json::json!({
            "type": "permission_request",
            "tool_name": "Edit",
            "tool_use_id": "tu_123",
            "input": { "file": "main.rs" },
            "agent_id": "agent_1",
            "blocked_path": "/src/main.rs",
            "decision_reason": "file write"
        });
        let req = parse_permission_request(&pr);
        assert_eq!(req.tool_name, "Edit");
        assert_eq!(req.tool_use_id, "tu_123");
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

        let mut q = query("test", options).await.unwrap();

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
    async fn query_handles_permission_request() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: emit a permission request, read the response, then emit result
        let script = r#"#!/bin/sh
read -r INPUT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_456","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"permission_request","tool_name":"Write","tool_use_id":"tu_1","input":{"path":"/tmp/test.txt"}}'
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

        let mut q = query("test", options).await.unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // Permission request should NOT appear in messages (handled internally)
        // Should get: System(Init), Result
        assert!(messages.len() >= 2, "got {} messages", messages.len());
        assert!(messages
            .iter()
            .all(|m| !matches!(m, SdkMessage::Unknown(v) if is_permission_request(v))));
    }
}
