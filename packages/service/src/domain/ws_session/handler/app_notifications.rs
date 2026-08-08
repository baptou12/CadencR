use axum::extract::ws::Message;

use super::super::protocol::WsEnvelope;
use super::app::{forward_app_events, OnLag};
use super::WsSender;
use crate::app_state::AppState;

/// Send a running sweep snapshot before forwarding lifecycle updates.
pub(super) fn subscribe_storage_maintenance(sender: &WsSender, app_state: &AppState) {
    // Subscribe first so a completion emitted while reading the snapshot stays
    // queued. A duplicate Started is harmless because the toast id is stable.
    let rx = app_state.storage_maintenance_events_tx.subscribe();
    if let Some(event) = app_state.storage_maintenance_events_tx.active() {
        let payload = serde_json::to_value(event).unwrap_or_else(|_| serde_json::json!({}));
        let update = WsEnvelope::new("app", "storage_maintenance", payload);
        let _ = sender.send(Message::Text(String::from(update).into()));
    }
    forward_app_events(sender, rx, "storage_maintenance", OnLag::Skip);
}

/// Remote device connections are one-shot host notifications, not state.
pub(super) fn subscribe_remote_events(sender: &WsSender, app_state: &AppState) {
    forward_app_events(
        sender,
        app_state.remote_events_tx.subscribe(),
        "remote_connected",
        OnLag::Skip,
    );
}

/// Settings-file changes are cues for the desktop to refetch settings.
pub(super) fn subscribe_settings_events(sender: &WsSender, app_state: &AppState) {
    forward_app_events(
        sender,
        app_state.settings_events_tx.subscribe(),
        "settings_event",
        OnLag::ResendBare,
    );
}
