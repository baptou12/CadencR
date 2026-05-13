use std::collections::HashMap;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use futures::Stream;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use crate::error::SdkError;
use crate::mcp::McpServerConfig;
use crate::messages::SdkMessage;
use crate::options::Options;
use crate::permissions::{CanUseTool, PermissionMode, PermissionRequest};
use crate::transport::{find_cli, CliProcess};

// ── TurnState ────────────────────────────────────────────────────────────────

/// Represents whose "turn" it is in the agent conversation.
///
/// This is critical for Cadencr's UI to know what to show:
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

/// Convert a raw CLI `control_response` into a `ControlOutcome`.
///
/// Wire shape (mirrors the official Claude Agent SDKs):
///
/// ```json
/// // success
/// { "type": "control_response",
///   "response": { "subtype": "success", "request_id": "...", "response": { … } } }
///
/// // error
/// { "type": "control_response",
///   "response": { "subtype": "error", "request_id": "...", "error": "<message>" } }
/// ```
///
/// `outbound_subtype` is the subtype we sent on the corresponding
/// `control_request`. It's stamped onto `ControlRequestFailed` so callers
/// can branch on which command was rejected — the CLI's response only
/// tells us success/error, not which command produced it.
fn parse_control_response(raw: &serde_json::Value, outbound_subtype: &str) -> ControlOutcome {
    let subtype = raw
        .pointer("/response/subtype")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match subtype {
        "success" => Ok(raw
            .pointer("/response/response")
            .cloned()
            .unwrap_or(serde_json::Value::Null)),
        "error" => {
            let message = raw
                .pointer("/response/error")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "CLI returned control_response error without message".into());
            Err(SdkError::ControlRequestFailed {
                subtype: outbound_subtype.to_string(),
                message,
            })
        }
        other => Err(SdkError::ControlRequestFailed {
            subtype: outbound_subtype.to_string(),
            message: format!("unknown control_response subtype `{other}`"),
        }),
    }
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

    /// In-flight `control_request`s awaiting a matching `control_response`.
    /// Keyed by `request_id`. The reader loop owns the receive side of each
    /// oneshot and resolves it when a `control_response` with the same id
    /// arrives. Shared with the reader loop via `Arc`.
    pending_control: PendingControl,

    /// Monotonic counter used to mint unique `request_id`s for outbound
    /// control requests. Mirrors the Python SDK's `f"req_{ctr}_{rand}"`
    /// pattern; the random suffix is added at call site.
    control_request_counter: Arc<AtomicU64>,

    /// Background reader task handle (for cleanup).
    reader_task: Option<tokio::task::JoinHandle<()>>,

    /// Channel to signal the reader task to send SIGINT to the CLI process.
    interrupt_tx: mpsc::Sender<()>,

    /// Channel to signal the reader task to gracefully kill the CLI process.
    kill_tx: mpsc::Sender<()>,

    /// Cancellation token.
    _cancel_token: Option<CancellationToken>,

    /// PID of the CLI subprocess (captured at spawn time).
    pid: Option<u32>,
}

/// Outcome of a `control_request` round-trip carried through a oneshot.
/// `Ok(value)` is the inner `response` payload from the CLI's
/// `control_response` (with `subtype: "success"`); `Err` carries either a
/// CLI-reported `subtype: "error"` or a transport failure.
type ControlOutcome = Result<serde_json::Value, SdkError>;

/// In-flight `control_request` waiting on a `control_response`. Carries
/// the outbound subtype so the reader loop can stamp it onto
/// `SdkError::ControlRequestFailed` — the CLI's response only signals
/// success/error, not which command it answered.
struct PendingControlEntry {
    subtype: String,
    sender: oneshot::Sender<ControlOutcome>,
}

/// Map of in-flight `control_request` ids to their pending entry. Cleared
/// entries indicate either resolution by the reader loop (success/error)
/// or sender drop on timeout.
type PendingControl = Arc<Mutex<HashMap<String, PendingControlEntry>>>;

