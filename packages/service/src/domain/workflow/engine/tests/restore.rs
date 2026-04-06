use axum::extract::ws::Message;

use crate::domain::workflow::engine::*;

use super::helpers::*;

#[tokio::test]
async fn test_restore_on_reconnect_populates_paused_sessions() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'plan', 'paused', 'cc-resume-123')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    assert!(engine.agent_manager.paused_sessions.contains_key(&AgentSlot::Plan));
    assert_eq!(*engine.agent_manager.paused_sessions.get(&AgentSlot::Plan).unwrap(), "cc-resume-123");

    assert!(engine.active_items().contains_key(&AgentSlot::Plan));

    let mut got_queue_update = false;
    let mut got_agent_paused = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("queue_update") { got_queue_update = true; }
            if text_str.contains("agent_paused") && text_str.contains("cc-resume-123") {
                got_agent_paused = true;
            }
        }
    }
    assert!(got_queue_update, "should have sent queue_update");
    assert!(got_agent_paused, "should have sent agent_paused with claude_session_id");
}

#[tokio::test]
async fn test_restore_on_reconnect_ignores_sessions_without_claude_session_id() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'plan', 'running')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    assert!(engine.agent_manager.paused_sessions.is_empty());
    assert!(engine.active_items().is_empty());
}

#[tokio::test]
async fn test_restore_on_reconnect_marks_stale_queue_items_as_error() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO workflow_queue (feature_id, item_type, status, order_index) VALUES (1, 'execute', 'running', 0)"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    let row: (String,) = sqlx::query_as(
        "SELECT status FROM workflow_queue WHERE feature_id = 1"
    ).fetch_one(&engine.read_pool).await.unwrap();
    assert_eq!(row.0, "error");
}

#[tokio::test]
async fn test_restore_on_reconnect_ignores_other_features() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (999, 'plan', 'paused', 'other-feature')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    assert!(engine.agent_manager.paused_sessions.is_empty());
}

#[tokio::test]
async fn test_restore_on_reconnect_restores_paused_queue_items_with_session() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (50, 1, 'execute', 'paused', 'cc-queue-456')"
    ).execute(&engine.write_pool).await.unwrap();

    sqlx::query(
        "INSERT INTO workflow_queue (id, feature_id, item_type, status, order_index, agent_session_id) VALUES (7, 1, 'execute', 'paused', 0, 50)"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    let slot = AgentSlot::QueueItem(7);
    assert!(engine.agent_manager.paused_sessions.contains_key(&slot));
    assert_eq!(*engine.agent_manager.paused_sessions.get(&slot).unwrap(), "cc-queue-456");
    assert!(engine.active_items().contains_key(&slot));
    assert_eq!(*engine.active_items().get(&slot).unwrap(), 50);

    let mut got_agent_paused = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("agent_paused") && text_str.contains("cc-queue-456") {
                got_agent_paused = true;
            }
        }
    }
    assert!(got_agent_paused, "should send agent_paused for restored queue item");
}

#[tokio::test]
async fn test_restore_on_reconnect_deduplicates_by_slot() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (1, 1, 'plan', 'paused', 'old-session')"
    ).execute(&engine.write_pool).await.unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (2, 1, 'plan', 'paused', 'new-session')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    assert_eq!(*engine.agent_manager.paused_sessions.get(&AgentSlot::Plan).unwrap(), "new-session");
    assert_eq!(*engine.active_items().get(&AgentSlot::Plan).unwrap(), 2);
}

#[tokio::test]
async fn test_restore_on_reconnect_restores_multiple_session_agents() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (10, 1, 'session', 'paused', 'cc-session-a')"
    ).execute(&engine.write_pool).await.unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (11, 1, 'session', 'paused', 'cc-session-b')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    let slot_a = AgentSlot::Session(10);
    let slot_b = AgentSlot::Session(11);
    assert!(engine.agent_manager.paused_sessions.contains_key(&slot_a), "session 10 should be restored");
    assert!(engine.agent_manager.paused_sessions.contains_key(&slot_b), "session 11 should be restored");
    assert_eq!(*engine.agent_manager.paused_sessions.get(&slot_a).unwrap(), "cc-session-a");
    assert_eq!(*engine.agent_manager.paused_sessions.get(&slot_b).unwrap(), "cc-session-b");
}

#[tokio::test]
async fn test_restore_on_reconnect_only_restores_paused_status() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (1, 1, 'plan', 'running', 'running-session')"
    ).execute(&engine.write_pool).await.unwrap();

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, claude_session_id) VALUES (2, 1, 'prd', 'paused', 'paused-session')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    // Running sessions with claude_session_id are now recovered as paused for resume
    assert!(engine.agent_manager.paused_sessions.contains_key(&AgentSlot::Plan), "running session with claude_session_id should be recovered as paused");
    assert!(engine.agent_manager.paused_sessions.contains_key(&AgentSlot::Prd), "paused session should be restored");
}

#[tokio::test]
async fn test_restore_on_reconnect_clears_stale_pending_questions() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_questions) VALUES (1, 'plan', 'paused', '{\"tool_name\":\"AskUserQuestion\"}')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.restore_on_reconnect().await.unwrap();

    let row: (Option<String>,) = sqlx::query_as(
        "SELECT pending_questions FROM agent_sessions WHERE feature_id = 1"
    ).fetch_one(&engine.read_pool).await.unwrap();
    assert!(row.0.is_none(), "pending_questions should be cleared on reconnect");
}
