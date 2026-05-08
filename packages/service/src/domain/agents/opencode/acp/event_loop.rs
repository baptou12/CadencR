//! Event loop draining the ACP transport into Cadencr `RuntimeEvent`s.
//!
//! Subscribes to the `AcpClient` broadcast channel, dispatches notifications
//! through the events.rs mapper, routes server-initiated requests through
//! the appropriate handler module (permissions / fs / terminal), and turns
//! `ProcessExited` into a visible `RuntimeError` on the runtime channel.
//!
//! The loop keeps a `RwLock`-shared `pending_permissions` map keyed by
//! request_id so the session's `respond_permission()` method can look up
//! the original ACP server-request id when the user picks an option.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::task::JoinHandle;

use crate::domain::agents::acp::{AcpClient, AcpEvent};
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimePermissionDecision,
    RuntimePermissionOption, RuntimePermissionRequest, RuntimeStreamStatus,
};
use crate::domain::agents::opencode::acp::event_loop_status::{
    describe_exit, emit_recovered, sync_session_state_from_update,
};
use crate::domain::agents::opencode::acp::event_loop_terminal_enrich::enrich_session_update;
use crate::domain::agents::opencode::acp::events::{session_update_to_events, EventIndexer};
use crate::domain::agents::opencode::acp::fs_handler::{
    handle_read_text_file, handle_write_text_file, FsOutcome,
};
use crate::domain::agents::opencode::acp::permissions::permission_request_from_acp;
use crate::domain::agents::opencode::acp::terminal_registry::TerminalRegistry;

/// Map keyed by Cadencr `request_id` (the ACP server-request id, stringified).
/// Value is the raw ACP id we need to echo back when responding.
pub(super) type PendingPermissions = Arc<RwLock<HashMap<String, Value>>>;

pub(super) struct EventLoopHandles {
    pub task: JoinHandle<()>,
}

#[derive(Clone)]
pub(super) struct EventLoopConfig {
    pub session_id: Arc<RwLock<Option<String>>>,
    pub current_model: Arc<RwLock<Option<String>>>,
    pub current_mode: Arc<RwLock<String>>,
    pub cwd: PathBuf,
    pub closing: Arc<AtomicBool>,
    pub pending_permissions: PendingPermissions,
    pub terminals: Arc<TerminalRegistry>,
}

/// Spawn the loop. Returns a handle the session can `abort()` on close.
pub(super) fn spawn_event_loop(
    client: AcpClient,
    mut source_rx: broadcast::Receiver<AcpEvent>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: EventLoopConfig,
) -> EventLoopHandles {
    let task = tokio::spawn(async move {
        let mut indexer = EventIndexer::default();
        // Tracks whether we've previously emitted a `Degraded` banner so we
        // can pair it with a `Recovered` banner once the next regular event
        // arrives. Without this the FE sees a stuck Degraded indicator
        // after a transient lag spike.
        let mut degraded = false;
        loop {
            match source_rx.recv().await {
                Ok(AcpEvent::Notification { method, params }) => {
                    if degraded {
                        emit_recovered(&tx).await;
                        degraded = false;
                    }
                    handle_notification(&method, &params, &mut indexer, &tx, &config).await;
                }
                Ok(AcpEvent::ServerRequest { id, method, params }) => {
                    if degraded {
                        emit_recovered(&tx).await;
                        degraded = false;
                    }
                    handle_server_request(&client, id, &method, &params, &tx, &config).await;
                }
                Ok(AcpEvent::ProcessExited { status, signal }) => {
                    if !config.closing.load(Ordering::SeqCst) {
                        let message = describe_exit(status, signal);
                        let _ = tx
                            .send(Ok(RuntimeEvent::stream_status_event(
                                RuntimeStreamStatus::Degraded {
                                    reason: format!("ACP process exited: {message}"),
                                },
                            )))
                            .await;
                        let _ = tx
                            .send(Err(RuntimeError::new(format!(
                                "opencode ACP process exited: {message}"
                            ))))
                            .await;
                    }
                    break;
                }
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "ACP event broadcast lagged");
                    let _ = tx
                        .send(Ok(RuntimeEvent::stream_status_event(
                            RuntimeStreamStatus::Degraded {
                                reason: format!("event backlog: {skipped} skipped"),
                            },
                        )))
                        .await;
                    degraded = true;
                }
            }
        }
    });
    EventLoopHandles { task }
}