/// Default round-trip timeout for `control_request`s. Matches the
/// official Python SDK's 60 s default — the CLI usually replies in
/// milliseconds, but the protocol allows the CLI to defer the response
/// while it finishes prior work, so a generous ceiling avoids false
/// timeouts under load (a hot turn streaming many tool calls can keep
/// the CLI's read loop briefly busy). If we don't hear back in this
/// window it almost certainly means the envelope shape was wrong (CLI
/// silently drops unknown shapes) or the subprocess is wedged.
const CONTROL_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

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

    /// Get the PID of the CLI subprocess (captured at spawn time).
    /// Returns `None` for test stubs or if the process had no PID.
    pub fn pid(&self) -> Option<u32> {
        self.pid
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
            let _ = tokio::time::timeout(std::time::Duration::from_secs(10), task).await;
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
        let session_id = self.session_id.lock().await.clone().unwrap_or_default();

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
            pending_control: Arc::new(Mutex::new(HashMap::new())),
            control_request_counter: Arc::new(AtomicU64::new(0)),
            reader_task: None,
            interrupt_tx,
            kill_tx,
            _cancel_token: None,
            pid: None,
        }
    }

    /// Close stdin (no more user input). The CLI will finish its current
    /// turn and exit.
    pub async fn close_input(&self) -> Result<(), SdkError> {
        self.process_stdin.lock().await.take();
        Ok(())
    }

    /// Change the active model. The CLI applies the new model on the next
    /// user turn (the in-flight turn keeps the model it started with);
    /// awaits the matching `control_response` so the caller learns whether
    /// the CLI accepted the change.
    pub async fn set_model(&self, model: &str) -> Result<(), SdkError> {
        self.send_control_request(serde_json::json!({
            "subtype": "set_model",
            "model": model,
        }))
        .await
        .map(|_| ())
    }

    /// Change the permission mode mid-session. Per the Claude Agent SDK
    /// docs, the new mode "takes effect immediately for all subsequent
    /// tool requests", so this is the right surface for both mid-turn
    /// chip switches and the post-`ExitPlanMode` build-mode swap.
    ///
    /// Awaits the CLI's `control_response`; surfaces
    /// `SdkError::ControlRequestFailed` if the CLI rejected the request,
    /// `SdkError::Timeout` if no response arrived within the round-trip
    /// window. Callers (e.g. the Cadencr WS handler) MUST gate any
    /// "applied" UI on `Ok(())` to avoid lying about CLI state.
    pub async fn set_permission_mode(&self, mode: PermissionMode) -> Result<(), SdkError> {
        self.send_control_request(serde_json::json!({
            "subtype": "set_permission_mode",
            "mode": mode.as_cli_flag(),
        }))
        .await
        .map(|_| ())
    }

    /// Hot-swap the MCP server set mid-session.
    pub async fn set_mcp_servers(
        &self,
        servers: HashMap<String, McpServerConfig>,
    ) -> Result<(), SdkError> {
        self.send_control_request(serde_json::json!({
            "subtype": "set_mcp_servers",
            "mcp_servers": servers,
        }))
        .await
        .map(|_| ())
    }

    /// Send a `control_request` to the CLI and await its matching
    /// `control_response`. Canonical envelope used by every Claude Agent
    /// SDK; the CLI silently drops anything else (this was the source of
    /// the prior fire-and-forget `set_permission_mode` bug). See
    /// <https://github.com/anthropics/claude-agent-sdk-python> for the
    /// reference implementation.
    ///
    /// `request` is the inner object and MUST include a `subtype` field;
    /// the `type` + `request_id` envelope is added here.
    async fn send_control_request(
        &self,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, SdkError> {
        let subtype = request
            .get("subtype")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let request_id = self.next_control_request_id(&subtype);

        let (tx, rx) = oneshot::channel::<ControlOutcome>();
        self.pending_control.lock().await.insert(
            request_id.clone(),
            PendingControlEntry {
                subtype,
                sender: tx,
            },
        );

        let envelope = serde_json::json!({
            "type": "control_request",
            "request_id": request_id,
            "request": request,
        });

        if let Err(e) = self.write_stdin_json(&envelope).await {
            // Drop the pending entry so memory doesn't leak; the oneshot
            // sender goes out of scope and the receiver will see a closed
            // channel if anyone else looks at it.
            self.pending_control.lock().await.remove(&request_id);
            return Err(e);
        }

        match tokio::time::timeout(CONTROL_REQUEST_TIMEOUT, rx).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_recv_err)) => {
                // Sender dropped without resolving — the reader loop must
                // have exited (process gone, channel closed, …).
                Err(SdkError::Cancelled)
            }
            Err(_elapsed) => {
                // Pull the entry so a late response doesn't try to resolve
                // a defunct sender.
                self.pending_control.lock().await.remove(&request_id);
                Err(SdkError::Timeout)
            }
        }
    }

    /// Mint a fresh `request_id` for an outbound control request.
    /// Pattern mirrors the official Python SDK: `req_{counter}_{rand}`.
    fn next_control_request_id(&self, subtype: &str) -> String {
        let counter = self.control_request_counter.fetch_add(1, Ordering::Relaxed);
        // Cheap per-process randomness — nanoseconds of system time fit
        // in 32 bits often enough; we just need uniqueness across
        // concurrent sends within a single Query.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos();
        format!("req_{counter}_{subtype}_{nanos:08x}")
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
    stdin.write_all(b"\n").await.map_err(SdkError::IoError)?;
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
    can_use_tool: Option<Arc<dyn CanUseTool>>,
    session_id: Arc<Mutex<Option<String>>>,
    turn_state: Arc<Mutex<TurnState>>,
    pending_control: PendingControl,
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
                        info!("CLI process exited (code={code:?})");
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
                warn!("cancel token fired, killing CLI process");
                if let Err(e) = process.kill().await {
                    warn!("failed to kill CLI process on cancel: {e}");
                }
                let _ = tx.send(Err(SdkError::Cancelled)).await;
                break;
            }
        };

        // Route `control_response` messages to whoever is awaiting them.
        //
        // The CLI replies to every `control_request` we send with a
        // `control_response` carrying the same `request_id`. We resolve
        // the matching oneshot in `pending_control` (registered by
        // `Query::send_control_request`) so the caller learns the CLI's
        // verdict — `subtype: "success"` → `Ok(inner_response)`,
        // `subtype: "error"` → `Err(SdkError::ControlRequestFailed)`.
        //
        // Replies with no matching pending entry are intentionally
        // dropped: the CLI sometimes echoes responses to its own
        // `initialize` round-trip (or the SDK's startup `initialize`
        // never registers a pending entry). These are not SDK messages
        // and must not be forwarded to the caller.
        if raw.get("type").and_then(|t| t.as_str()) == Some("control_response") {
            let Some(request_id) = raw.pointer("/response/request_id").and_then(|v| v.as_str())
            else {
                debug!("received control_response without request_id, skipping");
                continue;
            };
            match pending_control.lock().await.remove(request_id) {
                Some(entry) => {
                    let outcome = parse_control_response(&raw, &entry.subtype);
                    // Receiver may have timed out and dropped — ignore.
                    let _ = entry.sender.send(outcome);
                }
                None => {
                    debug!(
                        request_id,
                        "received control_response with no pending sender, skipping"
                    );
                }
            }
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

        // Check if this is a permission request (canUseTool protocol).
        //
        // CRITICAL: Dispatch the callback on a *separate* task instead of
        // awaiting it inline. Awaiting inline would block this reader
        // loop, which means it could not deliver `control_response`
        // messages back to anyone waiting on `pending_control`. Callbacks
        // commonly issue control requests of their own — e.g. the Cadencr
        // post-`ExitPlanMode` flow calls `set_permission_mode` from
        // inside `can_use_tool` before returning `Allow`. With an inline
        // await, that nested `set_permission_mode` would deadlock waiting
        // for a response this same loop is supposed to deliver. Mirrors
        // the official Python SDK's `_spawn_control_request_handler`.
        if control_request_subtype(&raw) == Some("can_use_tool") {
            let request = parse_permission_request(&raw);
            debug!(tool = %request.tool_name, "received permission request");

            let request_id = request.tool_use_id.clone();
            let tool_name = request.tool_name.clone();

            // Update turn state — we're now waiting for user. Done before
            // the spawn so subsequent reads in this loop see the new
            // state without racing the spawned task.
            *turn_state.lock().await = TurnState::WaitingForPermission {
                tool_name: tool_name.clone(),
                tool_use_id: request_id.clone(),
            };

            let stdin_for_task = Arc::clone(&process_stdin);
            let turn_state_for_task = Arc::clone(&turn_state);
            let tx_for_task = tx.clone();
            let can_use_tool_for_task = can_use_tool.as_ref().map(Arc::clone);

            tokio::spawn(async move {
                let response_value: serde_json::Value = match can_use_tool_for_task {
                    Some(handler) => {
                        let result = handler.can_use_tool(request).await;
                        match serde_json::to_value(&result) {
                            Ok(v) => v,
                            Err(e) => {
                                error!("failed to serialize permission response: {e}");
                                let _ =
                                    tx_for_task.send(Err(SdkError::SerializationError(e))).await;
                                return;
                            }
                        }
                    }
                    None => {
                        warn!(
                            tool = %tool_name,
                            "no canUseTool handler, auto-allowing tool use"
                        );
                        serde_json::json!({ "behavior": "allow" })
                    }
                };

                let response_json = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": request_id,
                        "response": response_value,
                    }
                });

                if let Err(e) = write_to_stdin(&stdin_for_task, &response_json).await {
                    let _ = tx_for_task.send(Err(e)).await;
                    return;
                }

                // Back to agent working — only safe to flip back once we've
                // actually written the response, otherwise consumers might
                // race a "still working" state on a turn that's actually
                // waiting on us.
                *turn_state_for_task.lock().await = TurnState::AgentWorking;
            });

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
    let cli_path = find_cli(options.path_to_cli.as_deref()).await?;
    let mut process = CliProcess::spawn(&cli_path, &options).await?;

    // Capture PID before moving process into reader loop.
    let pid = process.pid();
    info!(pid = ?pid, cli = %cli_path.display(), "CLI process spawned");

    // Take stdin out of the process — Query and the reader loop share it
    // via Arc<Mutex<..>> so the reader loop can write permission responses
    // and Query can write user messages / control commands.
    let stdin = process.take_stdin();
    let process_stdin = Arc::new(Mutex::new(stdin));

    // Send the initialize control request so the CLI knows we support
    // the bidirectional control protocol (canUseTool, AskUserQuestion, etc.).
    let init_request_id = format!(
        "init_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
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
    let pending_control: PendingControl = Arc::new(Mutex::new(HashMap::new()));
    let control_request_counter = Arc::new(AtomicU64::new(0));

    // Spawn background reader
    let reader_task = tokio::spawn(reader_loop(
        process,
        Arc::clone(&process_stdin),
        tx,
        can_use_tool,
        Arc::clone(&session_id),
        Arc::clone(&turn_state),
        Arc::clone(&pending_control),
        cancel_token.clone(),
        interrupt_rx,
        kill_rx,
    ));

    Ok(Query {
        message_rx: rx,
        process_stdin,
        session_id,
        turn_state,
        pending_control,
        control_request_counter,
        reader_task: Some(reader_task),
        interrupt_tx,
        kill_tx,
        _cancel_token: cancel_token,
        pid,
    })
}

