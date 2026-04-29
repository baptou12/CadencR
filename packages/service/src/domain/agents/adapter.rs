use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone)]
pub struct RuntimeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl RuntimeUsage {
    pub fn is_zero(&self) -> bool {
        self.input_tokens == 0 && self.output_tokens == 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimePermissionMode {
    Default,
    AcceptEdits,
    BypassPermissions,
    Plan,
    DontAsk,
}

#[derive(Debug, Clone)]
pub enum RuntimeMcpServerConfig {
    Stdio {
        command: String,
        args: Option<Vec<String>>,
        env: Option<HashMap<String, String>>,
    },
}

#[derive(Debug, Clone)]
pub struct RuntimeMcpServerStatus {
    pub name: String,
    pub status: String,
}

pub struct RuntimeSpawnConfig {
    pub cwd: PathBuf,
    pub permission_mode: Option<RuntimePermissionMode>,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
    pub system_prompt: Option<String>,
    pub resume_session_id: Option<String>,
    pub mcp_servers: Option<HashMap<String, RuntimeMcpServerConfig>>,
    pub permission_handler: Option<Arc<dyn RuntimeToolPermissionHandler>>,
    /// Extra env vars injected into the spawned runtime. Adapters decide how
    /// to apply this (Claude Code merges it into the CLI subprocess env;
    /// OpenCode currently ignores it since it speaks HTTP).
    pub env: Option<HashMap<String, String>>,
}

impl Default for RuntimeSpawnConfig {
    fn default() -> Self {
        Self {
            cwd: PathBuf::new(),
            permission_mode: None,
            model: None,
            thinking_effort: None,
            system_prompt: None,
            resume_session_id: None,
            mcp_servers: None,
            permission_handler: None,
            env: None,
        }
    }
}

#[derive(Debug)]
pub enum RuntimeError {
    /// Generic runtime failure with a free-form message.
    Generic(String),
    /// The provider's CLI binary could not be located on disk. Carries the
    /// directories that were probed so the host can render an actionable
    /// message and prompt the user to set an explicit path via onboarding.
    CliNotFound {
        provider: &'static str,
        searched: Vec<PathBuf>,
    },
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Generic(message) => f.write_str(message),
            Self::CliNotFound { provider, searched } => {
                write!(
                    f,
                    "{provider} CLI not found; searched {} location(s)",
                    searched.len()
                )
            }
        }
    }
}

impl std::error::Error for RuntimeError {}

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self::Generic(message.into())
    }

    /// Build a structured "CLI not found" error so the host can surface an
    /// actionable message + a link to the binary picker in onboarding.
    pub fn cli_not_found(provider: &'static str, searched: Vec<PathBuf>) -> Self {
        Self::CliNotFound { provider, searched }
    }
}

impl From<claude_agent_sdk_rs::SdkError> for RuntimeError {
    fn from(value: claude_agent_sdk_rs::SdkError) -> Self {
        match value {
            claude_agent_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("claude", searched)
            }
            other => Self::Generic(other.to_string()),
        }
    }
}

impl From<opencode_sdk_rs::SdkError> for RuntimeError {
    fn from(value: opencode_sdk_rs::SdkError) -> Self {
        Self::Generic(value.to_string())
    }
}