async fn handle_notification(
    method: &str,
    params: &Value,
    indexer: &mut EventIndexer,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    match method {
        "session/update" => {
            sync_session_state_from_update(params, config).await;
            let session_id = config.session_id.read().await.clone();
            let model = config.current_model.read().await.clone();
            // Resolve any `terminalId` references so Bash tool blocks reach
            // the FE with both `toolInput.command` and an inline text result.
            let enriched = enrich_session_update(params, &config.terminals).await;
            let payload = enriched.as_ref().unwrap_or(params);
            let mapped =
                session_update_to_events(payload, indexer, model.as_deref(), session_id.as_deref());
            for event in mapped.events {
                if tx.send(Ok(event)).await.is_err() {
                    return;
                }
            }
        }
        other => {
            tracing::debug!(method = other, "unhandled ACP notification");
        }
    }
}

async fn handle_server_request(
    client: &AcpClient,
    id: Value,
    method: &str,
    params: &Value,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    match method {
        "session/request_permission" => {
            handle_permission_request(client, id, params, tx, config).await;
        }
        "fs/read_text_file" => {
            let outcome = handle_read_text_file(&config.cwd, params).await;
            respond_or_reject(client, id, outcome).await;
        }
        "fs/write_text_file" => {
            let outcome = handle_write_text_file(&config.cwd, params).await;
            respond_or_reject(client, id, outcome).await;
        }
        "terminal/create" => {
            let result = config.terminals.create(params, &config.cwd).await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/output" => {
            let result = config.terminals.output(terminal_id_param(params)).await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/wait_for_exit" => {
            let result = config
                .terminals
                .wait_for_exit(terminal_id_param(params))
                .await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/kill" => {
            let result = config.terminals.kill(terminal_id_param(params)).await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/release" => {
            let result = config.terminals.release(terminal_id_param(params)).await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        other => {
            tracing::warn!(method = other, "unhandled ACP server request");
            if let Err(error) = client
                .reject_server_request(id, -32601, "method not found")
                .await
            {
                tracing::error!(%error, method = other, "failed to reject unknown ACP request");
            }
        }
    }
}

async fn handle_permission_request(
    client: &AcpClient,
    id: Value,
    params: &Value,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    let request_id = id
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| id.to_string());
    let Some(request) = permission_request_from_acp(&request_id, params) else {
        if let Err(error) = client
            .reject_server_request(id, -32602, "missing toolCall")
            .await
        {
            tracing::error!(%error, "failed to reject malformed ACP permission request");
        }
        return;
    };
    config
        .pending_permissions
        .write()
        .await
        .insert(request_id.clone(), id.clone());

    let raw = permission_raw_event(&request, params);
    let metadata = crate::domain::agents::adapter::RuntimeEventMetadata {
        session_id: config.session_id.read().await.clone(),
        usage: None,
        context_window: None,
        raw,
    };
    // The WS bridge picks the request up via `parse_permission_request` on
    // the raw envelope; mirrors how the HTTP path also surfaces these.
    let event = RuntimeEvent::new(metadata, RuntimeEventKind::Other);
    let _ = tx.send(Ok(event)).await;
    // Hold the server-request open: `respond_permission()` answers it
    // later. Agent-initiated cancellation just silently drops the id.
}

fn permission_raw_event(request: &RuntimePermissionRequest, params: &Value) -> Value {
    json!({
        "type": "opencode_permission_request",
        "transport": "acp",
        "request_id": request.request_id,
        "call_id": request.tool_use_id,
        "tool_name": request.tool_name,
        "tool_input": request.tool_input,
        "description": request.description,
        "preview": request.preview,
        "options": request.options.iter().map(permission_option_json).collect::<Vec<_>>(),
        "acp": params.clone(),
    })
}

fn permission_option_json(option: &RuntimePermissionOption) -> Value {
    let decision = match option.decision {
        RuntimePermissionDecision::AllowOnce => "allow_once",
        RuntimePermissionDecision::AllowFuture => "allow_future",
        RuntimePermissionDecision::Deny => "deny",
    };
    json!({
        "decision": decision,
        "option_id": option.option_id,
        "label": option.label,
        "description": option.description,
        "collect_feedback": option.collect_feedback,
    })
}

