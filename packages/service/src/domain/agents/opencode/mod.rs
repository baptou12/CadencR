mod acp;
pub(crate) mod events;
mod mcp_config;
mod model;
pub(crate) mod permissions;
mod prompt_parts;
mod questions;
mod session;
mod session_resolution;
mod stream_loop;
mod stream_state;
mod stream_supervisor;
mod stream_synthesizer;
mod tool_names;
mod worktree_config;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenCodeTransport {
    Http,
    Acp,
}

/// Default transport when `CADENCR_OPENCODE_TRANSPORT` is unset or
/// unrecognised. `cfg!(debug_assertions)` is `true` for `cargo run` /
/// `pnpm dev` builds and `false` for `cargo build --release` / packaged
/// Electron sidecars — same convention used elsewhere in the service
/// (`main.rs`, `api/middleware/ws.rs`) to gate dev-only behaviour.
fn default_transport() -> OpenCodeTransport {
    if cfg!(debug_assertions) {
        OpenCodeTransport::Acp
    } else {
        OpenCodeTransport::Http
    }
}

fn opencode_transport_env() -> OpenCodeTransport {
    // TEMP-ACP-FORCE: hardcoded to ACP while we debug the new transport.
    // The env-var indirection (and the HTTP fallback) lives behind this
    // early return so tests + future toggles stay intact. Remove together
    // with the wire-trace logs once ACP parity is verified.
    return OpenCodeTransport::Acp;
    #[allow(unreachable_code)]
    match std::env::var("CADENCR_OPENCODE_TRANSPORT")
        .ok()
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("acp") => OpenCodeTransport::Acp,
        Some("http") => OpenCodeTransport::Http,
        None | Some("") => default_transport(),
        Some(other) => {
            tracing::warn!(
                value = other,
                default = ?default_transport(),
                "unrecognised CADENCR_OPENCODE_TRANSPORT value; using default for build"
            );
            default_transport()
        }
    }
}

use async_trait::async_trait;
use serde_json::Value;

pub(crate) use self::model::parse_model_ref;
use self::model::permission_mode_agent;
use self::permissions::{
    parse_permission_request as parse_opencode_permission_request, permission_options,
};
use self::session::OpenCodeSession;
use self::session_resolution::resolve_session_id;
use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeCompactionStrategy, RuntimeError,
    RuntimePermissionRequest, RuntimeSlashCommand, RuntimeSlashCommandKind, RuntimeSpawnConfig,
};
use super::response_style::rich_markdown_system_prompt;

pub struct OpenCodeAdapter;

pub static OPENCODE_ADAPTER: OpenCodeAdapter = OpenCodeAdapter;
pub const PROVIDER_ID: &str = "opencode";

fn decorate_system_prompt(system_prompt: Option<&str>) -> Option<String> {
    Some(rich_markdown_system_prompt(system_prompt))
}

#[async_trait]
impl AgentRuntimeAdapter for OpenCodeAdapter {
    fn parse_permission_request(&self, raw: &Value) -> Option<RuntimePermissionRequest> {
        parse_opencode_permission_request(raw).map(|request| RuntimePermissionRequest {
            request_id: request.request_id,
            tool_use_id: request.call_id,
            tool_name: request.tool_name,
            tool_input: request.tool_input,
            description: request.description,
            pattern: None,
            preview: request.preview,
            options: request.options.unwrap_or_else(permission_options),
        })
    }

    fn accepts_model(&self, model: &str) -> bool {
        crate::domain::agents::model_refs::is_opencode_model_ref(model)
    }

    fn catalog_entry(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
        super::providers::opencode::catalog_entry()
    }

    async fn catalog_entry_live(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
        super::providers::opencode::catalog_entry_live().await
    }

    async fn context_window_for_model(&self, model_id: &str) -> Option<u64> {
        super::providers::opencode::context_window_for_model(model_id).await
    }

