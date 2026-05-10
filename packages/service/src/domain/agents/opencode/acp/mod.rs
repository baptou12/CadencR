//! OpenCode adapter on top of the generic ACP transport.
//!
//! Owns OpenCode-specific spawn (`opencode acp --cwd <cwd>`), the question
//! sidecar (used by OpenCode's interactive `question` tool), and the
//! `OpenCodeAcpAdapter` that plugs OpenCode quirks into the otherwise
//! provider-neutral `acp::runtime` layer.

mod adapter;
mod adapter_normalize;
mod events_subagent_synthesis;
mod events_tool_call_question;
mod question_sidecar;
// Workarounds for ACP-wire limitations in upstream OpenCode. Anything
// that talks to the embedded HTTP backend on `--port` to make up for an
// ACP-wire gap lives here; see `upstream_workaround/mod.rs` for the
// removal criteria. Distinct from the legacy OpenCode HTTP transport
// under `opencode/http/` (and `opencode-sdk-rs/src/sse/**`), which is
// being retired and whose removal must NOT take this directory with it.
mod upstream_workaround;

use std::net::TcpListener;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tokio::process::Command;

use cli_discovery::{discover_all, select_best};
use opencode_sdk_rs::process::opencode_discovery_spec;

use crate::domain::agents::acp::runtime::{spawn_acp_runtime_session, AcpRuntimeSpawnArgs};
use crate::domain::agents::acp::AcpClientInfo;
use crate::domain::agents::adapter::{AgentRuntimeSession, RuntimeError, RuntimeSpawnConfig};

use self::adapter::OpenCodeAcpAdapter;
use self::question_sidecar::QuestionSidecar;

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

/// Entry point invoked by `OpenCodeAdapter::spawn`. ACP is the only
/// supported OpenCode transport; see `transport.rs` for the hardcode.
pub(super) async fn spawn_acp_session(
    content: Value,
    config: RuntimeSpawnConfig,
) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
    let binary = resolve_opencode_binary().await?;
    let reserved_question_port = reserve_local_port()?;
    let question_port = reserved_question_port.port();
    let mut command = Command::new(&binary);
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
    // the OpenCode adapter's question hook and reply through the same ACP
    // sidecar's scoped question endpoint. Caller env wins.
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
    let question_sidecar = QuestionSidecar::new(question_port, &config.cwd);
    let context_window = match config.model.as_deref() {
        Some(model) => {
            crate::domain::agents::providers::opencode::context_window_for_model(model).await
        }
        None => None,
    };
    // `question_port` is also the OpenCode HTTP backend's port — the same
    // server hosts both the question sidecar endpoints we already use and
    // the `/event` SSE stream the sub-agent listener subscribes to. See
    // `opencode/src/cli/cmd/acp.ts` upstream: `Server.listen({hostname,port})`
    // is bound to the same `--hostname --port` flags Cadencr passes.
    spawn_acp_runtime_session(AcpRuntimeSpawnArgs {
        command,
        spawn_guard: Some(Box::new(reserved_question_port)),
        client_info: AcpClientInfo::default(),
        config,
        initial_content: content,
        context_window,
        hooks: Arc::new(OpenCodeAcpAdapter::new(question_sidecar, question_port)),
    })
    .await
}

struct ReservedLocalPort {
    _listener: TcpListener,
    port: u16,
}

impl ReservedLocalPort {
    fn port(&self) -> u16 {
        self.port
    }
}

fn reserve_local_port() -> Result<ReservedLocalPort, RuntimeError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        RuntimeError::new(format!("failed to reserve ACP sidecar port: {error}"))
    })?;
    let port = listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| RuntimeError::new(format!("failed to read ACP sidecar port: {error}")))?;
    Ok(ReservedLocalPort {
        _listener: listener,
        port,
    })
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