impl From<codex_app_server_sdk_rs::SdkError> for RuntimeError {
    fn from(value: codex_app_server_sdk_rs::SdkError) -> Self {
        match value {
            codex_app_server_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("codex", searched)
            }
            other => Self::Generic(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePermissionDecision {
    AllowOnce,
    AllowFuture,
    Deny,
}

#[derive(Debug, Clone)]
pub struct RuntimePermissionResponse {
    pub request_id: String,
    pub decision: RuntimePermissionDecision,
    pub feedback: Option<String>,
    pub updated_input: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePermissionResponseKind {
    Normal,
    ContinueOnDeny,
    PlanApproval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeSlashCommandDiscovery {
    LocalFilesystem,
    RuntimeNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeCompactionStrategy {
    LiveRuntime,
    SummaryReplay,
}

#[derive(Debug, Clone)]
pub struct RuntimePermissionRequest {
    pub request_id: String,
    /// Runtime-side identifier of the specific tool invocation being gated —
    /// `call_...` on OpenCode; maps to the `tool_use_id` column used when
    /// updating `agent_messages` rows. Absent when the runtime doesn't
    /// surface one (Claude Code doesn't surface these permission events at
    /// all; it uses the direct `can_use_tool` hook instead).
    pub tool_use_id: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
    pub description: Option<String>,
    pub pattern: Option<String>,
    pub preview: Option<String>,
    pub options: Vec<RuntimePermissionOption>,
}

#[derive(Debug, Clone)]
pub struct RuntimePermissionOption {
    pub decision: RuntimePermissionDecision,
    pub label: String,
    pub description: String,
    pub collect_feedback: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeToolPermissionRequest {
    pub tool_name: String,
    pub tool_use_id: String,
    pub input: Value,
}

#[derive(Debug, Clone)]
pub struct RuntimePermissionUpdate {
    pub data: Value,
}

#[derive(Debug, Clone)]
pub enum RuntimeToolPermissionResult {
    Allow {
        updated_input: Value,
        updated_permissions: Option<Vec<RuntimePermissionUpdate>>,
        tool_use_id: Option<String>,
    },
    Deny {
        message: String,
        interrupt: Option<bool>,
        tool_use_id: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct RuntimeEvent {
    metadata: RuntimeEventMetadata,
    kind: RuntimeEventKind,
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeEventMetadata {
    pub session_id: Option<String>,
    pub usage: Option<RuntimeUsage>,
    /// Authoritative context window reported by the provider for this turn
    /// (e.g. from Claude Code's `result.modelUsage[model].contextWindow`).
    /// Populated on turn-complete events; `None` on intermediate events.
    pub context_window: Option<u64>,
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub enum RuntimeEventKind {
    Init(RuntimeInitEvent),
    AssistantMessage {
        message: RuntimeAssistantMessage,
        parent_tool_use_id: Option<String>,
    },
    UserMessage {
        message: RuntimeUserMessage,
        parent_tool_use_id: Option<String>,
    },
    StreamEvent {
        event: RuntimeStreamEvent,
        parent_tool_use_id: Option<String>,
    },
    ToolUseSummary {
        data: Value,
    },
    Result,
    CompactBoundary {
        metadata: Option<RuntimeCompactMetadata>,
    },
    Other,
}

/// Provider-neutral metadata captured from a compaction boundary event.
///
/// Cadencr persists this alongside the `compact_divider` block so the UI can
/// surface why the compaction happened and how many tokens were freed.
#[derive(Debug, Clone, Default, Serialize)]
pub struct RuntimeCompactMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct RuntimeInitEvent {
    pub model: Option<String>,
    pub mcp_servers: Vec<RuntimeMcpServerStatus>,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct RuntimeAssistantMessage {
    pub model: Option<String>,
    pub content: Vec<RuntimeContentBlock>,
}

#[derive(Debug, Clone)]
pub struct RuntimeUserMessage {
    pub content: Vec<RuntimeUserContentBlock>,
}

#[derive(Debug, Clone)]
pub enum RuntimeContentBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    Other,
}

#[derive(Debug, Clone)]
pub enum RuntimeUserContentBlock {
    ToolResult {
        tool_use_id: Option<String>,
        is_error: bool,
        content: Value,
    },
    Other,
}

#[derive(Debug, Clone)]
pub enum RuntimeStreamEvent {
    MessageStart {
        model: Option<String>,
        input_tokens: Option<u64>,
    },
    ContentBlockStart {
        index: u32,
        block: RuntimeContentBlock,
    },
    ContentBlockDelta {
        index: u32,
        delta: RuntimeContentDelta,
    },
    ContentBlockStop {
        index: u32,
    },
    Other,
}

#[derive(Debug, Clone)]
pub enum RuntimeContentDelta {
    Text { text: String },
    Thinking { thinking: String },
    InputJson { partial_json: String },
}

impl RuntimeEvent {
    pub fn new(metadata: RuntimeEventMetadata, kind: RuntimeEventKind) -> Self {
        Self { metadata, kind }
    }

    pub fn session_id(&self) -> Option<&str> {
        self.metadata.session_id.as_deref()
    }

    pub fn usage(&self) -> Option<&RuntimeUsage> {
        self.metadata.usage.as_ref()
    }

    pub fn context_window(&self) -> Option<u64> {
        self.metadata.context_window
    }

    pub fn is_result(&self) -> bool {
        matches!(self.kind, RuntimeEventKind::Result)
    }

    pub fn raw_json(&self) -> &Value {
        &self.metadata.raw
    }

    pub fn init(&self) -> Option<&RuntimeInitEvent> {
        match &self.kind {
            RuntimeEventKind::Init(init) => Some(init),
            _ => None,
        }
    }

    pub fn assistant_message(&self) -> Option<&RuntimeAssistantMessage> {
        match &self.kind {
            RuntimeEventKind::AssistantMessage { message, .. } => Some(message),
            _ => None,
        }
    }

    pub fn user_message(&self) -> Option<&RuntimeUserMessage> {
        match &self.kind {
            RuntimeEventKind::UserMessage { message, .. } => Some(message),
            _ => None,
        }
    }

    pub fn parent_tool_use_id(&self) -> Option<&str> {
        match &self.kind {
            RuntimeEventKind::AssistantMessage {
                parent_tool_use_id, ..
            }
            | RuntimeEventKind::UserMessage {
                parent_tool_use_id, ..
            }
            | RuntimeEventKind::StreamEvent {
                parent_tool_use_id, ..
            } => parent_tool_use_id.as_deref(),
            _ => None,
        }
    }

    pub fn stream_event(&self) -> Option<&RuntimeStreamEvent> {
        match &self.kind {
            RuntimeEventKind::StreamEvent { event, .. } => Some(event),
            _ => None,
        }
    }

    pub fn tool_use_summary_data(&self) -> Option<&Value> {
        match &self.kind {
            RuntimeEventKind::ToolUseSummary { data } => Some(data),
            _ => None,
        }
    }

    pub fn is_compact_boundary(&self) -> bool {
        matches!(self.kind, RuntimeEventKind::CompactBoundary { .. })
    }

    pub fn compact_metadata(&self) -> Option<&RuntimeCompactMetadata> {
        match &self.kind {
            RuntimeEventKind::CompactBoundary { metadata } => metadata.as_ref(),
            _ => None,
        }
    }
}

pub type RuntimeMessageRx = mpsc::Receiver<Result<RuntimeEvent, RuntimeError>>;
pub type RuntimeSessionHandle = Arc<Mutex<Box<dyn AgentRuntimeSession>>>;

#[async_trait]
pub trait RuntimeToolPermissionHandler: Send + Sync {
    async fn can_use_tool(
        &self,
        request: RuntimeToolPermissionRequest,
    ) -> RuntimeToolPermissionResult;
}

#[async_trait]
pub trait AgentRuntimeSession: Send + Sync {
    fn take_message_rx(&mut self) -> RuntimeMessageRx;
    fn context_window(&self) -> Option<u64> {
        None
    }
    fn runtime_control_endpoint(&self) -> Option<String> {
        None
    }
    async fn session_id(&self) -> Option<String>;
    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError>;
    async fn interrupt(&self) -> Result<(), RuntimeError>;
    async fn compact(&self) -> Result<(), RuntimeError> {
        Err(RuntimeError::new(
            "compaction is not supported by this runtime",
        ))
    }
    async fn close(&mut self);
    async fn set_model(&self, model: &str) -> Result<(), RuntimeError>;
    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError>;
    fn applies_thinking_effort_in_place(&self) -> bool {
        false
    }
    async fn set_thinking_effort(&self, _effort: Option<String>) -> Result<(), RuntimeError> {
        Ok(())
    }
    async fn respond_permission(
        &self,
        _response: RuntimePermissionResponse,
    ) -> Result<(), RuntimeError> {
        Err(RuntimeError::new(
            "permission responses are not supported by this runtime",
        ))
    }
    fn permission_response_kind(&self, _request_id: &str) -> RuntimePermissionResponseKind {
        RuntimePermissionResponseKind::Normal
    }
    fn pid(&self) -> Option<u32>;
}

#[async_trait]
pub trait AgentRuntimeAdapter: Send + Sync {
    async fn init(&self) -> Result<(), RuntimeError> {
        Ok(())
    }

    fn is_valid_resume_session_id(&self, _session_id: &str) -> bool {
        true
    }

    fn parse_permission_request(&self, _raw: &Value) -> Option<RuntimePermissionRequest> {
        None
    }

    /// Returns true if this adapter should handle the given model string.
    /// Used for automatic provider routing when the user selects a model.
    fn accepts_model(&self, _model: &str) -> bool {
        false
    }

    /// Resolve a resume session ID from the DB-stored runtime_session_id.
    /// The default accepts any string. Override to apply validation (e.g. UUID-only).
    fn resolve_resume_session_id(&self, runtime_session_id: Option<&str>) -> Option<String> {
        runtime_session_id.map(ToOwned::to_owned)
    }

    /// Static catalog entry (available immediately at startup).
    fn catalog_entry(&self) -> super::runtime::ProviderCatalogEntry;

    /// Live catalog entry (may fetch from external service). Defaults to static.
    async fn catalog_entry_live(&self) -> super::runtime::ProviderCatalogEntry {
        self.catalog_entry()
    }

    /// Extra models contributed by user configuration (e.g. custom Claude Code
    /// model aliases stored in SQLite). Returned entries are merged into the
    /// adapter's catalog; on id collision the user entry wins.
    async fn extra_models(
        &self,
        _read_pool: &sqlx::SqlitePool,
    ) -> Vec<super::runtime::ModelCatalogEntry> {
        Vec::new()
    }

    /// Preferred default model id for this provider.
    ///
    /// Defaults to the static catalog entry so shared callers can stay
    /// provider-neutral. Providers with live catalogs (like Claude Code)
    /// should override this.
    async fn default_model_id(&self) -> Option<String> {
        self.catalog_entry().default_model
    }

    /// Provider-known context window for a given model id, if the provider
    /// can answer synchronously (e.g. opencode exposes this via its server).
    /// Defaults to `None` — callers must fall back to another source
    /// (usually history persisted from prior `result` events).
    async fn context_window_for_model(&self, _model_id: &str) -> Option<u64> {
        None
    }

    /// Extract an authoritative context window for the current event.
    ///
    /// The default implementation stays provider-neutral by relying only on
    /// normalized metadata/init values. Providers with richer wire formats can
    /// override this and inspect their raw payloads in the adapter layer.
    fn context_window_for_event(
        &self,
        runtime_event: &RuntimeEvent,
        _active_model: Option<&str>,
    ) -> Option<u64> {
        runtime_event
            .context_window()
            .or_else(|| runtime_event.init().and_then(|init| init.context_window))
    }

    /// Called once at startup for background warmup (e.g. starting sidecar processes).
    fn spawn_startup_warmup(&self) {}

    fn slash_command_discovery(&self) -> RuntimeSlashCommandDiscovery {
        RuntimeSlashCommandDiscovery::LocalFilesystem
    }

    fn compaction_strategy(&self) -> Option<RuntimeCompactionStrategy> {
        None
    }

    fn supports_builtin_compact_command(&self) -> bool {
        self.compaction_strategy().is_some()
    }

    async fn session_finished(&self, _runtime_session_id: &str) -> bool {
        false
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError>;
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde_json::json;
    use tokio::sync::{mpsc, Mutex};

    use super::{
        AgentRuntimeAdapter, AgentRuntimeSession, RuntimeError, RuntimeMessageRx,
        RuntimePermissionDecision, RuntimePermissionResponse, RuntimeSpawnConfig,
    };

    struct DummySession;

    #[async_trait]
    impl AgentRuntimeSession for DummySession {
        fn take_message_rx(&mut self) -> RuntimeMessageRx {
            let (_tx, rx) = mpsc::channel(1);
            rx
        }

        async fn session_id(&self) -> Option<String> {
            Some("dummy".to_string())
        }

        async fn stream_input(&self, _content: serde_json::Value) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn interrupt(&self) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn close(&mut self) {}

        async fn set_model(&self, _model: &str) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn set_permission_mode(
            &self,
            _mode: super::RuntimePermissionMode,
        ) -> Result<(), RuntimeError> {
            Ok(())
        }

        async fn set_thinking_effort(&self, _effort: Option<String>) -> Result<(), RuntimeError> {
            Ok(())
        }

        fn pid(&self) -> Option<u32> {
            None
        }
    }

    struct DummyAdapter;

    #[async_trait]
    impl AgentRuntimeAdapter for DummyAdapter {
        fn catalog_entry(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
            crate::domain::agents::runtime::ProviderCatalogEntry {
                id: "dummy".to_string(),
                label: "Dummy".to_string(),
                status: crate::domain::agents::runtime::ProviderStatus::Available,
                status_message: None,
                models: vec![],
                default_model: None,
            }
        }

        async fn spawn(
            &self,
            _content: serde_json::Value,
            _config: RuntimeSpawnConfig,
        ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
            Ok(Box::new(DummySession))
        }
    }

    #[tokio::test]
    async fn adapter_defaults_are_provider_neutral() {
        let adapter = DummyAdapter;
        assert!(adapter.is_valid_resume_session_id("anything"));
        assert!(adapter
            .parse_permission_request(&json!({"type": "none"}))
            .is_none());

        let spawned = adapter
            .spawn(serde_json::Value::Null, RuntimeSpawnConfig::default())
            .await
            .expect("spawn should succeed");
        let query = Mutex::new(spawned);
        assert_eq!(
            query.lock().await.session_id().await.as_deref(),
            Some("dummy")
        );
    }

    #[tokio::test]
    async fn session_default_permission_response_is_unsupported() {
        let session = DummySession;
        let error = session
            .respond_permission(RuntimePermissionResponse {
                request_id: "req".to_string(),
                decision: RuntimePermissionDecision::AllowOnce,
                feedback: None,
                updated_input: None,
            })
            .await
            .expect_err("default session permission response should be unsupported");

        assert!(error
            .to_string()
            .contains("permission responses are not supported"));
    }
}
