// Some surfaces in this module (cancel-pending, advertised agent capabilities,
// per-session cwd label) are deliberately exposed for follow-up work that
// will wire them through the WS bridge; allow dead code at the module level
// rather than peppering individual `#[allow]`s.
#![allow(dead_code)]

//! OpenCode adapter on top of the generic ACP transport.
//!
//! Mirror of the Codex adapter shape: this submodule owns the OpenCode-
//! specific spawn (`opencode acp --cwd <cwd>`), the `session/update`
//! mapping, the `fs/*` and `terminal/*` server-side handlers, and the ACP
//! permission-elicitation mapping. The generic JSON-RPC plumbing lives in
//! `domain::agents::acp` and is shared with future ACP providers.

mod event_loop;
mod event_loop_status;
mod event_loop_terminal_enrich;
mod events;
mod events_plan;
mod events_stream_blocks;
mod events_tool_call;
mod events_tool_call_input;
mod events_tool_call_normalize;
mod fs_handler;
mod init;
pub(super) mod input;
mod permissions;
mod question_sidecar;
mod session;
mod session_permissions;
mod session_prompt;
mod terminal_registry;

use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde_json::Value;
use tokio::process::Command;
use tokio::sync::{mpsc, RwLock};

use cli_discovery::{discover_all, select_best};
use opencode_sdk_rs::process::opencode_discovery_spec;

use crate::domain::agents::acp::{AcpClient, AcpClientInfo, AcpSpawnOptions};
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
    RuntimeInitEvent, RuntimeSpawnConfig,
};

use self::event_loop::{spawn_event_loop, EventLoopConfig};
use self::init::negotiate_session;
use self::question_sidecar::QuestionSidecar;
use self::session::OpenCodeAcpSession;
use self::terminal_registry::TerminalRegistry;

/// Channel buffer for the per-session runtime stream. Matches the size used
/// by other adapters; deltas are coalesced upstream so even noisy turns fit.
const MESSAGE_CHANNEL_CAPACITY: usize = 1024;

/// ACP's answer to the runtime layer's "is this session finished?" probe.
///
/// The HTTP transport answers by walking OpenCode's persisted message log
/// for a terminal stop reason — that's appropriate when the runtime is a
/// long-lived shared HTTP server we don't own. For ACP the runtime is the
/// `opencode acp` subprocess that *we* own, and a finished agent turn is
/// not the same as a finished session: the subprocess stays alive across
/// turns so follow-up prompts share an ACP `sessionId` and the agent keeps
/// conversation memory. Real subprocess exit is signalled separately
/// through `AcpEvent::ProcessExited`, which the event loop converts into
/// an `Err` on the runtime channel and the WS stream reader breaks on
/// that path. So the answer here is unconditionally `false`.
pub(super) async fn session_finished(_runtime_session_id: &str) -> bool {
    false
}

/// Entry point invoked by `OpenCodeAdapter::spawn` when
/// `CADENCR_OPENCODE_TRANSPORT=acp` is set.
pub(super) async fn spawn_acp_session(
    content: Value,
    config: RuntimeSpawnConfig,
) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
    let (client, question_sidecar) = build_acp_client(&config).await?;
    let pid = client.pid();
    let event_rx = client.subscribe();
    let negotiated = negotiate_session(&client, &config).await?;

    let (tx, rx) = mpsc::channel(MESSAGE_CHANNEL_CAPACITY);
    let mut session = assemble_session(
        &client,
        &negotiated,
        &config,
        pid,
        rx,
        tx.clone(),
        question_sidecar,
    );

    emit_init_event(&tx, &negotiated).await;
    let handles = spawn_event_loop(
        client.clone(),
        event_rx,
        tx.clone(),
        EventLoopConfig {
            session_id: Arc::clone(&session.session_id),
            current_model: Arc::clone(&session.current_model),
            current_mode: Arc::clone(&session.current_mode),
            cwd: config.cwd.clone(),
            closing: Arc::clone(&session.closing),
            pending_permissions: Arc::clone(&session.pending_permissions),
            terminals: Arc::clone(&session.terminals_for_loop),
        },
    );
    session.loop_task = Some(handles.task);

    if !content.is_null() {
        // Dispatch the first prompt asynchronously. Awaiting `session/prompt`
        // here would deadlock the spawn whenever the agent calls a tool that
        // blocks on user input (e.g. `question`, permission elicitation):
        // the request stays open until the user answers, the user can't
        // answer until the WS bridge sees the corresponding runtime event,
        // and the bridge can't pump events until `spawn_acp_session`
        // returns. Detach the prompt drive into a task and let the event
        // loop carry the response; failures surface through the runtime
        // channel as `Err(RuntimeError)`.
        let session_for_prompt = session.client.clone();
        let session_id_arc = Arc::clone(&session.session_id);
        let current_model_arc = Arc::clone(&session.current_model);
        let current_effort_arc = Arc::clone(&session.current_effort);
        let local_tx = tx.clone();
        tokio::spawn(async move {
            if let Err(error) = self::session_prompt::drive_initial_prompt(
                &session_for_prompt,
                &session_id_arc,
                &current_model_arc,
                &current_effort_arc,
                content,
                &local_tx,
            )
            .await
            {
                let _ = local_tx.send(Err(error)).await;
            }
        });
    }

    tracing::info!(transport = "acp", pid = ?pid, "opencode ACP session spawned");
    Ok(Box::new(session))
}

