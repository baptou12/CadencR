use axum::extract::ws::Message;

use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{UserMessageMirrorPayload, WsEnvelope};
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;

use super::super::WsSender;

/// Mirror the just-sent user prompt to *other* devices viewing this feature so
/// their conversation shows it live. The sending device already renders the
/// prompt optimistically, so it's excluded; in the common single-viewer case
/// this is a no-op (`broadcast_others` finds nobody else registered).
pub(super) async fn mirror_user_message(
    feature_senders: &WsFeatureSenderRegistry,
    sender: &WsSender,
    feature_id: i64,
    text: &str,
) {
    let env = WsEnvelope::new(
        "session",
        "user_message",
        serde_json::to_value(UserMessageMirrorPayload {
            text: text.to_string(),
        })
        .unwrap(),
    );
    feature_senders
        .broadcast_others(feature_id, sender, &Message::Text(String::from(env).into()))
        .await;
}

pub(super) async fn mark_agent_running(
    write_pool: &sqlx::SqlitePool,
    session_status_tx: &crate::domain::session_status::SessionStatusBroadcaster,
    active_turns: &super::super::ActiveTurnRegistry,
    owner: &super::super::SdkSessions,
    db_session_id: i64,
    feature_id: i64,
) {
    // Stamp the turn start on the server and record this connection as the
    // turn's owner. The timestamp is the single source of truth the timer is
    // anchored to on every client; the owner pointer lets a remote device
    // answer a permission/question/plan against this live turn.
    let started_at_ms = super::super::active_turns::now_ms();
    active_turns
        .begin_turn(db_session_id, owner, started_at_ms)
        .await;
    WsSessionPersistence::mark_running_static(write_pool, db_session_id).await;
    session_status_tx.broadcast_running_with_start(db_session_id, feature_id, started_at_ms);
}
