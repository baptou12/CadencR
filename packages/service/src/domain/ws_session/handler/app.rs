use axum::extract::ws::Message;
use tracing::{debug, warn};

use crate::app_state::AppState;
use super::super::protocol::WsEnvelope;
use super::WsSender;

/// Handle `app` domain actions (cross-feature, app-level concerns).
pub(super) async fn handle_app_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "subscribe.turn_states" => handle_subscribe_turn_states(envelope, sender, app_state).await,
        unknown => {
            debug!(action = %unknown, "unknown app action, ignoring");
        }
    }
}

/// Subscribe the client to real-time turn state updates.
/// Sends an initial snapshot, then streams incremental updates.
async fn handle_subscribe_turn_states(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    // Send initial snapshot from DB
    let states = crate::domain::sessions::repository::get_feature_turn_states(&app_state.read_pool)
        .await
        .unwrap_or_default();

    let snapshot = WsEnvelope::reply(
        &envelope.id,
        "app",
        "turn_states.snapshot",
        serde_json::json!({ "states": states }),
    );
    let _ = sender.send(Message::Text(String::from(snapshot).into()));

    // Subscribe to broadcast channel and forward updates
    let mut rx = app_state.turn_state_tx.subscribe();
    let sender = sender.clone();
    let read_pool = app_state.read_pool.clone();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "app",
                        "turn_states.update",
                        serde_json::json!({
                            "feature_id": event.feature_id,
                            "turn": event.turn,
                        }),
                    );
                    if sender.send(Message::Text(String::from(update).into())).is_err() {
                        // WS connection closed
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "turn state broadcast lagged, sending fresh snapshot");
                    // Re-send full snapshot on lag
                    let states = crate::domain::sessions::repository::get_feature_turn_states(&read_pool)
                        .await
                        .unwrap_or_default();
                    let snapshot = WsEnvelope::new(
                        "app",
                        "turn_states.snapshot",
                        serde_json::json!({ "states": states }),
                    );
                    if sender.send(Message::Text(String::from(snapshot).into())).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });
}