    fn spawn_startup_warmup(&self) {
        if !crate::domain::agents::providers::opencode::should_warmup_on_start() {
            tracing::info!("opencode startup warmup disabled by CADENCR_OPENCODE_WARMUP_ON_START");
            return;
        }
        tokio::spawn(async {
            if let Err(error) = OPENCODE_ADAPTER.init().await {
                tracing::warn!(error = %error, "opencode startup warmup failed");
            } else {
                tracing::info!("opencode startup warmup completed");
            }
        });
    }

    fn worktree_config_paths(&self) -> &'static [&'static str] {
        worktree_config::CONFIG_PATHS
    }

    async fn runtime_slash_commands(
        &self,
        cwd: &str,
    ) -> Result<Vec<RuntimeSlashCommand>, RuntimeError> {
        let client = opencode_sdk_rs::OpenCodeClient::init()
            .await
            .map_err(RuntimeError::from)?;
        let commands = client
            .list_commands_in_directory(Some(cwd))
            .await
            .map_err(RuntimeError::from)?;

        Ok(commands
            .into_iter()
            .map(|command| RuntimeSlashCommand {
                name: command.name,
                description: command.description,
                kind: RuntimeSlashCommandKind::Command,
            })
            .collect())
    }

    fn compaction_strategy(&self) -> Option<RuntimeCompactionStrategy> {
        // TODO: switch back to `SummaryReplay` once OpenCode's ACP transport
        // advertises `loadSession` / `session/load` so we can re-hydrate a
        // truncated transcript. Today the ACP subprocess is session-scoped
        // and there's no spec'd way to replay a summary back into it, so
        // SummaryReplay would silently lose context. The HTTP transport
        // still rebuilds via the shared session log, so it gets
        // SummaryReplay; ACP relies on the agent's own
        // context-window tracking (surfaced via the `usage_update`
        // notification → `RuntimeEventMetadata.context_window`).
        match opencode_transport_env() {
            OpenCodeTransport::Acp => Some(RuntimeCompactionStrategy::LiveRuntime),
            OpenCodeTransport::Http => Some(RuntimeCompactionStrategy::SummaryReplay),
        }
    }

    fn supports_permission_mode(
        &self,
        mode: &crate::domain::agents::adapter::RuntimePermissionMode,
    ) -> bool {
        // OpenCode primary agents are `build` (default/acceptEdits) and `plan`.
        // Auto / Bypass / DontAsk have no equivalent.
        use crate::domain::agents::adapter::RuntimePermissionMode;
        matches!(
            mode,
            RuntimePermissionMode::Default
                | RuntimePermissionMode::AcceptEdits
                | RuntimePermissionMode::Plan
        )
    }
    // Default `default_permission_mode_wire` ("acceptEdits") maps to OpenCode's
    // `build` agent in the adapter — see `permission_mode_agent` in model.rs.

    async fn session_finished(&self, runtime_session_id: &str) -> bool {
        // Dispatch to the transport-owning module. Each transport answers
        // for itself — the HTTP module probes OpenCode's HTTP server, the
        // ACP module returns false since process exit is signalled via
        // `AcpEvent::ProcessExited`. When the HTTP transport is removed,
        // the `Http` arm goes with it; the ACP arm is untouched.
        match opencode_transport_env() {
            OpenCodeTransport::Acp => acp::session_finished(runtime_session_id).await,
            OpenCodeTransport::Http => {
                crate::domain::agents::providers::opencode::session_finished(runtime_session_id)
                    .await
            }
        }
    }

    async fn session_finished_text(&self, runtime_session_id: &str) -> Option<String> {
        crate::domain::agents::providers::opencode::session_finished_text(runtime_session_id).await
    }

    async fn init(&self) -> Result<(), RuntimeError> {
        let _ = opencode_sdk_rs::OpenCodeClient::init()
            .await
            .map_err(RuntimeError::from)?;
        Ok(())
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        let transport = opencode_transport_env();
        tracing::info!(?transport, "selecting opencode transport");
        if matches!(transport, OpenCodeTransport::Acp) {
            return acp::spawn_acp_session(content, config).await;
        }

        // OpenCode can't attach MCP servers per-session like the Claude CLI can —
        // it reads them from opencode.json under the request directory, so the
        // entries must be on disk before `ensure_running` caches the config.
        let mcp_server_names: Vec<String> = match config.mcp_servers.as_ref() {
            Some(servers) if !servers.is_empty() => {
                mcp_config::ensure_worktree_opencode_config(&config.cwd, servers)
                    .await
                    .map_err(|e| {
                        RuntimeError::new(format!(
                            "failed to materialize opencode.json in {}: {e}",
                            config.cwd.display()
                        ))
                    })?;
                servers.keys().cloned().collect()
            }
            _ => Vec::new(),
        };

        let server = opencode_sdk_rs::OpenCodeServer::ensure_running()
            .await
            .map_err(RuntimeError::from)?;
        let client = opencode_sdk_rs::OpenCodeClient::with_base_url(server.base_url.clone());
        let directory = config.cwd.to_string_lossy().to_string();
        let dispatcher =
            opencode_sdk_rs::shared_dispatcher(client.clone(), Some(directory.clone())).await;

        let current_model = config.model.as_deref().and_then(parse_model_ref);
        let context_window = match config.model.as_deref() {
            Some(model_id) => super::providers::opencode::context_window_for_model(model_id).await,
            None => None,
        };
        let current_agent = permission_mode_agent(config.permission_mode.clone()).to_string();
        let system_prompt = decorate_system_prompt(config.system_prompt.as_deref());
        let session_id = resolve_session_id(&client, &directory, config.resume_session_id).await?;
        let event_rx = dispatcher.subscribe(&session_id).await;
        let mut session = OpenCodeSession::new(
            client,
            dispatcher,
            session_id,
            current_agent,
            current_model,
            config.thinking_effort,
            directory,
            system_prompt,
            event_rx,
            server.pid,
            context_window,
        );
        session.set_expected_mcp_servers(mcp_server_names);
        session.dispatch_input(content).await?;
        Ok(Box::new(session))
    }
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use axum::{
        response::sse::{Event, Sse},
        routing::{get, post},
        Json, Router,
    };
    use futures::stream::iter;
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    use super::{
        decorate_system_prompt, default_transport, opencode_transport_env,
        session::OpenCodeSession, OpenCodeAdapter, OpenCodeTransport,
    };
    use crate::domain::agents::adapter::{AgentRuntimeAdapter, AgentRuntimeSession};
    use crate::domain::agents::response_style::RICH_MARKDOWN_INSTRUCTION;

    static TRANSPORT_ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_transport_env<F: FnOnce()>(value: Option<&str>, f: F) {
        let _g = TRANSPORT_ENV_GUARD
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let prev = std::env::var("CADENCR_OPENCODE_TRANSPORT").ok();
        match value {
            Some(v) => std::env::set_var("CADENCR_OPENCODE_TRANSPORT", v),
            None => std::env::remove_var("CADENCR_OPENCODE_TRANSPORT"),
        }
        f();
        match prev {
            Some(v) => std::env::set_var("CADENCR_OPENCODE_TRANSPORT", v),
            None => std::env::remove_var("CADENCR_OPENCODE_TRANSPORT"),
        }
    }

    #[test]
    fn default_transport_is_acp_in_debug_builds() {
        // Tests always run in debug mode (`cargo test` keeps
        // `debug_assertions = true`), so this asserts the dev default.
        assert_eq!(default_transport(), OpenCodeTransport::Acp);
    }

    #[test]
    fn transport_env_defaults_to_build_default_when_unset() {
        with_transport_env(None, || {
            assert_eq!(opencode_transport_env(), default_transport());
        });
    }

    #[test]
    fn transport_env_acp_is_recognised_case_insensitively() {
        with_transport_env(Some("ACP"), || {
            assert_eq!(opencode_transport_env(), OpenCodeTransport::Acp);
        });
        with_transport_env(Some("acp"), || {
            assert_eq!(opencode_transport_env(), OpenCodeTransport::Acp);
        });
    }

    #[test]
    #[ignore = "TEMP-ACP-FORCE: opencode_transport_env is hardcoded to Acp while we debug the ACP transport; re-enable once the early return is removed"]
    fn transport_env_explicit_http_overrides_dev_default() {
        with_transport_env(Some("http"), || {
            assert_eq!(opencode_transport_env(), OpenCodeTransport::Http);
        });
    }

    #[test]
    fn transport_env_unknown_value_falls_back_to_build_default() {
        with_transport_env(Some("websocket"), || {
            assert_eq!(opencode_transport_env(), default_transport());
        });
    }

    #[test]
    fn adapter_parses_opencode_permission_request() {
        let adapter = OpenCodeAdapter;
        let parsed = adapter
            .parse_permission_request(&json!({
                "type": "opencode_permission_request",
                "request_id": "req-1",
                "tool_name": "Read",
                "tool_input": { "filePath": "README.md" },
                "description": "Read file"
            }))
            .expect("expected permission request");

        assert_eq!(parsed.request_id, "req-1");
        assert_eq!(parsed.tool_name, "Read");
        assert_eq!(parsed.tool_input, json!({ "filePath": "README.md" }));
        assert_eq!(parsed.description.as_deref(), Some("Read file"));
        assert_eq!(parsed.pattern, None);
        assert_eq!(parsed.preview.as_deref(), Some("README.md"));
        assert_eq!(parsed.options.len(), 3);
    }

    #[test]
    fn adapter_ignores_non_permission_events() {
        let adapter = OpenCodeAdapter;
        assert!(adapter
            .parse_permission_request(&json!({ "type": "other_event" }))
            .is_none());
    }

    #[test]
    fn decorate_system_prompt_prepends_markdown_instruction() {
        let prompt = decorate_system_prompt(Some("Base prompt")).unwrap();
        assert!(prompt.starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(prompt.ends_with("Base prompt"));
    }

    #[test]
    fn decorate_system_prompt_uses_instruction_when_base_prompt_missing() {
        let prompt = decorate_system_prompt(None).unwrap();
        assert_eq!(prompt, RICH_MARKDOWN_INSTRUCTION);
    }

    #[tokio::test]
    async fn opencode_stream_input_surfaces_prompt_dispatch_errors() {
        async fn prompt_async() -> (axum::http::StatusCode, Json<serde_json::Value>) {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "name": "UnknownError",
                    "data": { "message": "prompt failed" }
                })),
            )
        }

        async fn event() -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
            Sse::new(iter(Vec::<Result<Event, Infallible>>::new()))
        }

        let app = Router::new()
            .route("/session/{id}/prompt_async", post(prompt_async))
            .route("/event", get(event));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = opencode_sdk_rs::OpenCodeClient::with_base_url(format!("http://{addr}"));
        let dispatcher =
            opencode_sdk_rs::shared_dispatcher(client.clone(), Some("/tmp/worktree".to_string()))
                .await;
        let (_event_tx, event_rx) = mpsc::unbounded_channel();
        let session = OpenCodeSession::new(
            client,
            dispatcher,
            "ses_1".to_string(),
            "build".to_string(),
            None,
            None,
            "/tmp/worktree".to_string(),
            None,
            event_rx,
            None,
            None,
        );

        let error = session
            .stream_input(serde_json::Value::String("hello".to_string()))
            .await
            .expect_err("expected immediate dispatch error");
        assert!(error.to_string().contains("prompt failed"));
    }
}
