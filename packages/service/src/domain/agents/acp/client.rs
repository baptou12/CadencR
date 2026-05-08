use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::{broadcast, oneshot};

use crate::domain::agents::acp::client_spawn::{spawn_acp_subprocess, spawn_acp_with_streams};
use crate::domain::agents::acp::client_state::{Inner, PendingRequestGuard};
use crate::domain::agents::acp::error::AcpError;
use crate::domain::agents::acp::types::{AcpClientInfo, AcpEvent};

/// Generic ACP stdio JSON-RPC client.
///
/// Provider-neutral: it knows nothing about OpenCode (or any other ACP
/// provider). Spawn a `tokio::process::Command` of your choice through
/// `spawn`, then `request` / `notify` / `subscribe`.
///
/// All clones share state via `Arc<Inner>`. Dropping the last clone kills the
/// child via the kill switch in `Inner`'s `Drop` impl.
#[derive(Clone)]
pub struct AcpClient {
    inner: Arc<Inner>,
}

/// Options for `AcpClient::spawn`.
#[derive(Debug)]
pub struct AcpSpawnOptions {
    /// The command to spawn. Stdio piping and `kill_on_drop(true)` are
    /// applied by `spawn` so callers don't have to remember.
    pub command: Command,
    pub client_info: AcpClientInfo,
    /// Timeout applied to every `request`/`request_with_timeout` unless
    /// overridden per-call. Defaults to 60s.
    pub request_timeout: Option<Duration>,
    /// Maximum size of one stdout/stderr frame. Lines longer than this kill
    /// the reader (with a logged error) to prevent OOM. Defaults to 8 MiB.
    pub max_line_bytes: Option<usize>,
}

impl AcpSpawnOptions {
    /// Convenience constructor: takes a pre-built `Command` and uses
    /// defaults for everything else.
    #[allow(dead_code)] // Public API for future ACP adapters; today's
                        // OpenCode adapter inlines the struct literal.
    pub fn new(command: Command) -> Self {
        Self {
            command,
            client_info: AcpClientInfo::default(),
            request_timeout: None,
            max_line_bytes: None,
        }
    }
}

impl AcpClient {
    pub async fn spawn(options: AcpSpawnOptions) -> Result<Self, AcpError> {
        spawn_acp_subprocess(options).await
    }

    /// Test-only: build a client around in-memory streams instead of a real
    /// subprocess. Lets unit tests drive the protocol without forking.
    /// Available outside `cfg(test)` because integration tests in adapter
    /// modules also need it.
    #[doc(hidden)]
    #[allow(dead_code)] // Used by `#[cfg(test)]` paths in adapter modules.
    pub fn spawn_with_streams<R, E>(
        stdin: Box<dyn AsyncWrite + Send + Unpin>,
        stdout: R,
        stderr: E,
        client_info: AcpClientInfo,
    ) -> Self
    where
        R: AsyncRead + Send + Unpin + 'static,
        E: AsyncRead + Send + Unpin + 'static,
    {
        spawn_acp_with_streams(stdin, stdout, stderr, client_info)
    }