// ── Supported commands ───────────────────────────────────────────────────────

/// Fetch slash commands via the `initialize` control-request — a pure local
/// metadata handshake (no prompt, no tokens). Returns [`SdkError::Timeout`]
/// if the CLI doesn't reply within 10 seconds. `argumentHint` is dropped:
/// [`SlashCommand`](crate::types::SlashCommand) doesn't carry it yet.
pub async fn supported_commands(
    cwd: &str,
    path_to_cli: Option<&std::path::Path>,
) -> Result<Vec<crate::types::SlashCommand>, SdkError> {
    use crate::transport::{find_cli, CliProcess};

    let cli_path = find_cli(path_to_cli).await?;

    let options = Options {
        cwd: std::path::PathBuf::from(cwd),
        ..Options::default()
    };

    let mut process = CliProcess::spawn(&cli_path, &options).await?;

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

    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match process.read_message().await? {
                Some(raw) => {
                    if raw.get("type").and_then(|t| t.as_str()) == Some("control_response") {
                        let req_id = raw.pointer("/response/request_id").and_then(|v| v.as_str());
                        if req_id == Some(init_request_id.as_str()) {
                            let commands = raw
                                .pointer("/response/response/commands")
                                .cloned()
                                .unwrap_or(serde_json::Value::Array(Vec::new()));
                            return Ok::<Vec<crate::types::SlashCommand>, SdkError>(
                                parse_supported_commands(&commands),
                            );
                        }
                        continue;
                    }
                    // CLI sometimes sends its own `initialize`; ack it so the
                    // CLI keeps going while we await our own response.
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
                }
                None => {
                    let (code, stderr) = process.wait_with_stderr().await;
                    return Err(SdkError::ProcessExit { code, stderr });
                }
            }
        }
    })
    .await;

    let _ = process.kill().await;

    match result {
        Ok(commands) => commands,
        Err(_elapsed) => Err(SdkError::Timeout),
    }
}

