//! Side-effects and status banners that the ACP event loop emits but
//! that don't belong in the loop body. Pulled out of `event_loop.rs` to
//! keep that file under the 400-line ceiling.

use serde_json::Value;
use tokio::sync::mpsc;

use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent, RuntimeStreamStatus};
use crate::domain::agents::opencode::acp::event_loop::EventLoopConfig;

/// Send a `RuntimeStreamStatus::Recovered` banner. The event loop pairs
/// this with a previously-emitted `Degraded` so the UI doesn't get stuck
/// after a transient lag spike.
pub(super) async fn emit_recovered(tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>) {
    let _ = tx
        .send(Ok(RuntimeEvent::stream_status_event(
            RuntimeStreamStatus::Recovered,
        )))
        .await;
}

/// Mirror agent-initiated `current_mode_update` notifications into the
/// session's local `current_mode` state and log slash-command catalog
/// updates for diagnostics. The FE picker is populated via the runtime
/// adapter's `runtime_slash_commands` REST call, so we don't synthesise
/// events here.
pub(super) async fn sync_session_state_from_update(params: &Value, config: &EventLoopConfig) {
    let body = params
        .get("update")
        .cloned()
        .unwrap_or_else(|| params.clone());
    let kind = body.get("sessionUpdate").and_then(Value::as_str);
    match kind {
        Some("current_mode_update") => {
            if let Some(mode) = body.get("currentModeId").and_then(Value::as_str) {
                *config.current_mode.write().await = mode.to_string();
                tracing::debug!(mode, "ACP agent updated current mode");
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
        _ => {}
    }
}

/// Render an exit-status pair `(code, signal)` into a human-readable
/// reason string for surface envelopes.
pub(super) fn describe_exit(status: Option<i32>, signal: Option<i32>) -> String {
    match (status, signal) {
        (Some(code), _) => format!("exit code {code}"),
        (_, Some(sig)) => format!("signal {sig}"),
        _ => "unknown reason".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{describe_exit, sync_session_state_from_update};
    use crate::domain::agents::opencode::acp::event_loop::EventLoopConfig;
    use crate::domain::agents::opencode::acp::terminal_registry::TerminalRegistry;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    fn dummy_config() -> EventLoopConfig {
        EventLoopConfig {
            session_id: Arc::new(RwLock::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            current_mode: Arc::new(RwLock::new("build".to_string())),
            cwd: PathBuf::from("/tmp"),
            closing: Arc::new(AtomicBool::new(false)),
            pending_permissions: Arc::new(RwLock::new(Default::default())),
            terminals: Arc::new(TerminalRegistry::default()),
        }
    }

    #[test]
    fn describe_exit_prefers_status_then_signal() {
        assert_eq!(describe_exit(Some(0), None), "exit code 0");
        assert_eq!(describe_exit(None, Some(9)), "signal 9");
        assert_eq!(describe_exit(None, None), "unknown reason");
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
    async fn unrelated_session_updates_leave_mode_unchanged() {
        let cfg = dummy_config();
        let params = json!({
            "update": { "sessionUpdate": "agent_message_chunk", "content": "hi" }
        });
        sync_session_state_from_update(&params, &cfg).await;
        assert_eq!(cfg.current_mode.read().await.clone(), "build".to_string());
    }
}
