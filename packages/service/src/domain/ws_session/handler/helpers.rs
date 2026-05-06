//! Tiny helpers shared across the per-action handlers: permission-mode
//! parsing, runtime-session ID persistence, error envelope emission.

use axum::extract::ws::Message;
use tracing::debug;

use crate::domain::agents::adapter::{RuntimePermissionMode, RuntimeSessionHandle};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{SessionErrorPayload, WsEnvelope};

use super::types::WsSender;

/// Parse a permission mode string from the client into a PermissionMode enum value.
pub(super) fn parse_permission_mode(mode: &str) -> RuntimePermissionMode {
    match mode {
        "acceptEdits" => RuntimePermissionMode::AcceptEdits,
        "bypassPermissions" => RuntimePermissionMode::BypassPermissions,
        "plan" => RuntimePermissionMode::Plan,
        "auto" => RuntimePermissionMode::Auto,
        "dontAsk" => RuntimePermissionMode::DontAsk,
        _ => RuntimePermissionMode::Default,
    }
}

/// Whether a given runtime provider can run a given permission mode.
/// Dispatches to the adapter so the (provider, mode) matrix lives next to
/// each adapter's CLI-arg mapping rather than as a switch in shared code.
/// Mirrored on the frontend by `lib/provider-modes.ts`. Unknown providers
/// default to allowing the request — a new adapter must be wired into the
/// registry before its mode policy can be enforced anyway.
pub(super) fn provider_supports_mode(provider: &str, mode: &RuntimePermissionMode) -> bool {
    crate::domain::agents::runtime_adapter(provider)
        .map(|adapter| adapter.supports_permission_mode(mode))
        .unwrap_or(true)
}

/// Wire string the chip should land on after a session switches to this
/// provider. Mirrors `defaultEditModeFor` in `lib/provider-modes.ts`.
pub(super) fn default_permission_mode_wire(provider: &str) -> &'static str {
    crate::domain::agents::runtime_adapter(provider)
        .map(|adapter| adapter.default_permission_mode_wire())
        .unwrap_or("acceptEdits")
}

/// Parsed counterpart of [`default_permission_mode_wire`]. Use this from
/// runtime-spawn paths that need a `RuntimePermissionMode`; the wire variant
/// stays for DB persistence and `mode.changed` broadcasts.
pub(super) fn default_permission_mode(provider: &str) -> RuntimePermissionMode {
    parse_permission_mode(default_permission_mode_wire(provider))
}

/// Parse a session_id string from client payload into i64 DB key.
pub(super) fn parse_session_id(s: &str) -> Option<i64> {
    s.parse::<i64>().ok()
}

/// Persist the runtime session ID from the active runtime, close it, and return the ID.
pub(super) async fn persist_and_close_query(
    query: &RuntimeSessionHandle,
    pool: &sqlx::SqlitePool,
    db_session_id: i64,
    runtime_provider: &str,
) -> Option<String> {
    let mut q = query.lock().await;
    let cli_sid = q.session_id().await;
    if let Some(ref sid) = cli_sid {
        debug!(
            db_session_id,
            runtime_provider = %runtime_provider,
            runtime_session_id = %sid,
            "persist_and_close: saving runtime session_id"
        );
        WsSessionPersistence::persist_runtime_session_id_static(
            pool,
            db_session_id,
            runtime_provider,
            sid,
        )
        .await;
    }
    q.close().await;
    cli_sid
}

/// Send an error envelope back to the client.
pub(super) fn send_error(sender: &WsSender, ref_id: &str, code: &str, message: &str) {
    let err = WsEnvelope::reply(
        ref_id,
        "session",
        "error",
        serde_json::to_value(SessionErrorPayload {
            code: code.into(),
            message: message.into(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(err).into()));
}

/// Notify the frontend of the runtime session ID (used for --resume).
pub(super) fn send_runtime_session_id(sender: &WsSender, cli_sid: &str) {
    let envelope = WsEnvelope::new(
        "session",
        "runtime_session_id",
        serde_json::json!({ "runtime_session_id": cli_sid }),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}