/// Decode the `commands` array from the `initialize` control-response.
/// Non-array shapes yield an empty Vec so callers can apply their own
/// fallback (e.g. [`crate::commands::list_builtin_commands`]).
fn parse_supported_commands(commands: &serde_json::Value) -> Vec<crate::types::SlashCommand> {
    let Some(entries) = commands.as_array() else {
        tracing::warn!(
            "initialize control_response `commands` was not an array; treating as empty"
        );
        return Vec::new();
    };
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let Some(name) = entry.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let description = entry
            .get("description")
            .and_then(|v| v.as_str())
            .filter(|d| !d.is_empty())
            .map(ToOwned::to_owned);
        out.push(crate::types::SlashCommand {
            name: name.to_string(),
            description,
        });
    }
    out
}

// ── Supported models ─────────────────────────────────────────────────────────

/// Fetch the list of models the CLI currently exposes.
///
/// Sends the `initialize` control-request over the CLI's stdin/stdout control
/// protocol and reads the matching `control_response` to extract `models`.
/// This is a pure local metadata handshake — no prompt is submitted, no tokens
/// are billed, and no network round-trip is required to fill the `models` field.
///
/// The CLI process is killed before returning.
///
/// # Timeout
///
/// If the CLI doesn't reply within 10 seconds, returns [`SdkError::Timeout`].
pub async fn supported_models(
    cwd: &str,
    path_to_cli: Option<&std::path::Path>,
) -> Result<Vec<crate::types::ModelInfo>, SdkError> {
    use crate::transport::{find_cli, CliProcess};

    let cli_path = find_cli(path_to_cli).await?;

    let options = Options {
        cwd: std::path::PathBuf::from(cwd),
        ..Options::default()
    };

    let mut process = CliProcess::spawn(&cli_path, &options).await?;

    let stdin = process.take_stdin();
    let process_stdin = tokio::sync::Mutex::new(stdin);

    let init_request_id = format!(
        "init_models_{}",
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

    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match process.read_message().await? {
                Some(raw) => {
                    // Match the control_response to our initialize request.
                    if raw.get("type").and_then(|t| t.as_str()) == Some("control_response") {
                        let req_id = raw.pointer("/response/request_id").and_then(|v| v.as_str());
                        if req_id == Some(init_request_id.as_str()) {
                            let models = raw
                                .pointer("/response/response/models")
                                .cloned()
                                .unwrap_or(serde_json::Value::Array(Vec::new()));
                            let parsed: Vec<crate::types::ModelInfo> =
                                serde_json::from_value(models)
                                    .map_err(SdkError::SerializationError)?;
                            return Ok::<Vec<crate::types::ModelInfo>, SdkError>(parsed);
                        }
                        continue;
                    }
                    // The CLI may send its own `initialize` control_request; reply
                    // so it keeps going, then keep waiting for our response.
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
                    // Ignore any other messages (e.g. system.init emitted early).
                }
                None => {
                    let (code, stderr) = process.wait_with_stderr().await;
                    return Err(SdkError::ProcessExit { code, stderr });
                }
            }
        }
    })
    .await;

    let _ = process.kill().await;

    match result {
        Ok(models) => models,
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

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

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

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

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

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

        // Take the receiver out
        let mut rx = q.take_message_rx();

        // After take, Stream impl should return None
        let stream_result = q.next().await;
        assert!(
            stream_result.is_none(),
            "stream should return None after take_message_rx"
        );

        // The taken receiver should still get messages
        let mut messages = Vec::new();
        while let Some(msg) = rx.recv().await {
            messages.push(msg.unwrap());
        }

        assert!(
            messages.len() >= 2,
            "receiver should get messages, got {}",
            messages.len()
        );
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
            can_use_tool: Some(Arc::new(crate::permissions::AllowAllTools)),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

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

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // control_response should be filtered out — only System(Init) + Result
        assert_eq!(
            messages.len(),
            2,
            "expected 2 messages, got {}",
            messages.len()
        );
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

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // The CLI's initialize request should be handled (responded to) and not
        // forwarded as a message. We should only see System(Init) + Result.
        assert_eq!(
            messages.len(),
            2,
            "expected 2 messages, got {}",
            messages.len()
        );

        let sid = q.session_id().await;
        assert_eq!(sid, Some("sess_clinit".to_string()));
    }

    #[tokio::test]
    async fn supported_models_extracts_models_from_control_response() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: read the initialize control_request, echo back a control_response
        // whose inner response.models array matches the real CLI wire format.
        let script = r#"#!/bin/sh