    /// Internal constructor used by the spawn module. Not part of the
    /// public surface.
    pub(super) fn from_inner(inner: Arc<Inner>) -> Self {
        Self { inner }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AcpEvent> {
        self.inner.events.subscribe()
    }

    pub fn client_info(&self) -> &AcpClientInfo {
        &self.inner.client_info
    }

    pub fn pid(&self) -> Option<u32> {
        self.inner.pid
    }

    /// Send a JSON-RPC request and await the response under the default
    /// timeout. Returns `Ok(result)` on success, or surfaces protocol /
    /// timeout / process-exit failures as `AcpError`.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, AcpError> {
        self.request_with_timeout(method, params, self.inner.request_timeout)
            .await
    }

    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AcpError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .map_err(|_| AcpError::Protocol("pending request lock poisoned".to_string()))?
            .insert(id, tx);
        let _guard = PendingRequestGuard {
            pending: Arc::clone(&self.inner.pending),
            id,
        };
        self.write_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .await?;
        // Tag the timeout label with the method name so adapters can render
        // "session/prompt timed out" instead of "request timed out".
        let label: &'static str = static_method_label(method);
        tokio::time::timeout(timeout, rx)
            .await
            .map_err(|_| AcpError::Timeout(label))?
            .map_err(|_| AcpError::ResponseClosed)?
    }

    /// Send a JSON-RPC notification (no `id`, no response expected).
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), AcpError> {
        self.write_json(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .await
    }

    /// Reply to a server-initiated request (one we received via
    /// `AcpEvent::ServerRequest`). The id is echoed back verbatim.
    pub async fn respond_server_request(&self, id: Value, result: Value) -> Result<(), AcpError> {
        self.write_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
        .await
    }

    /// Reject a server-initiated request with a JSON-RPC error.
    pub async fn reject_server_request(
        &self,
        id: Value,
        code: i64,
        message: &str,
    ) -> Result<(), AcpError> {
        self.write_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }))
        .await
    }

    /// Best-effort graceful shutdown: signal the reaper, then wait briefly
    /// for the reader / stderr / reaper tasks to finish. Pending requests
    /// will have already been drained by the reader on EOF or by the reaper
    /// on process exit.
    pub async fn shutdown(&self) {
        if let Ok(mut kill_tx) = self.inner.kill_tx.lock() {
            if let Some(tx) = kill_tx.take() {
                let _ = tx.send(());
            }
        }
        for slot in [
            &self.inner.reaper_task,
            &self.inner.reader_task,
            &self.inner.stderr_task,
        ] {
            let task = slot.lock().ok().and_then(|mut t| t.take());
            if let Some(task) = task {
                let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
            }
        }
    }

    async fn write_json(&self, message: Value) -> Result<(), AcpError> {
        let mut raw = serde_json::to_vec(&message)?;
        // TEMP-ACP-WIRE-LOG: full outbound JSON-RPC frame. Remove this
        // tracing call once ACP debugging is done — grep `TEMP-ACP-WIRE-LOG`.
        tracing::info!(
            acp_wire = "send",
            frame = %String::from_utf8_lossy(&raw),
            "ACP send"
        );
        raw.push(b'\n');
        let mut stdin = self.inner.stdin.lock().await;
        stdin.write_all(&raw).await?;
        stdin.flush().await?;
        Ok(())
    }
}

