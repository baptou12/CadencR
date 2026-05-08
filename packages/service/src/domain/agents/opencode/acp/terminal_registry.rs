//! Per-session registry of live ACP terminals. Each entry owns the
//! spawned `Child`, a bounded stdout/stderr ring buffer, and the joined
//! command line we surface to the FE BashBlock.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const DEFAULT_OUTPUT_LIMIT: usize = 1024 * 1024; // 1 MiB

#[derive(Default)]
pub(super) struct TerminalRegistry {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    terminals: HashMap<String, TerminalEntry>,
}

struct TerminalEntry {
    child: Option<Child>,
    output: Arc<Mutex<TerminalOutput>>,
    pumps: Vec<JoinHandle<()>>,
    exit_status: Arc<Mutex<Option<ExitInfo>>>,
    /// Joined `command + args` captured at `terminal/create` time. ACP's
    /// later `tool_call` / `tool_call_update` only carries `terminalId`, so
    /// we need this stash to surface a command in the FE's BashBlock.
    command_line: String,
}

#[derive(Clone, Debug)]
struct ExitInfo {
    exit_code: Option<i32>,
    signal: Option<i32>,
}

#[derive(Default)]
struct TerminalOutput {
    buffer: Vec<u8>,
    truncated: bool,
    limit: usize,
}

impl TerminalOutput {
    fn new(limit: usize) -> Self {
        Self {
            buffer: Vec::new(),
            truncated: false,
            limit,
        }
    }

    fn append(&mut self, chunk: &[u8]) {
        let remaining = self.limit.saturating_sub(self.buffer.len());
        if remaining == 0 {
            self.truncated = true;
            return;
        }
        let take = chunk.len().min(remaining);
        self.buffer.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            self.truncated = true;
        }
    }

    fn snapshot(&self) -> (String, bool) {
        (
            String::from_utf8_lossy(&self.buffer).to_string(),
            self.truncated,
        )
    }
}

impl TerminalRegistry {
    /// Spawn a new terminal under the given session and return its id.
    pub(super) async fn create(
        &self,
        params: &Value,
        session_cwd: &PathBuf,
    ) -> Result<Value, (i64, String)> {
        let command = params
            .get("command")
            .and_then(Value::as_str)
            .ok_or((-32602, "terminal/create: missing 'command'".to_string()))?;
        let args = params
            .get("args")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .unwrap_or_else(|| session_cwd.clone());
        let limit = params
            .get("outputByteLimit")
            .and_then(Value::as_u64)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_OUTPUT_LIMIT);

        let command_line = if args.is_empty() {
            command.to_string()
        } else {
            format!("{command} {}", args.join(" "))
        };
        let mut cmd = Command::new(command);
        cmd.args(&args).current_dir(&cwd);
        if let Some(env) = params.get("env").and_then(Value::as_object) {
            for (key, value) in env {
                if let Some(value) = value.as_str() {
                    cmd.env(key, value);
                }
            }
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| (-32000, format!("terminal/create: spawn failed: {e}")))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let output = Arc::new(Mutex::new(TerminalOutput::new(limit)));
        let exit_status: Arc<Mutex<Option<ExitInfo>>> = Arc::new(Mutex::new(None));

        let pumps = spawn_pumps(stdout, stderr, Arc::clone(&output));

        let mut inner = self.inner.lock().await;
        inner.next_id += 1;
        let id = format!("term_{}", inner.next_id);
        inner.terminals.insert(
            id.clone(),
            TerminalEntry {
                child: Some(child),
                output,
                pumps,
                exit_status,
                command_line,
            },
        );
        Ok(json!({ "terminalId": id }))
    }

    /// Look up the command line we stashed at `terminal/create`. ACP's
    /// later tool-call references only carry the `terminalId`, so the
    /// adapter calls this to enrich Bash tool blocks with a `command`.
    pub(super) async fn command_for(&self, terminal_id: &str) -> Option<String> {
        let inner = self.inner.lock().await;
        inner
            .terminals
            .get(terminal_id)
            .map(|entry| entry.command_line.clone())
    }

    /// Return the current stdout/stderr snapshot as plain text. Used to
    /// surface terminal output in the FE without going through the full
    /// `output()` payload (which is shaped for ACP's wire response).
    pub(super) async fn output_text(&self, terminal_id: &str) -> Option<String> {
        let inner = self.inner.lock().await;
        let entry = inner.terminals.get(terminal_id)?;
        let (text, _) = entry.output.lock().await.snapshot();
        Some(text)
    }

    /// Return current accumulated output without blocking.
    pub(super) async fn output(&self, terminal_id: &str) -> Result<Value, (i64, String)> {
        let inner = self.inner.lock().await;
        let Some(entry) = inner.terminals.get(terminal_id) else {
            return Err((-32602, format!("terminal/output: unknown id {terminal_id}")));
        };
        let (text, truncated) = entry.output.lock().await.snapshot();
        let exit = entry.exit_status.lock().await.clone();
        Ok(build_output_payload(text, truncated, exit))
    }

    /// Block until the child exits, then return exit info.
    pub(super) async fn wait_for_exit(&self, terminal_id: &str) -> Result<Value, (i64, String)> {
        let child = {
            let mut inner = self.inner.lock().await;
            let Some(entry) = inner.terminals.get_mut(terminal_id) else {
                return Err((
                    -32602,
                    format!("terminal/wait_for_exit: unknown id {terminal_id}"),
                ));
            };
            entry.child.take()
        };
        let Some(mut child) = child else {
            // Already exited. Return cached info if any.
            let inner = self.inner.lock().await;
            if let Some(entry) = inner.terminals.get(terminal_id) {
                if let Some(exit) = entry.exit_status.lock().await.clone() {
                    return Ok(json!({
                        "exitCode": exit.exit_code,
                        "signal": exit.signal,
                    }));
                }
            }
            return Ok(json!({ "exitCode": null, "signal": null }));
        };
        let status = child
            .wait()
            .await
            .map_err(|e| (-32000, format!("terminal/wait_for_exit: {e}")))?;
        let exit = ExitInfo {
            exit_code: status.code(),
            signal: exit_signal(&status),
        };
        let exit_status = {
            let inner = self.inner.lock().await;
            inner
                .terminals
                .get(terminal_id)
                .map(|entry| Arc::clone(&entry.exit_status))
        };
        if let Some(exit_status) = exit_status {
            *exit_status.lock().await = Some(exit.clone());
        }
        Ok(json!({ "exitCode": exit.exit_code, "signal": exit.signal }))
    }

    /// Kill the running command (if any) without releasing the registry slot.
    pub(super) async fn kill(&self, terminal_id: &str) -> Result<Value, (i64, String)> {
        let mut inner = self.inner.lock().await;
        let Some(entry) = inner.terminals.get_mut(terminal_id) else {
            return Err((-32602, format!("terminal/kill: unknown id {terminal_id}")));
        };
        if let Some(child) = entry.child.as_mut() {
            let _ = child.start_kill();
        }
        Ok(Value::Null)
    }

    /// Kill the command if still running and remove the registry entry.
    pub(super) async fn release(&self, terminal_id: &str) -> Result<Value, (i64, String)> {
        let mut inner = self.inner.lock().await;
        let Some(mut entry) = inner.terminals.remove(terminal_id) else {
            return Err((
                -32602,
                format!("terminal/release: unknown id {terminal_id}"),
            ));
        };
        if let Some(mut child) = entry.child.take() {
            let _ = child.start_kill();
        }
        for handle in entry.pumps.drain(..) {
            handle.abort();
        }
        Ok(Value::Null)
    }
}

