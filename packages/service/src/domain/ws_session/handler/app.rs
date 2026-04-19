use axum::extract::ws::Message;
use tracing::{debug, warn};

use super::super::protocol::WsEnvelope;
use super::WsSender;
use crate::app_state::AppState;

/// Handle `app` domain actions (cross-feature, app-level concerns).
pub(super) async fn handle_app_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "subscribe.turn_states" => handle_subscribe_turn_states(envelope, sender, app_state).await,
        "subscribe.file_watcher" => {
            handle_subscribe_file_watcher(envelope, sender, app_state).await
        }
        unknown => {
            debug!(action = %unknown, "unknown app action, ignoring");
        }
    }
}

/// Subscribe the client to real-time turn state updates.
/// Sends an initial snapshot, then streams incremental updates.
///
/// Every envelope carries a monotonic `seq` (stamped at send time by
/// `TurnStateBroadcaster`). Snapshots include the current counter so the
/// frontend can reject any snapshot whose seq is older than an update
/// already applied for a feature — that's how we close the "lag-recovery
/// snapshot wipes live askUser" race.
async fn handle_subscribe_turn_states(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    // Subscribe FIRST so any update emitted between snapshot read and
    // subscribe is queued in the broadcast buffer rather than lost. The
    // frontend dedupes via per-feature seq: updates that are already
    // reflected in the snapshot are rejected (seq <= applied per-feature
    // seq), and genuinely newer updates overwrite the snapshot entry.
    let mut rx = app_state.turn_state_tx.tx.subscribe();

    // Read snapshot AFTER subscribing. Seq is read first so the snapshot's
    // stamped seq is a lower bound: every event with seq > snapshot.seq is
    // guaranteed to flow through `rx` (either because it was emitted after
    // subscribe, or because it was buffered before this line).
    let seq = app_state.turn_state_tx.current_seq();
    let states = crate::domain::sessions::repository::get_feature_turn_states(&app_state.read_pool)
        .await
        .unwrap_or_default();

    let snapshot = WsEnvelope::reply(
        &envelope.id,
        "app",
        "turn_states.snapshot",
        serde_json::json!({ "states": states, "seq": seq }),
    );
    let _ = sender.send(Message::Text(String::from(snapshot).into()));

    let sender = sender.clone();
    let read_pool = app_state.read_pool.clone();
    let broadcaster = app_state.turn_state_tx.clone();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let mut payload = serde_json::json!({
                        "feature_id": event.feature_id,
                        "turn": event.turn,
                        "seq": event.seq,
                    });
                    // `kind` is only meaningful for askUser; keep the key off
                    // the envelope entirely when absent so the frontend's
                    // `isPendingKind` guard doesn't have to special-case null.
                    if let Some(kind) = &event.kind {
                        payload["kind"] = serde_json::Value::String(kind.clone());
                    }
                    let update = WsEnvelope::new("app", "turn_states.update", payload);
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        // WS connection closed
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "turn state broadcast lagged, sending fresh snapshot"
                    );
                    // Re-send full snapshot on lag
                    let states =
                        crate::domain::sessions::repository::get_feature_turn_states(&read_pool)
                            .await
                            .unwrap_or_default();
                    let seq = broadcaster.current_seq();
                    let snapshot = WsEnvelope::new(
                        "app",
                        "turn_states.snapshot",
                        serde_json::json!({ "states": states, "seq": seq }),
                    );
                    if sender
                        .send(Message::Text(String::from(snapshot).into()))
                        .is_err()
                    {
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

/// Subscribe the client to file-system change events for a project directory.
/// Starts the watcher if not already watching the same path.
async fn handle_subscribe_file_watcher(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let project_path = match envelope
        .payload
        .get("project_path")
        .and_then(|v| v.as_str())
    {
        Some(p) => p.to_string(),
        None => {
            super::send_error(sender, &envelope.id, "BAD_REQUEST", "missing project_path");
            return;
        }
    };

    // Start or replace the file watcher
    {
        let mut watcher = app_state.file_watcher.lock().unwrap();
        if let Err(e) = watcher.start(&project_path, app_state.file_change_tx.clone()) {
            warn!(error = %e, "failed to start file watcher");
            super::send_error(sender, &envelope.id, "WATCHER_ERROR", &e);
            return;
        }
    }

    // ACK subscription
    let ack = WsEnvelope::reply(
        &envelope.id,
        "app",
        "file_watcher.subscribed",
        serde_json::json!({}),
    );
    let _ = sender.send(Message::Text(String::from(ack).into()));

    // Forward file change events to this WS client
    let mut rx = app_state.file_change_tx.subscribe();
    let sender = sender.clone();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "editor",
                        "file_tree.changed",
                        serde_json::json!({ "project_path": event.project_path }),
                    );
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Just send one notification — the frontend will refetch anyway
                    let update =
                        WsEnvelope::new("editor", "file_tree.changed", serde_json::json!({}));
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
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
