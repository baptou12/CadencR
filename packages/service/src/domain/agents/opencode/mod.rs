pub(in crate::domain::agents) mod acp;
pub(crate) mod events;
pub(crate) mod permissions;
mod questions;
mod stream_synthesizer;
mod tool_names;
mod worktree_config;
use async_trait::async_trait;
use serde_json::Value;

use self::permissions::{
    parse_permission_request as parse_opencode_permission_request, permission_options,
};
use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeCompactionStrategy, RuntimeError,
    RuntimePermissionRequest, RuntimeSlashCommand, RuntimeSpawnConfig,
};

pub struct OpenCodeAdapter;

pub static OPENCODE_ADAPTER: OpenCodeAdapter = OpenCodeAdapter;
pub const PROVIDER_ID: &str = "opencode";

#[async_trait]
impl AgentRuntimeAdapter for OpenCodeAdapter {
    fn is_valid_resume_session_id(&self, _session_id: &str) -> bool {
        // ACP sessions are subprocess-scoped; resume ids are never valid
        // across spawns.
        false
    }

    fn resolve_resume_session_id(&self, _runtime_session_id: Option<&str>) -> Option<String> {
        None
    }

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

    async fn default_model_id(&self) -> Option<String> {
        super::providers::opencode::default_model_id().await
    }

    fn spawn_startup_warmup(&self) {
        // Warm the live catalog cache off the request path. The probe
        // spawns a short-lived `opencode acp` subprocess; running it at
        // startup means the first FE provider-picker render hits a
        // populated cache instead of waiting on a fresh probe.
        tokio::spawn(async {
            let _ = super::providers::opencode::catalog_entry_live().await;
        });
    }

    fn worktree_config_paths(&self) -> &'static [&'static str] {
        worktree_config::CONFIG_PATHS
    }

    async fn runtime_slash_commands(
        &self,
        _cwd: &str,
    ) -> Result<Vec<RuntimeSlashCommand>, RuntimeError> {
        // OpenCode's ACP wire doesn't expose slash-command discovery today.
        // Return an empty list rather than the trait default's "not supported"
        // error so the resolver doesn't log a per-session warning. When the
        // ACP wire (or the embedded HTTP backend used by `upstream_workaround/`)
        // grows a way to enumerate commands, wire it in here.
        Ok(Vec::new())
    }

    fn compaction_strategy(&self) -> Option<RuntimeCompactionStrategy> {
        // ACP subprocess is session-scoped and there's no spec'd way to
        // replay a summary back into it, so SummaryReplay would silently
        // lose context. Use LiveRuntime, which relies on the agent's own
        // context-window tracking (surfaced via the `usage_update`
        // notification → `RuntimeEventMetadata.context_window`).
        Some(RuntimeCompactionStrategy::LiveRuntime)
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
        // ACP signals subprocess exit through `AcpEvent::ProcessExited` on
        // the runtime channel; the session-finished probe always answers
        // "no" since a finished agent turn isn't the same as a finished
        // session (the subprocess stays alive across turns).
        acp::session_finished(runtime_session_id).await
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        acp::spawn_acp_session(content, config).await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::OpenCodeAdapter;
    use crate::domain::agents::adapter::AgentRuntimeAdapter;

    #[test]
    fn acp_rejects_resume_session_ids() {
        // ACP sessions are subprocess-scoped; resume ids never round-trip.
        let adapter = OpenCodeAdapter;
        assert!(!adapter.is_valid_resume_session_id("ses_stale"));
        assert_eq!(adapter.resolve_resume_session_id(Some("ses_stale")), None);
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
}
