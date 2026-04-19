mod catalog;
pub mod custom_models;
mod events;
pub mod profiles;
pub mod routes;

/// Provider ID used to look up the Claude Code adapter in the provider
/// registry. Centralised so the string doesn't get sprinkled across the
/// codebase.
pub const PROVIDER_ID: &str = "claude_code";

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;

use self::catalog::fallback_models;
use self::events::{context_window_for_model_from_raw, normalize_event};
use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMcpServerConfig,
    RuntimeMessageRx, RuntimePermissionMode, RuntimeSpawnConfig, RuntimeToolPermissionHandler,
    RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};
use super::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

pub struct ClaudeCodeAdapter {
    /// Process-lifetime cache of the model catalog. Pre-populated with a
    /// static fallback list of the historical aliases so the UI has
    /// something to show before the CLI probe completes; replaced with the
    /// live CLI-reported list on first successful probe.
    cached_models: std::sync::OnceLock<std::sync::RwLock<Vec<ModelCatalogEntry>>>,
    /// Serialises concurrent probes and tracks whether the cached list is
    /// already authoritative (live from the CLI). Unlike `OnceCell`, this
    /// lets the probe run again after a failure or empty response — the UI
    /// would otherwise be stuck on fallback aliases until service restart.
    probe_state: tokio::sync::Mutex<ProbeState>,
}

#[derive(Default)]
struct ProbeState {
    live: bool,
}

pub static CLAUDE_CODE_ADAPTER: ClaudeCodeAdapter = ClaudeCodeAdapter {
    cached_models: std::sync::OnceLock::new(),
    probe_state: tokio::sync::Mutex::const_new(ProbeState { live: false }),
};

pub struct ClaudeCodeSession {
    query: claude_agent_sdk_rs::Query,
}

impl ClaudeCodeSession {
    #[cfg(test)]
    pub(crate) fn from_query(query: claude_agent_sdk_rs::Query) -> Self {
        Self { query }
    }
}

struct ClaudeCanUseToolAdapter {
    inner: std::sync::Arc<dyn RuntimeToolPermissionHandler>,
}

#[async_trait]
impl claude_agent_sdk_rs::CanUseTool for ClaudeCanUseToolAdapter {
    async fn can_use_tool(
        &self,
        request: claude_agent_sdk_rs::PermissionRequest,
    ) -> claude_agent_sdk_rs::PermissionResult {
        match self
            .inner
            .can_use_tool(RuntimeToolPermissionRequest {
                tool_name: request.tool_name,
                tool_use_id: request.tool_use_id,
                input: request.input,
            })
            .await
        {
            RuntimeToolPermissionResult::Allow {
                updated_input,
                updated_permissions,
                tool_use_id,
            } => claude_agent_sdk_rs::PermissionResult::Allow {
                updated_input,
                updated_permissions: updated_permissions.map(|updates| {
                    updates
                        .into_iter()
                        .map(|update| claude_agent_sdk_rs::PermissionUpdate { data: update.data })
                        .collect()
                }),
                tool_use_id,
            },
            RuntimeToolPermissionResult::Deny {
                message,
                interrupt,
                tool_use_id,
            } => claude_agent_sdk_rs::PermissionResult::Deny {
                message,
                interrupt,
                tool_use_id,
            },
        }
    }
}

fn map_permission_mode(mode: RuntimePermissionMode) -> claude_agent_sdk_rs::PermissionMode {
    match mode {
        RuntimePermissionMode::Default => claude_agent_sdk_rs::PermissionMode::Default,
        RuntimePermissionMode::AcceptEdits => claude_agent_sdk_rs::PermissionMode::AcceptEdits,
        RuntimePermissionMode::BypassPermissions => {
            claude_agent_sdk_rs::PermissionMode::BypassPermissions
        }
        RuntimePermissionMode::Plan => claude_agent_sdk_rs::PermissionMode::Plan,
        RuntimePermissionMode::DontAsk => claude_agent_sdk_rs::PermissionMode::DontAsk,
    }
}

fn map_mcp_server_config(
    config: RuntimeMcpServerConfig,
) -> claude_agent_sdk_rs::mcp::McpServerConfig {
    match config {
        RuntimeMcpServerConfig::Stdio { command, args, env } => {
            claude_agent_sdk_rs::mcp::McpServerConfig::Stdio { command, args, env }
        }
    }
}

#[async_trait]
impl AgentRuntimeSession for ClaudeCodeSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        let mut source_rx = self.query.take_message_rx();
        let (tx, rx) = mpsc::channel(64);

        tokio::spawn(async move {
            while let Some(msg) = source_rx.recv().await {
                let mapped = msg.map(normalize_event).map_err(RuntimeError::from);
                if tx.send(mapped).await.is_err() {
                    break;
                }
            }
        });

        rx
    }

    async fn session_id(&self) -> Option<String> {
        self.query.session_id().await
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        self.query
            .stream_input(content)
            .await
            .map_err(RuntimeError::from)
    }

    async fn interrupt(&self) -> Result<(), RuntimeError> {
        self.query.interrupt().await.map_err(RuntimeError::from)
    }

    async fn close(&mut self) {
        self.query.close().await;
    }

    async fn set_model(&self, model: &str) -> Result<(), RuntimeError> {
        self.query
            .set_model(model)
            .await
            .map_err(RuntimeError::from)
    }

    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        self.query
            .set_permission_mode(map_permission_mode(mode))
            .await
            .map_err(RuntimeError::from)
    }

    fn pid(&self) -> Option<u32> {
        self.query.pid()
    }
}

