use sqlx::SqlitePool;

use crate::app_state::TurnStateBroadcaster;
use crate::domain::ws_session::persistence::WsSessionPersistence;

use super::super::{send_error, WsSender};

pub(super) async fn persist_pause_and_send_session_error(
    pool: &SqlitePool,
    turn_state_tx: &TurnStateBroadcaster,
    sender: &WsSender,
    ref_id: &str,
    feature_id: i64,
    session_id: i64,
    code: &str,
    message: &str,
) {
    WsSessionPersistence::persist_error_message_static(pool, session_id, message, None).await;
    WsSessionPersistence::mark_paused_static(pool, session_id).await;
    WsSessionPersistence::broadcast_turn_state(turn_state_tx, feature_id, "none");
    send_error(sender, ref_id, code, message);
}
