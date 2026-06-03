use crate::domain::ws_session::persistence::WsSessionPersistence;

pub(super) async fn mark_agent_running(
    write_pool: &sqlx::SqlitePool,
    session_status_tx: &crate::domain::session_status::SessionStatusBroadcaster,
    db_session_id: i64,
    feature_id: i64,
) {
    WsSessionPersistence::mark_running_static(write_pool, db_session_id).await;
    WsSessionPersistence::broadcast_session_status(
        session_status_tx,
        db_session_id,
        feature_id,
        crate::domain::session_status::AgentStatus::Agent,
        None,
    );
}
