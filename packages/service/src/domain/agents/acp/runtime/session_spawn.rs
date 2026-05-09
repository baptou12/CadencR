//! Spawn-time wiring for [`AcpRuntimeSession`]. Lifted out of `session.rs`
//! so the session module stays under the 400-line ceiling. Owns the
//! end-to-end spawn flow: subprocess + handshake + struct assembly + event
//! loop + initial-prompt detach.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::Value;
use tokio::sync::{mpsc, Mutex as AsyncMutex, RwLock};

use crate::domain::agents::acp::{AcpClient, AcpClientInfo, AcpSpawnOptions};
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
    RuntimeInitEvent, RuntimeSpawnConfig,
};

use super::events_stream_blocks::EventIndexer;
use super::lifecycle::{negotiate_session, NegotiatedSession};
use super::permissions::PendingPermissions;
use super::provider_hooks::AcpProviderHooks;
use super::server_requests::{spawn_event_loop, EventLoopConfig};
use super::session::{AcpRuntimeSession, MESSAGE_CHANNEL_CAPACITY};
use super::session_permissions::SessionPermissions;
use super::terminal_registry::TerminalRegistry;
use super::turn_lifecycle::drive_initial_prompt;

/// Options for [`spawn_acp_runtime_session`].
pub struct AcpRuntimeSpawnArgs {
    pub command: tokio::process::Command,
    pub client_info: AcpClientInfo,
    pub config: RuntimeSpawnConfig,
    pub initial_content: Value,
    /// Provider-resolved context window for the negotiated model.
    pub context_window: Option<u64>,
    pub hooks: Arc<dyn AcpProviderHooks>,
}

/// End-to-end spawn for a generic ACP subprocess: client + handshake +
/// session + event loop, then drive the initial prompt off-thread so the
/// spawn doesn't wedge on a blocking tool call.
pub async fn spawn_acp_runtime_session(
    args: AcpRuntimeSpawnArgs,
) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
    let AcpRuntimeSpawnArgs {
        command,
        client_info,
        config,
        initial_content,
        context_window,
        hooks,
    } = args;
    let client = AcpClient::spawn(AcpSpawnOptions {
        command,
        client_info,
        request_timeout: None,
        max_line_bytes: None,
    })
    .await
    .map_err(|e| RuntimeError::new(format!("failed to spawn ACP subprocess: {e}")))?;
    let pid = client.pid();
    let event_rx = client.subscribe();
    let negotiated = negotiate_session(&client, &config, context_window).await?;

    let (tx, rx) = mpsc::channel(MESSAGE_CHANNEL_CAPACITY);
    let indexer = Arc::new(StdMutex::new(EventIndexer::default()));
    let mut session = AcpRuntimeSession::assemble(
        &client,
        &negotiated,
        &config,
        pid,
        rx,
        tx.clone(),
        hooks.clone(),
        Arc::clone(&indexer),
    );

    emit_init_event(&tx, &negotiated).await;
    let handles = spawn_event_loop(
        client.clone(),
        event_rx,
        tx.clone(),
        EventLoopConfig {
            session_id: Arc::clone(&session.session_id),
            current_model: Arc::clone(&session.current_model),
            current_effort: Arc::clone(&session.current_effort),
            current_mode: Arc::clone(&session.current_mode),
            cwd: config.cwd.clone(),
            closing: Arc::clone(&session.closing),
            pending_permissions: Arc::clone(&session.pending_permissions),
            terminals: Arc::new(TerminalRegistry::default()),
            hooks: hooks.clone(),
            indexer: Arc::clone(&session.indexer),
        },
    );
    session.loop_task = Some(handles.task);

    if !initial_content.is_null() {
        spawn_initial_prompt(&session, &tx, initial_content);
    }

    tracing::info!(transport = "acp", pid = ?pid, "ACP runtime session spawned");
    Ok(Box::new(session))
}

/// Detach: awaiting `session/prompt` here would deadlock the spawn when the
/// agent's first tool blocks on user input. The initial prompt routes
/// through the same `prompt_turn_lock` as `stream_input` so a follow-up FE
/// prompt arriving before the initial turn resolves queues behind it (W4).
fn spawn_initial_prompt(
    session: &AcpRuntimeSession,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    initial_content: Value,
) {
    let session_for_prompt = session.client.clone();
    let session_id_arc = Arc::clone(&session.session_id);
    let current_model_arc = Arc::clone(&session.current_model);
    let current_effort_arc = Arc::clone(&session.current_effort);
    let local_tx = tx.clone();
    let indexer_arc = Arc::clone(&session.indexer);
    let context_window = session.context_window;
    let prompt_turn_lock = Arc::clone(&session.prompt_turn_lock);
    tokio::spawn(async move {
        if let Err(error) = drive_initial_prompt(
            &session_for_prompt,
            &session_id_arc,
            &current_model_arc,
            &current_effort_arc,
            initial_content,
            &local_tx,
            &indexer_arc,
            context_window,
            &prompt_turn_lock,
        )
        .await
        {
            let _ = local_tx.send(Err(error)).await;
        }
    });
}

impl AcpRuntimeSession {
    /// Assemble a session struct from negotiated handshake state.
    /// Pulled out of [`spawn_acp_runtime_session`] for readability.
    pub(super) fn assemble(
        client: &AcpClient,
        negotiated: &NegotiatedSession,
        config: &RuntimeSpawnConfig,
        pid: Option<u32>,
        rx: mpsc::Receiver<Result<RuntimeEvent, RuntimeError>>,
        local_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
        hooks: Arc<dyn AcpProviderHooks>,
        indexer: Arc<StdMutex<EventIndexer>>,
    ) -> AcpRuntimeSession {
        AcpRuntimeSession {
            client: client.clone(),
            session_id: Arc::new(RwLock::new(Some(negotiated.session_id.clone()))),
            current_model: Arc::new(RwLock::new(negotiated.model.clone())),
            current_effort: Arc::new(RwLock::new(config.thinking_effort.clone())),
            current_mode: Arc::new(RwLock::new("build".to_string())),
            supports_set_config_option: Arc::new(AtomicBool::new(true)),
            pending_permissions: PendingPermissions::default(),
            session_permissions: SessionPermissions::new(),
            closing: Arc::new(AtomicBool::new(false)),
            pid,
            context_window: negotiated.context_window,
            message_rx: Some(rx),
            loop_task: None,
            local_tx,
            hooks,
            indexer,
            prompt_turn_lock: Arc::new(AsyncMutex::new(())),
        }
    }
}

async fn emit_init_event(
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    negotiated: &NegotiatedSession,
) {
    let raw = serde_json::json!({
        "type": "session.init",
        "transport": "acp",
        "model": negotiated.model,
        "mcp_servers": negotiated.mcp_servers.iter().map(|s| serde_json::json!({
            "name": s.name,
            "status": s.status,
        })).collect::<Vec<_>>(),
    });
    let init_event = RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(negotiated.session_id.clone()),
            usage: None,
            context_window: negotiated.context_window,
            raw,
        },
        RuntimeEventKind::Init(RuntimeInitEvent {
            model: negotiated.model.clone(),
            mcp_servers: negotiated.mcp_servers.clone(),
            context_window: negotiated.context_window,
        }),
    );
    if let Err(error) = tx.send(Ok(init_event)).await {
        tracing::warn!(%error, "failed to send ACP init event");
    }
}