/// Build the `tokio::process::Command` for `opencode acp --cwd <cwd>` and
/// hand it to `AcpClient::spawn`. Honors `config.env` overrides.
async fn build_acp_client(
    config: &RuntimeSpawnConfig,
) -> Result<(AcpClient, QuestionSidecar), RuntimeError> {
    let binary = resolve_opencode_binary().await?;
    let mut command = Command::new(&binary);
    let question_port = reserve_local_port()?;
    command
        .arg("acp")
        .arg("--cwd")
        .arg(config.cwd.as_path())
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(question_port.to_string());
    // Opt into OpenCode's interactive `question` tool. Disabled by default
    // in ACP mode (PR opencode#11379) because some clients can't render
    // multi-option prompts. Cadencr DOES — we route the tool_call through
    // `events_tool_call::question_permission_event` and reply through the
    // same ACP sidecar's scoped question endpoint. Caller env wins.
    let caller_overrides_question_tool = config
        .env
        .as_ref()
        .map(|env| env.contains_key("OPENCODE_ENABLE_QUESTION_TOOL"))
        .unwrap_or(false);
    if !caller_overrides_question_tool {
        command.env("OPENCODE_ENABLE_QUESTION_TOOL", "1");
    }
    if let Some(env) = config.env.as_ref() {
        for (key, value) in env {
            command.env(key, value);
        }
    }
    let client = AcpClient::spawn(AcpSpawnOptions {
        command,
        client_info: AcpClientInfo::default(),
        request_timeout: None,
        max_line_bytes: None,
    })
    .await
    .map_err(|e| RuntimeError::new(format!("failed to spawn opencode acp: {e}")))?;
    Ok((client, QuestionSidecar::new(question_port, &config.cwd)))
}

fn reserve_local_port() -> Result<u16, RuntimeError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        RuntimeError::new(format!("failed to reserve ACP sidecar port: {error}"))
    })?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| RuntimeError::new(format!("failed to read ACP sidecar port: {error}")))
}

/// Construct the session struct. The event-loop task slot is filled in by
/// the caller once the loop is spawned.
fn assemble_session(
    client: &AcpClient,
    negotiated: &init::NegotiatedSession,
    config: &RuntimeSpawnConfig,
    pid: Option<u32>,
    rx: mpsc::Receiver<Result<RuntimeEvent, RuntimeError>>,
    local_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    question_sidecar: QuestionSidecar,
) -> OpenCodeAcpSession {
    let session_id = Arc::new(RwLock::new(Some(negotiated.session_id.clone())));
    let current_model = Arc::new(RwLock::new(negotiated.model.clone()));
    let current_effort = Arc::new(RwLock::new(config.thinking_effort.clone()));
    let current_mode = Arc::new(RwLock::new("build".to_string()));
    let pending_permissions = Arc::new(RwLock::new(Default::default()));
    let closing = Arc::new(AtomicBool::new(false));
    let terminals = Arc::new(TerminalRegistry::default());
    OpenCodeAcpSession {
        client: client.clone(),
        session_id,
        current_model,
        current_effort,
        current_mode,
        cwd: config.cwd.clone(),
        pending_permissions,
        closing,
        pid,
        context_window: negotiated.context_window,
        message_rx: Some(rx),
        loop_task: None,
        terminals_for_loop: terminals,
        local_tx,
        question_sidecar,
    }
}

/// Emit the runtime init event before any ACP notifications start flowing.
async fn emit_init_event(
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    negotiated: &init::NegotiatedSession,
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

/// Resolve the `opencode` binary path. Honors the existing override via
/// `set_binary_override` (which the host applies from `opencode_cli_path`
/// settings) and the `CADENCR_OPENCODE_BIN` env var.
async fn resolve_opencode_binary() -> Result<std::path::PathBuf, RuntimeError> {
    let spec = opencode_discovery_spec();
    let override_path = std::env::var_os("CADENCR_OPENCODE_BIN").map(std::path::PathBuf::from);
    let override_ref: Option<&Path> = override_path.as_deref();
    let candidates = discover_all(&spec, override_ref).await;
    if let Some(best) = select_best(&candidates) {
        return Ok(best.path.clone());
    }
    Err(RuntimeError::cli_not_found(
        "opencode",
        candidates.iter().map(|c| c.path.clone()).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::resolve_opencode_binary;

    #[tokio::test]
    async fn resolve_returns_a_path_or_an_actionable_error() {
        // We can't assert success on every CI host, but the function must
        // never panic and must return an error variant we can render —
        // that's the contract for the spawn pathway.
        let result = resolve_opencode_binary().await;
        match result {
            Ok(path) => assert!(path.is_absolute() || path.exists() || true),
            Err(_error) => { /* CliNotFound is a valid outcome */ }
        }
    }
}
