//! Event-loop and server-request dispatch for the ACP runtime.
//!
//! Subscribes to the `AcpClient` broadcast channel, dispatches `session/update`
//! notifications through the events.rs mapper, routes server-initiated requests
//! through the appropriate handler module (permissions / fs / terminal), and
//! turns `ProcessExited` into a visible `RuntimeError` on the runtime channel.
//!
//! Notifications and server-requests arrive as typed envelopes
//! (`AcpNotification` / `AcpServerRequest`) that retain raw JSON. Handlers
//! prefer the typed payload when present and fall back to raw access for
//! OpenCode-style provider extensions.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::task::JoinHandle;

use crate::domain::agents::acp::incoming::{AcpNotification, AcpServerRequest};
use crate::domain::agents::acp::{AcpClient, AcpEvent};
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent, RuntimeStreamStatus};

use super::event_loop_state::sync_session_state_from_update;
use super::events::session_update_to_events;
use super::events_stream_blocks::EventIndexer;
use super::fs::{handle_read_text_file, handle_write_text_file, FsOutcome};
use super::permissions::{
    dispatch_permission_request_with_cache, permission_request_from_server_request,
    PendingPermissions,
};
use super::provider_hooks::AcpProviderHooks;
use super::session_permissions::SessionPermissions;
use super::terminal_enrich::enrich_session_update;
use super::terminal_registry::TerminalRegistry;

#[derive(Clone)]
pub struct EventLoopConfig {
    pub session_id: Arc<RwLock<Option<String>>>,
    pub current_model: Arc<RwLock<Option<String>>>,
    pub current_effort: Arc<RwLock<Option<String>>>,
    pub current_mode: Arc<RwLock<String>>,
    pub cwd: PathBuf,
    pub closing: Arc<AtomicBool>,
    pub pending_permissions: PendingPermissions,
    pub session_permissions: SessionPermissions,
    pub terminals: Arc<TerminalRegistry>,
    pub hooks: Arc<dyn AcpProviderHooks>,
    /// Shared streaming-block indexer. Owned jointly by the event loop (which
    /// mutates it on every `session/update`) and the prompt-turn path (which
    /// drains open blocks at `stop_reason` time — see W4).
    pub indexer: Arc<Mutex<EventIndexer>>,
}

/// Spawn the loop. Returns a handle the session can `abort()` on close.
pub fn spawn_event_loop(
    client: AcpClient,
    mut source_rx: broadcast::Receiver<AcpEvent>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: EventLoopConfig,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Tracks whether we've previously emitted a `Degraded` banner so we
        // can pair it with a `Recovered` banner once the next regular event
        // arrives. Without this the FE sees a stuck Degraded indicator
        // after a transient lag spike.
        let mut degraded = false;
        loop {
            match source_rx.recv().await {
                Ok(AcpEvent::Notification(notification)) => {
                    if degraded {
                        emit_recovered(&tx).await;
                        degraded = false;
                    }
                    handle_notification(&notification, &tx, &config).await;
                }
                Ok(AcpEvent::ServerRequest(request)) => {
                    if degraded {
                        emit_recovered(&tx).await;
                        degraded = false;
                    }
                    handle_server_request(&client, request, &tx, &config).await;
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
                                "ACP process exited: {message}"
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
    })
}

async fn handle_notification(
    notification: &AcpNotification,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    match notification {
        AcpNotification::SessionUpdate { .. } => {
            let params = notification.params();
            sync_session_state_from_update(params, config).await;
            let session_id = config.session_id.read().await.clone();
            let model = config.current_model.read().await.clone();
            // Resolve any `terminalId` references so Bash tool blocks reach
            // the FE with both `toolInput.command` and an inline text result.
            let enriched = enrich_session_update(params, &config.terminals).await;
            let payload = enriched.as_ref().unwrap_or(params);
            let mapped = {
                // Hold the mutex only across the (synchronous) mapping call;
                // never across `await`. The prompt-turn path competes for
                // this lock at turn end (see drain_open_blocks).
                let mut indexer = config.indexer.lock().expect("EventIndexer poisoned");
                session_update_to_events(
                    payload,
                    &mut indexer,
                    model.as_deref(),
                    session_id.as_deref(),
                    config.hooks.as_ref(),
                )
            };
            for event in mapped.events {
                if tx.send(Ok(event)).await.is_err() {
                    return;
                }
            }
        }
        AcpNotification::Extension { method, .. } => {
            tracing::debug!(method, "unhandled ACP notification");
        }
    }
}

async fn handle_server_request(
    client: &AcpClient,
    request: AcpServerRequest,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    let id = request.id().clone();
    match request.method() {
        "session/request_permission" => {
            handle_permission_request(client, id, &request, tx, config).await;
        }
        "fs/read_text_file" => {
            let outcome = handle_read_text_file(&request, &config.cwd).await;
            respond_or_reject(client, id, outcome).await;
        }
        "fs/write_text_file" => {
            let outcome = handle_write_text_file(&request, &config.cwd).await;
            respond_or_reject(client, id, outcome).await;
        }
        "terminal/create" => {
            let result = config.terminals.create(request.params(), &config.cwd).await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/output" => {
            let result = config
                .terminals
                .output(terminal_id_param(request.params()))
                .await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/wait_for_exit" => {
            let result = config
                .terminals
                .wait_for_exit(terminal_id_param(request.params()))
                .await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/kill" => {
            let result = config
                .terminals
                .kill(terminal_id_param(request.params()))
                .await;
            respond_or_reject(client, id, fs_outcome_from(result)).await;
        }
        "terminal/release" => {
            let result = config
                .terminals
                .release(terminal_id_param(request.params()))
                .await;
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
    request: &AcpServerRequest,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    let request_id = id
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| id.to_string());
    let parsed = permission_request_from_server_request(&request_id, request);
    let Some(permission) = parsed else {
        if let Err(error) = client
            .reject_server_request(id, -32602, "missing toolCall")
            .await
        {
            tracing::error!(%error, "failed to reject malformed ACP permission request");
        }
        return;
    };
    let session_id = config.session_id.read().await.clone();
    dispatch_permission_request_with_cache(
        client,
        &config.pending_permissions,
        &config.session_permissions,
        session_id,
        &request_id,
        id.clone(),
        permission,
        request.params(),
        tx,
    )
    .await;
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

/// Send a `RuntimeStreamStatus::Recovered` banner. The event loop pairs
/// this with a previously-emitted `Degraded` so the UI doesn't get stuck
/// after a transient lag spike.
async fn emit_recovered(tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>) {
    let _ = tx
        .send(Ok(RuntimeEvent::stream_status_event(
            RuntimeStreamStatus::Recovered,
        )))
        .await;
}

/// Render an exit-status pair `(code, signal)` into a human-readable
/// reason string for surface envelopes.
pub fn describe_exit(status: Option<i32>, signal: Option<i32>) -> String {
    match (status, signal) {
        (Some(code), _) => format!("exit code {code}"),
        (_, Some(sig)) => format!("signal {sig}"),
        _ => "unknown reason".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::describe_exit;

    #[test]
    fn describe_exit_prefers_status_then_signal() {
        assert_eq!(describe_exit(Some(0), None), "exit code 0");
        assert_eq!(describe_exit(None, Some(9)), "signal 9");
        assert_eq!(describe_exit(None, None), "unknown reason");
    }
}