async fn respond_or_reject(client: &AcpClient, id: Value, outcome: FsOutcome) {
    match outcome {
        FsOutcome::Ok(value) => {
            if let Err(error) = client.respond_server_request(id, value).await {
                tracing::warn!(%error, "failed to send ACP response");
            }
        }
        FsOutcome::Error { code, message } => {
            if let Err(error) = client.reject_server_request(id, code, &message).await {
                tracing::warn!(%error, "failed to send ACP error");
            }
        }
    }
}

/// Bridge a terminal-registry result (ok value or `(code, message)`) to the
/// shared `FsOutcome` shape used by `respond_or_reject`.
fn fs_outcome_from(result: Result<Value, (i64, String)>) -> FsOutcome {
    match result {
        Ok(value) => FsOutcome::Ok(value),
        Err((code, message)) => FsOutcome::Error { code, message },
    }
}

/// Extract `terminalId` from a `terminal/*` server-request payload, defaulting
/// to "" so the registry surfaces a clear "unknown id" error if missing.
fn terminal_id_param(params: &Value) -> &str {
    params
        .get("terminalId")
        .and_then(Value::as_str)
        .unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::{spawn_event_loop, EventLoopConfig};
    use crate::domain::agents::acp::{AcpClient, AcpClientInfo};
    use crate::domain::agents::adapter::AgentRuntimeAdapter;
    use crate::domain::agents::opencode::OpenCodeAdapter;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tokio::io::{duplex, AsyncWriteExt};
    use tokio::sync::{mpsc, RwLock};

    fn dummy_config() -> EventLoopConfig {
        EventLoopConfig {
            session_id: Arc::new(RwLock::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            current_mode: Arc::new(RwLock::new("build".to_string())),
            cwd: PathBuf::from("/tmp"),
            closing: Arc::new(AtomicBool::new(false)),
            pending_permissions: Arc::new(RwLock::new(Default::default())),
            terminals: Arc::new(super::TerminalRegistry::default()),
        }
    }

    #[tokio::test]
    async fn config_pending_permissions_is_per_session_writable() {
        let cfg = dummy_config();
        cfg.pending_permissions
            .write()
            .await
            .insert("perm-1".to_string(), serde_json::json!("perm-1"));
        assert_eq!(cfg.pending_permissions.read().await.len(), 1);
    }

    #[tokio::test]
    async fn permission_request_emits_parseable_runtime_permission_event() {
        let (client_reads_stdout, mut agent_writes_stdout) = duplex(64 * 1024);
        let (agent_reads_stdin, client_writes_stdin) = duplex(64 * 1024);
        let client = AcpClient::spawn_with_streams(
            Box::new(client_writes_stdin),
            client_reads_stdout,
            agent_reads_stdin,
            AcpClientInfo::default(),
        );
        let (tx, mut rx) = mpsc::channel(8);
        let config = dummy_config();
        *config.session_id.write().await = Some("s1".to_string());
        let handles = spawn_event_loop(client.clone(), client.subscribe(), tx, config.clone());

        let frame = format!(
            "{}\n",
            json!({
                "id": "perm-1",
                "method": "session/request_permission",
                "params": {
                    "toolCall": {
                        "toolCallId": "call-1",
                        "toolName": "Bash",
                        "toolInput": { "command": "git status" },
                        "title": "Run a command"
                    },
                    "options": [
                        { "optionId": "yes", "name": "Allow once", "kind": "allow_once" },
                        { "optionId": "always", "name": "Allow always", "kind": "allow_always" },
                        { "optionId": "no", "name": "Reject", "kind": "reject_once" }
                    ]
                }
            })
        );
        agent_writes_stdout
            .write_all(frame.as_bytes())
            .await
            .unwrap();

        let event = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let parsed = OpenCodeAdapter
            .parse_permission_request(event.raw_json())
            .expect("permission request should be visible to WS bridge");
        assert_eq!(parsed.request_id, "perm-1");
        assert_eq!(parsed.tool_use_id.as_deref(), Some("call-1"));
        assert_eq!(parsed.options[0].option_id.as_deref(), Some("yes"));
        assert_eq!(config.pending_permissions.read().await.len(), 1);
        handles.task.abort();
    }
}