#[async_trait]
impl AgentRuntimeAdapter for ClaudeCodeAdapter {
    fn is_valid_resume_session_id(&self, session_id: &str) -> bool {
        uuid::Uuid::parse_str(session_id).is_ok()
    }

    fn resolve_resume_session_id(&self, runtime_session_id: Option<&str>) -> Option<String> {
        runtime_session_id
            .filter(|sid| uuid::Uuid::parse_str(sid).is_ok())
            .map(ToOwned::to_owned)
    }

    fn catalog_entry(&self) -> ProviderCatalogEntry {
        // Fast, sync path used for registry bootstrap and routing. The
        // authoritative catalog comes from `catalog_entry_live()`.
        let models = fallback_models();
        let default_model = Self::default_model_from(&models);
        ProviderCatalogEntry {
            id: "claude_code".to_string(),
            label: "Claude Code".to_string(),
            status: ProviderStatus::Available,
            models,
            default_model,
        }
    }

    fn spawn_startup_warmup(&self) {
        // Prime the model cache on startup so the `/api/agent-catalog`
        // endpoint serves the live CLI list on first call without paying the
        // probe latency inline.
        tokio::spawn(async {
            let _ = CLAUDE_CODE_ADAPTER.load_models().await;
        });
    }

    async fn catalog_entry_live(&self) -> ProviderCatalogEntry {
        let models = self.load_models().await;
        let default_model = Self::default_model_from(&models);
        ProviderCatalogEntry {
            id: "claude_code".to_string(),
            label: "Claude Code".to_string(),
            status: ProviderStatus::Available,
            models,
            default_model,
        }
    }

    async fn default_model_id(&self) -> Option<String> {
        ClaudeCodeAdapter::default_model_id(self).await
    }

    async fn extra_models(
        &self,
        read_pool: &sqlx::SqlitePool,
    ) -> Vec<ModelCatalogEntry> {
        match custom_models::list_custom_models(read_pool).await {
            Ok(models) => models,
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "failed to load claude_code custom models; returning empty"
                );
                Vec::new()
            }
        }
    }

    fn context_window_for_event(
        &self,
        runtime_event: &RuntimeEvent,
        active_model: Option<&str>,
    ) -> Option<u64> {
        if let Some(model) = active_model {
            if let Some(context_window) =
                context_window_for_model_from_raw(runtime_event.raw_json(), model)
            {
                return Some(context_window);
            }
        }

        runtime_event
            .context_window()
            .or_else(|| runtime_event.init().and_then(|init| init.context_window))
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        let options = claude_agent_sdk_rs::Options {
            cwd: config.cwd,
            permission_mode: config.permission_mode.map(map_permission_mode),
            model: config.model,
            effort: config.thinking_effort,
            system_prompt: config.system_prompt,
            resume: config.resume_session_id,
            mcp_servers: config.mcp_servers.map(|servers| {
                servers
                    .into_iter()
                    .map(|(name, cfg)| (name, map_mcp_server_config(cfg)))
                    .collect()
            }),
            can_use_tool: config.permission_handler.map(|handler| {
                Box::new(ClaudeCanUseToolAdapter { inner: handler })
                    as Box<dyn claude_agent_sdk_rs::CanUseTool>
            }),
            env: config.env,
            ..claude_agent_sdk_rs::Options::default()
        };

        let query = claude_agent_sdk_rs::query(content, options)
            .await
            .map_err(RuntimeError::from)?;
        Ok(Box::new(ClaudeCodeSession { query }))
    }
}

#[cfg(test)]
mod tests {
    use super::{map_permission_mode, ClaudeCodeAdapter, ProbeState};
    use crate::domain::agents::adapter::{AgentRuntimeAdapter, RuntimePermissionMode};

    fn new_test_adapter() -> ClaudeCodeAdapter {
        ClaudeCodeAdapter {
            cached_models: std::sync::OnceLock::new(),
            probe_state: tokio::sync::Mutex::new(ProbeState::default()),
        }
    }

    #[test]
    fn map_permission_mode_covers_all_variants() {
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::Default),
            claude_agent_sdk_rs::PermissionMode::Default
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::AcceptEdits),
            claude_agent_sdk_rs::PermissionMode::AcceptEdits
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::BypassPermissions),
            claude_agent_sdk_rs::PermissionMode::BypassPermissions
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::Plan),
            claude_agent_sdk_rs::PermissionMode::Plan
        );
        assert_eq!(
            map_permission_mode(RuntimePermissionMode::DontAsk),
            claude_agent_sdk_rs::PermissionMode::DontAsk
        );
    }

    #[test]
    fn adapter_resume_id_validation_is_uuid_only() {
        let adapter = new_test_adapter();
        assert!(adapter.is_valid_resume_session_id("11111111-1111-4111-8111-111111111111"));
        assert!(!adapter.is_valid_resume_session_id("ses_27f586910ffeUNaKL2l5UARerl"));
    }
}