read -r INIT_REQ
REQ_ID=$(printf '%s' "$INIT_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{"commands":[],"agents":[],"output_style":"default","available_output_styles":["default"],"models":[{"value":"default","displayName":"Default (recommended)","description":"Opus 4.7 with 1M context","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"],"supportsAdaptiveThinking":true,"supportsAutoMode":true},{"value":"sonnet","displayName":"Sonnet","description":"Sonnet 4.6"},{"value":"haiku","displayName":"Haiku","description":"Haiku 4.5"}],"account":{}}}}\n' "$REQ_ID"
sleep 60
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let models = supported_models("/tmp", Some(script_path.as_path()))
            .await
            .expect("should return models");

        assert_eq!(models.len(), 3);
        assert_eq!(models[0].value, "default");
        assert_eq!(models[0].display_name, "Default (recommended)");
        assert_eq!(
            models[0].description.as_deref(),
            Some("Opus 4.7 with 1M context")
        );
        assert_eq!(models[0].supports_effort, Some(true));
        assert_eq!(models[0].supports_auto_mode, Some(true));
        assert_eq!(models[2].value, "haiku");
    }

    // ── parse_control_response ────────────────────────────────────────────

    #[test]
    fn parse_control_response_success_returns_inner_response() {
        let raw = serde_json::json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": "req_0_set_permission_mode_deadbeef",
                "response": { "ok": true }
            }
        });
        let outcome = parse_control_response(&raw, "set_permission_mode").expect("success");
        assert_eq!(outcome, serde_json::json!({ "ok": true }));
    }

    #[test]
    fn parse_control_response_success_with_no_inner_response_returns_null() {
        let raw = serde_json::json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": "req_0" }
        });
        let outcome = parse_control_response(&raw, "set_model").expect("success");
        assert_eq!(outcome, serde_json::Value::Null);
    }

    #[test]
    fn parse_control_response_error_carries_outbound_subtype() {
        let raw = serde_json::json!({
            "type": "control_response",
            "response": {
                "subtype": "error",
                "request_id": "req_0",
                "error": "permission mode `nope` not recognized"
            }
        });
        let err = parse_control_response(&raw, "set_permission_mode").expect_err("must be err");
        match err {
            SdkError::ControlRequestFailed { subtype, message } => {
                assert_eq!(
                    subtype, "set_permission_mode",
                    "subtype must be the outbound command, not the response slot"
                );
                assert!(
                    message.contains("nope"),
                    "expected message to surface CLI error, got: {message}"
                );
            }
            other => panic!("expected ControlRequestFailed, got {other:?}"),
        }
    }

    #[test]
    fn parse_control_response_unknown_subtype_returns_error() {
        let raw = serde_json::json!({
            "type": "control_response",
            "response": { "subtype": "weird", "request_id": "req_0" }
        });
        let err = parse_control_response(&raw, "set_model").expect_err("must be err");
        match err {
            SdkError::ControlRequestFailed { subtype, message } => {
                assert_eq!(subtype, "set_model");
                assert!(
                    message.contains("weird"),
                    "message should mention the unknown response subtype, got: {message}"
                );
            }
            other => panic!("expected ControlRequestFailed, got {other:?}"),
        }
    }

    // ── set_permission_mode (and friends) round-trip ──────────────────────

    /// Drive a real `Query` against a mock CLI shell script and confirm:
    ///   1. `set_permission_mode` writes the documented `control_request`
    ///      envelope (`type`, `request_id`, `request.subtype`,
    ///      `request.mode`) — captured via tee on the mock CLI.
    ///   2. The returned `Ok(())` is gated on a matching
    ///      `control_response` with `subtype: "success"`.
    #[tokio::test]
    async fn set_permission_mode_round_trip_writes_documented_envelope() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");
        let captured_path = dir.path().join("captured.json");

        // Mock CLI:
        //   1. consume our `initialize` request, ack it.
        //   2. consume the user prompt line.
        //   3. emit a `system.init`.
        //   4. read the NEXT control_request (will be set_permission_mode);
        //      tee it to the captured file and reply success.
        //   5. block on read so the process stays alive until the test
        //      explicitly drops `Query` (which kills the child).
        let script = format!(
            r#"#!/bin/sh
set -e
CAPTURED='{}'
read -r INIT_REQ
INIT_ID=$(printf '%s' "$INIT_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{{"type":"control_response","response":{{"subtype":"success","request_id":"%s","response":{{}}}}}}\n' "$INIT_ID"
read -r USER_PROMPT
echo '{{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_mode","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"plan","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}}'
read -r MODE_REQ
printf '%s' "$MODE_REQ" > "$CAPTURED"
MODE_ID=$(printf '%s' "$MODE_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{{"type":"control_response","response":{{"subtype":"success","request_id":"%s","response":{{}}}}}}\n' "$MODE_ID"
read -r DUMMY
"#,
            captured_path.display()
        );

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

        // Drain the system.init so the reader loop is past it before we
        // call set_permission_mode (the call doesn't actually need this,
        // but it makes the test deterministic about the script's read order).
        let _init_msg = q.next().await.expect("init message");

        // The actual round-trip we're testing:
        q.set_permission_mode(PermissionMode::AcceptEdits)
            .await
            .expect("set_permission_mode must succeed");

        // Tear down so the script's final `read` returns and the captured
        // file is fully flushed.
        q.close().await;

        let captured_raw = std::fs::read_to_string(&captured_path).expect("captured envelope");
        let captured: serde_json::Value =
            serde_json::from_str(captured_raw.trim()).expect("captured envelope is JSON");

        assert_eq!(captured["type"], "control_request");
        assert!(
            captured["request_id"].is_string(),
            "expected request_id, got {captured:?}"
        );
        assert_eq!(captured["request"]["subtype"], "set_permission_mode");
        assert_eq!(captured["request"]["mode"], "acceptEdits");
    }

    /// CLI-reported error → `SdkError::ControlRequestFailed`. Gates the
    /// no-optimistic-updates guarantee — backend must NOT broadcast
    /// `mode.changed` if the CLI rejected the request.
    #[tokio::test]
    async fn set_permission_mode_returns_error_on_cli_error_response() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        let script = r#"#!/bin/sh
set -e
read -r INIT_REQ
INIT_ID=$(printf '%s' "$INIT_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{}}}\n' "$INIT_ID"
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_err","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"plan","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
read -r MODE_REQ
MODE_ID=$(printf '%s' "$MODE_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"error","request_id":"%s","error":"unsupported mode"}}\n' "$MODE_ID"
read -r DUMMY
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();
        let _init_msg = q.next().await.expect("init message");

        let err = q
            .set_permission_mode(PermissionMode::AcceptEdits)
            .await
            .expect_err("CLI rejection must surface");
        match err {
            SdkError::ControlRequestFailed { subtype, message } => {
                assert_eq!(
                    subtype, "set_permission_mode",
                    "subtype must be the outbound command so callers can branch on it"
                );
                assert!(
                    message.contains("unsupported mode"),
                    "expected CLI's message to surface, got: {message}"
                );
            }
            other => panic!("expected ControlRequestFailed, got {other:?}"),
        }

        q.close().await;
    }

    /// Silent CLI (no `control_response`) → `SdkError::Timeout` after
    /// `CONTROL_REQUEST_TIMEOUT`. This is the exact failure the wire
    /// format bug used to *hide*: the SDK returned `Ok` while the CLI
    /// silently dropped the message. Now it surfaces as a real error.
    #[tokio::test(start_paused = true)]
    async fn set_permission_mode_times_out_when_no_response() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: ack init, emit system.init, then go silent.
        let script = r#"#!/bin/sh
set -e
read -r INIT_REQ
INIT_ID=$(printf '%s' "$INIT_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{}}}\n' "$INIT_ID"
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_to","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"plan","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
read -r DUMMY
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();
        let _init_msg = q.next().await.expect("init message");

        // Tokio's paused-time runtime auto-advances when all tasks are
        // sleeping, so the timeout fires without a real 5s wall wait.
        let err = q
            .set_permission_mode(PermissionMode::AcceptEdits)
            .await
            .expect_err("silent CLI must time out");
        assert!(
            matches!(err, SdkError::Timeout),
            "expected Timeout, got {err:?}"
        );

        q.close().await;
    }

    /// Regression test for the post-`ExitPlanMode` deadlock.
    ///
    /// Before the spawn-based callback dispatch, calling
    /// `set_permission_mode` from inside `can_use_tool` deadlocked: the
    /// reader loop was blocked awaiting the callback, so the
    /// `control_response` for the nested `set_permission_mode` could never
    /// be delivered, and `set_permission_mode` timed out. The Cadencr WS
    /// handler (`bridge.rs::transition_to_post_plan_mode`) issues exactly
    /// that nested call before returning `Allow` from `can_use_tool`.
    ///
    /// This test:
    ///   1. Starts a mock CLI that emits a `can_use_tool` request, then
    ///      acks the *next* `control_request` line it reads (which will
    ///      be `set_permission_mode` from inside the callback), then
    ///      consumes the eventual `can_use_tool` response.
    ///   2. Wires a `CanUseTool` impl that signals a `Notify` when
    ///      called and waits on a oneshot for the test to release it.
    ///   3. From the test main task, awaits the notify, calls
    ///      `query.set_permission_mode(...)` — if the deadlock is back,
    ///      this will time out (or fail to resolve before our local
    ///      timeout) — then releases the callback to return `Allow`.
    #[tokio::test]
    async fn set_permission_mode_from_inside_can_use_tool_does_not_deadlock() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::Arc;
        use tempfile::TempDir;
        use tokio::sync::{oneshot, Notify};

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI:
        //   - ack the SDK's `initialize`,
        //   - consume the user prompt,
        //   - emit `system.init`,
        //   - emit a `can_use_tool` control_request (mirrors `ExitPlanMode`),
        //   - read the NEXT control_request line (will be the nested
        //     `set_permission_mode`); ack it with success,
        //   - read the `can_use_tool` response,
        //   - emit a successful `result` and exit.
        let script = r#"#!/bin/sh
set -e
read -r INIT_REQ
INIT_ID=$(printf '%s' "$INIT_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{}}}\n' "$INIT_ID"
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_dl","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"plan","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"control_request","request_id":"req_exit_plan","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{"plan":"do stuff"}}}'
read -r NESTED_REQ
NESTED_ID=$(printf '%s' "$NESTED_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{}}}\n' "$NESTED_ID"
read -r ALLOW_RESPONSE
echo '{"type":"result","subtype":"success","uuid":"u2","session_id":"sess_dl","duration_ms":10,"duration_api_ms":5,"is_error":false,"num_turns":1,"result":"ok","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        // Synchronization between the test main task and the callback.
        let entered = Arc::new(Notify::new());
        let (release_tx, release_rx) = oneshot::channel::<()>();
        let release_rx = Arc::new(tokio::sync::Mutex::new(Some(release_rx)));

        struct GatedHandler {
            entered: Arc<Notify>,
            release_rx: Arc<tokio::sync::Mutex<Option<oneshot::Receiver<()>>>>,
        }

        #[async_trait::async_trait]
        impl crate::permissions::CanUseTool for GatedHandler {
            async fn can_use_tool(
                &self,
                request: crate::permissions::PermissionRequest,
            ) -> crate::permissions::PermissionResult {
                self.entered.notify_one();
                if let Some(rx) = self.release_rx.lock().await.take() {
                    let _ = rx.await;
                }
                crate::permissions::PermissionResult::Allow {
                    updated_input: request.input,
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id),
                }
            }
        }

        let handler: Arc<dyn crate::permissions::CanUseTool> = Arc::new(GatedHandler {
            entered: Arc::clone(&entered),
            release_rx,
        });

        let options = Options {
            path_to_cli: Some(script_path),
            can_use_tool: Some(handler),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

        // Wait until the callback is actually executing on its spawned task.
        // Cap the wait so a regression manifests as a test failure rather
        // than a hang.
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
            .await
            .expect("can_use_tool callback should be entered within 5s");

        // The very thing the bug used to deadlock on: issue a nested
        // control_request from the test task while the callback is
        // mid-flight. With the spawn-based dispatch, the reader loop is
        // free to deliver the response, so this resolves quickly.
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            q.set_permission_mode(PermissionMode::AcceptEdits),
        )
        .await
        .expect("nested set_permission_mode must not deadlock")
        .expect("set_permission_mode must succeed");

        // Let the callback return Allow so the mock CLI can finish.
        let _ = release_tx.send(());

        // Drain the rest of the stream and confirm we got the Result.
        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }
        assert!(
            messages
                .iter()
                .any(|m| matches!(m, SdkMessage::Result { .. })),
            "expected Result message, got {messages:?}"
        );
    }

    #[tokio::test]
    async fn supported_commands_extracts_slash_commands() {
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let script_path = dir.path().join("claude");

        // Mock CLI: echo a control_response matching the real CLI wire
        // format (verified by manual probe against `claude` 2.1.139).
        let script = r#"#!/bin/sh
read -r INIT_REQ
REQ_ID=$(printf '%s' "$INIT_REQ" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{"commands":[{"name":"compact","description":"Free up context","argumentHint":""},{"name":"review","description":"Review a PR","argumentHint":""},{"name":"goal","description":"Set a goal","argumentHint":""},{"name":"nodesc","argumentHint":""}],"models":[],"account":{}}}}\n' "$REQ_ID"
sleep 60
"#;

        std::fs::write(&script_path, script).unwrap();
        let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).unwrap();

        let commands = supported_commands("/tmp", Some(script_path.as_path()))
            .await
            .unwrap();

        assert_eq!(commands.len(), 4);
        assert_eq!(commands[0].name, "compact");
        assert_eq!(commands[0].description.as_deref(), Some("Free up context"));
        assert_eq!(commands[2].name, "goal");
        assert_eq!(commands[2].description.as_deref(), Some("Set a goal"));
        assert_eq!(commands[3].name, "nodesc");
        assert!(commands[3].description.is_none());
    }
}