fn spawn_pumps(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    output: Arc<Mutex<TerminalOutput>>,
) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::new();
    if let Some(stdout) = stdout {
        let output = Arc::clone(&output);
        handles.push(tokio::spawn(
            async move { pump_stream(stdout, output).await },
        ));
    }
    if let Some(stderr) = stderr {
        handles.push(tokio::spawn(
            async move { pump_stream(stderr, output).await },
        ));
    }
    handles
}

async fn pump_stream<R>(mut reader: R, output: Arc<Mutex<TerminalOutput>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let mut guard = output.lock().await;
                guard.append(&buf[..n]);
            }
            Err(_) => break,
        }
    }
}

fn build_output_payload(text: String, truncated: bool, exit: Option<ExitInfo>) -> Value {
    let mut payload = json!({
        "output": text,
        "truncated": truncated,
    });
    if let Some(exit) = exit {
        payload["exitStatus"] = json!({
            "exitCode": exit.exit_code,
            "signal": exit.signal,
        });
    }
    payload
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

#[cfg(test)]
mod tests {
    use super::TerminalRegistry;
    use serde_json::json;
    use std::path::PathBuf;

    #[tokio::test]
    async fn create_then_output_returns_command_result() {
        let registry = TerminalRegistry::default();
        let cwd = std::env::temp_dir();
        let result = registry
            .create(&json!({ "command": "echo", "args": ["hi"] }), &cwd)
            .await
            .expect("create ok");
        let id = result["terminalId"].as_str().unwrap().to_string();

        // Wait for exit so output is flushed.
        let _ = registry.wait_for_exit(&id).await.unwrap();
        let out = registry.output(&id).await.unwrap();
        let text = out["output"].as_str().unwrap();
        assert!(text.contains("hi"), "output was: {text}");
        assert_eq!(out["exitStatus"]["exitCode"], 0);
        let _ = registry.release(&id).await.unwrap();
    }

    #[tokio::test]
    async fn create_missing_command_is_rejected() {
        let registry = TerminalRegistry::default();
        let err = registry
            .create(&json!({}), &PathBuf::from("/tmp"))
            .await
            .expect_err("should reject");
        assert_eq!(err.0, -32602);
    }

    #[tokio::test]
    async fn release_on_unknown_id_is_an_error() {
        let registry = TerminalRegistry::default();
        let err = registry
            .release("term_does_not_exist")
            .await
            .expect_err("should reject");
        assert_eq!(err.0, -32602);
    }

    #[tokio::test]
    async fn output_buffer_respects_byte_limit() {
        let registry = TerminalRegistry::default();
        let cwd = std::env::temp_dir();
        let result = registry
            .create(
                &json!({
                    "command": "sh",
                    "args": ["-c", "head -c 4096 /dev/zero | tr '\\0' 'x'"],
                    "outputByteLimit": 16,
                }),
                &cwd,
            )
            .await
            .expect("create ok");
        let id = result["terminalId"].as_str().unwrap().to_string();
        let _ = registry.wait_for_exit(&id).await.unwrap();
        let out = registry.output(&id).await.unwrap();
        let text = out["output"].as_str().unwrap();
        assert!(text.len() <= 16);
        assert_eq!(out["truncated"], true);
        let _ = registry.release(&id).await.unwrap();
    }
}
