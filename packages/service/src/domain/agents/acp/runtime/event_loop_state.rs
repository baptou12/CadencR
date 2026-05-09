//! State-mirror helpers for the ACP event loop. Lifted out of
//! `server_requests.rs` to keep that module under the 400-line ceiling
//! after W4 added the shared `EventIndexer` and prompt-turn lock.
//!
//! Mirrors agent-initiated session-info notifications into the session's
//! local state so set_model / set_thinking_effort callers see the right
//! current values, and so the FE's "current mode" indicator stays in sync.

use serde_json::Value;

use super::events::mirror_session_info_update;
use super::events_config_option::mirror_config_option_update;
use super::server_requests::EventLoopConfig;

/// Mirror agent-initiated `current_mode_update` / `config_option_update` /
/// `session_info_update` notifications into the session's local state, and
/// log slash-command catalog updates for diagnostics.
pub async fn sync_session_state_from_update(params: &Value, config: &EventLoopConfig) {
    // Borrowed — `events::session_update_to_events` does the same dance, and
    // both run on every `session/update` notification, so we pay no clones.
    let body = params.get("update").unwrap_or(params);
    let kind = body.get("sessionUpdate").and_then(Value::as_str);
    match kind {
        Some("current_mode_update") => {
            if let Some(mode) = body.get("currentModeId").and_then(Value::as_str) {
                let mut current = config.current_mode.write().await;
                if *current != mode {
                    *current = mode.to_string();
                    tracing::debug!(mode, "ACP agent updated current mode");
                }
            }
        }
        Some("available_commands_update") => {
            let count = body
                .get("availableCommands")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            tracing::debug!(count, "ACP agent advertised slash commands");
        }
        Some("config_option_update") => {
            mirror_config_option_update(body, &config.current_model, &config.current_effort).await;
        }
        Some("session_info_update") => {
            mirror_session_info_update(body, &config.current_model).await;
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::sync_session_state_from_update;
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::acp::runtime::permissions::PendingPermissions;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::acp::runtime::server_requests::EventLoopConfig;
    use crate::domain::agents::acp::runtime::terminal_registry::TerminalRegistry;
    use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionMode};
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};
    use tokio::sync::RwLock;

    struct PlainHooks;
    #[async_trait::async_trait]
    impl AcpProviderHooks for PlainHooks {
        fn normalize_tool_name(&self, raw: &str) -> String {
            raw.to_string()
        }
        fn normalize_tool_input(&self, _: &str, input: Value) -> Value {
            input
        }
        fn flatten_tool_result_content(&self, blocks: &[Value]) -> Value {
            json!(blocks)
        }
        fn permission_decision_for_kind(&self, _: &str) -> RuntimePermissionDecision {
            RuntimePermissionDecision::AllowOnce
        }
        fn mode_for_permission_mode(&self, _: RuntimePermissionMode) -> Option<&'static str> {
            None
        }
        fn decorate_system_prompt(&self, _: Option<&str>) -> Option<String> {
            None
        }
    }

    fn dummy_config() -> EventLoopConfig {
        EventLoopConfig {
            session_id: Arc::new(RwLock::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            current_effort: Arc::new(RwLock::new(None)),
            current_mode: Arc::new(RwLock::new("build".to_string())),
            cwd: PathBuf::from("/tmp"),
            closing: Arc::new(AtomicBool::new(false)),
            pending_permissions: PendingPermissions::default(),
            terminals: Arc::new(TerminalRegistry::default()),
            hooks: Arc::new(PlainHooks),
            indexer: Arc::new(Mutex::new(EventIndexer::default())),
        }
    }

    #[tokio::test]
    async fn current_mode_update_syncs_local_mode_state() {
        let cfg = dummy_config();
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "current_mode_update",
                "currentModeId": "plan"
            }
        });
        sync_session_state_from_update(&params, &cfg).await;
        assert_eq!(cfg.current_mode.read().await.clone(), "plan".to_string());
    }

    #[tokio::test]
    async fn config_option_update_mirrors_model_into_session_state() {
        let cfg = dummy_config();
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "config_option_update",
                "configOption": { "name": "model", "value": "anthropic/claude-4.7" }
            }
        });
        sync_session_state_from_update(&params, &cfg).await;
        assert_eq!(
            cfg.current_model.read().await.as_deref(),
            Some("anthropic/claude-4.7")
        );
    }

    #[tokio::test]
    async fn unrelated_session_updates_leave_mode_unchanged() {
        let cfg = dummy_config();
        let params = json!({
            "update": { "sessionUpdate": "agent_message_chunk", "content": "hi" }
        });
        sync_session_state_from_update(&params, &cfg).await;
        assert_eq!(cfg.current_mode.read().await.clone(), "build".to_string());
    }
}
