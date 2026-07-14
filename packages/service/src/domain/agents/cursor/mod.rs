//! Cursor Agent provider adapter.
//!
//! Cursor's `agent acp` subprocess speaks the same provider-neutral ACP
//! transport as OpenCode. Cursor-specific behavior (authentication, extension
//! methods, tool normalization, model discovery, and disk MCP config) remains
//! in this directory behind the two adapter traits.

mod acp;
mod catalog;
mod commands;
mod mcp_config;
mod permissions;
mod worktree_config;

use async_trait::async_trait;
use serde_json::Value;

use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeAccessMode, RuntimeCompactionStrategy,
    RuntimeError, RuntimePermissionMode, RuntimePermissionRequest, RuntimeSlashCommand,
    RuntimeSpawnConfig,
};

pub struct CursorAdapter;

pub static CURSOR_ADAPTER: CursorAdapter = CursorAdapter;
pub const PROVIDER_ID: &str = "cursor";
pub const ACCESS_MODE_SETTING_KEY: &str = "cursor_access_mode";

fn normalize_resume_session_id(session_id: &str) -> Option<String> {
    let trimmed = session_id.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[async_trait]
impl AgentRuntimeAdapter for CursorAdapter {
    fn is_valid_resume_session_id(&self, session_id: &str) -> bool {
        normalize_resume_session_id(session_id).is_some()
    }

    fn resolve_resume_session_id(&self, runtime_session_id: Option<&str>) -> Option<String> {
        runtime_session_id.and_then(normalize_resume_session_id)
    }

    fn parse_permission_request(&self, raw: &Value) -> Option<RuntimePermissionRequest> {
        permissions::parse_permission_request(raw)
    }

    fn catalog_entry(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
        catalog::catalog_entry()
    }

    async fn catalog_entry_live(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
        catalog::catalog_entry_live().await
    }

    async fn default_model_id(&self) -> Option<String> {
        catalog::catalog_entry_live().await.default_model
    }

    fn spawn_startup_warmup(&self) {
        tokio::spawn(async {
            let _ = catalog::catalog_entry_live().await;
        });
    }

    fn worktree_config_paths(&self) -> &'static [&'static str] {
        worktree_config::CONFIG_PATHS
    }

    async fn runtime_slash_commands(
        &self,
        cwd: &str,
    ) -> Result<Vec<RuntimeSlashCommand>, RuntimeError> {
        commands::runtime_slash_commands(cwd).await
    }

    fn compaction_strategy(&self) -> Option<RuntimeCompactionStrategy> {
        Some(RuntimeCompactionStrategy::LiveRuntime)
    }

    fn supports_permission_mode(&self, mode: &RuntimePermissionMode) -> bool {
        matches!(
            mode,
            RuntimePermissionMode::Default
                | RuntimePermissionMode::Plan
                | RuntimePermissionMode::Ask
        )
    }

    fn default_permission_mode_wire(&self) -> &'static str {
        "default"
    }

    fn supports_access_mode(&self, _mode: &RuntimeAccessMode) -> bool {
        true
    }

    fn access_mode_setting_key(&self) -> Option<&'static str> {
        Some(ACCESS_MODE_SETTING_KEY)
    }

    async fn session_finished(&self, runtime_session_id: &str) -> bool {
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
    use super::{CursorAdapter, PROVIDER_ID};
    use crate::domain::agents::adapter::{
        AgentRuntimeAdapter, RuntimeAccessMode, RuntimePermissionMode,
    };

    #[test]
    fn adapter_exposes_cursor_catalog_and_modes() {
        let adapter = CursorAdapter;
        assert_eq!(adapter.catalog_entry().id, PROVIDER_ID);
        assert!(adapter.supports_permission_mode(&RuntimePermissionMode::Default));
        assert!(adapter.supports_permission_mode(&RuntimePermissionMode::Plan));
        assert!(adapter.supports_permission_mode(&RuntimePermissionMode::Ask));
        assert!(!adapter.supports_permission_mode(&RuntimePermissionMode::AcceptEdits));
        assert!(!adapter.supports_permission_mode(&RuntimePermissionMode::BypassPermissions));
        assert!(adapter.supports_access_mode(&RuntimeAccessMode::Default));
        assert!(adapter.supports_access_mode(&RuntimeAccessMode::FullAccess));
        assert!(adapter.supports_access_mode(&RuntimeAccessMode::AutoReview));
        assert_eq!(adapter.default_permission_mode_wire(), "default");
        assert_eq!(
            adapter.access_mode_setting_key(),
            Some("cursor_access_mode")
        );
        assert!(!adapter.applies_access_mode_in_place());
    }

    #[test]
    fn resume_ids_are_trimmed_and_empty_ids_rejected() {
        let adapter = CursorAdapter;
        assert_eq!(
            adapter.resolve_resume_session_id(Some("  chat-123  ")),
            Some("chat-123".to_string())
        );
        assert_eq!(adapter.resolve_resume_session_id(Some("  ")), None);
    }
}