/// Map a method name to a `&'static str` label suitable for
/// `AcpError::Timeout`. Falls back to `"request"` for unknown methods.
/// This keeps the error type cheap (no String allocation per timeout).
fn static_method_label(method: &str) -> &'static str {
    match method {
        "initialize" => "initialize",
        "authenticate" => "authenticate",
        "session/new" => "session/new",
        "session/load" => "session/load",
        "session/prompt" => "session/prompt",
        "session/cancel" => "session/cancel",
        "session/set_mode" => "session/set_mode",
        "fs/read_text_file" => "fs/read_text_file",
        "fs/write_text_file" => "fs/write_text_file",
        _ => "request",
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader};

    use super::{AcpClient, AcpClientInfo};
    use crate::domain::agents::acp::error::AcpError;
    use crate::domain::agents::acp::types::AcpEvent;

    /// Build a client wired to in-memory duplex streams.
    ///
    /// Returns `(client, agent_stdout_writer, agent_stdin_reader)`:
    /// - write to `agent_stdout_writer` to feed bytes the client will read
    ///   from its stdout (i.e. simulate the agent talking to us).
    /// - read from `agent_stdin_reader` to inspect bytes the client wrote
    ///   to its stdin (i.e. observe what we send to the agent).
    fn build_in_memory_client() -> (
        AcpClient,
        tokio::io::DuplexStream,
        BufReader<tokio::io::DuplexStream>,
    ) {
        let (client_reads_stdout, agent_writes_stdout) = duplex(64 * 1024);
        let (agent_reads_stdin, client_writes_stdin) = duplex(64 * 1024);
        let client = AcpClient::spawn_with_streams(
            Box::new(client_writes_stdin),
            client_reads_stdout,
            tokio::io::empty(),
            AcpClientInfo::default(),
        );
        (
            client,
            agent_writes_stdout,
            BufReader::new(agent_reads_stdin),
        )
    }

    #[tokio::test]
    async fn request_round_trips_response() {
        let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
        let req = tokio::spawn({
            let client = client.clone();
            async move { client.request("ping", json!({})).await }
        });
        let mut line = String::new();
        agent_stdin.read_line(&mut line).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        let id = parsed["id"].as_u64().unwrap();
        assert_eq!(parsed["method"], "ping");
        let reply = format!("{}\n", json!({ "id": id, "result": { "pong": true } }));
        agent_stdout.write_all(reply.as_bytes()).await.unwrap();
        let result = req.await.unwrap().unwrap();
        assert_eq!(result, json!({ "pong": true }));
    }

    #[tokio::test]
    async fn request_surfaces_rpc_errors() {
        let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
        let req = tokio::spawn({
            let client = client.clone();
            async move { client.request("oops", json!({})).await }
        });
        let mut line = String::new();
        agent_stdin.read_line(&mut line).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        let id = parsed["id"].as_u64().unwrap();
        let reply = format!(
            "{}\n",
            json!({ "id": id, "error": { "code": -32601, "message": "method not found" } })
        );
        agent_stdout.write_all(reply.as_bytes()).await.unwrap();
        let err = req.await.unwrap().expect_err("should be Rpc error");
        assert!(matches!(err, AcpError::Rpc { code: -32601, .. }));
    }

    #[tokio::test]
    async fn request_times_out_when_no_response() {
        let (client, _agent_stdout, _agent_stdin) = build_in_memory_client();
        let err = client
            .request_with_timeout("session/prompt", json!({}), Duration::from_millis(50))
            .await
            .expect_err("should time out");
        assert!(matches!(err, AcpError::Timeout("session/prompt")));
    }

    #[tokio::test]
    async fn notify_writes_a_frame_with_no_id() {
        let (client, _agent_stdout, mut agent_stdin) = build_in_memory_client();
        client
            .notify("session/cancel", json!({"sessionId": "s1"}))
            .await
            .unwrap();
        let mut line = String::new();
        agent_stdin.read_line(&mut line).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert!(parsed.get("id").is_none());
        assert_eq!(parsed["method"], "session/cancel");
    }

    #[tokio::test]
    async fn server_request_is_broadcast_to_subscribers() {
        let (client, mut agent_stdout, _agent_stdin) = build_in_memory_client();
        let mut subscriber = client.subscribe();
        let frame = format!(
            "{}\n",
            json!({
                "id": "perm-7",
                "method": "session/request_permission",
                "params": { "ok": true }
            })
        );
        agent_stdout.write_all(frame.as_bytes()).await.unwrap();
        let evt = tokio::time::timeout(Duration::from_secs(1), subscriber.recv())
            .await
            .unwrap()
            .unwrap();
        let AcpEvent::ServerRequest { id, method, .. } = evt else {
            panic!("expected server request");
        };
        assert_eq!(id, json!("perm-7"));
        assert_eq!(method, "session/request_permission");
    }

    #[tokio::test]
    async fn responding_server_request_writes_back_with_same_id() {
        let (client, _agent_stdout, mut agent_stdin) = build_in_memory_client();
        client
            .respond_server_request(
                json!("perm-7"),
                json!({ "outcome": "selected", "optionId": "ok" }),
            )
            .await
            .unwrap();
        let mut line = String::new();
        agent_stdin.read_line(&mut line).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["id"], "perm-7");
        assert_eq!(parsed["result"]["outcome"], "selected");
    }
}
