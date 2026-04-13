use axum::extract::ws::Message;

use crate::domain::workflow::engine::*;

use super::helpers::*;

// ── send_prompt ──

#[tokio::test]
async fn test_send_prompt_returns_error_for_unknown_positive_item() {
    let (engine, _rx) = test_engine().await;

    let result = engine
        .send_prompt(AgentSlot::QueueItem(999), "hello", None)
        .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("No query handle"));
}

#[tokio::test]
async fn test_send_prompt_uses_paused_session_for_resume() {
    let (engine, _rx) = test_engine_with_schema().await;

    let db_id: i64 = sqlx::query_scalar(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_session_id) VALUES (1, 'plan', 'paused', 'cc-resume-456') RETURNING id"
    ).fetch_one(&engine.write_pool).await.unwrap();

    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::Plan, "cc-resume-456".to_string());
    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::Plan, db_id);

    let _ = engine.send_prompt(AgentSlot::Plan, "continue", None).await;

    assert!(!engine
        .agent_manager
        .paused_sessions
        .contains_key(&AgentSlot::Plan));
}

// ── on_item_completed ──

#[tokio::test]
async fn test_on_item_completed_plan_sends_feature_updated() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
        .execute(&engine.write_pool)
        .await
        .unwrap();

    engine
        .on_item_completed(AgentSlot::Plan, Some("done"))
        .await;

    let mut got_item_completed = false;
    let mut got_feature_updated = false;
    let mut updated_fields: Vec<String> = Vec::new();
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("item_completed") {
                got_item_completed = true;
            }
            if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                got_feature_updated = true;
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(text_str) {
                    if let Some(changed) = v["payload"]["changed"].as_array() {
                        updated_fields = changed
                            .iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect();
                    }
                }
            }
        }
    }
    assert!(got_item_completed, "should send item_completed");
    assert!(
        got_feature_updated,
        "should send feature.updated for plan agent"
    );
    assert!(updated_fields.contains(&"plan".to_string()));
    assert!(updated_fields.contains(&"phases".to_string()));
    assert!(updated_fields.contains(&"progress".to_string()));
}

#[tokio::test]
async fn test_on_item_completed_prd_sends_feature_updated() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
        .execute(&engine.write_pool)
        .await
        .unwrap();

    engine.on_item_completed(AgentSlot::Prd, None).await;

    let mut got_feature_updated = false;
    let mut updated_fields: Vec<String> = Vec::new();
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                got_feature_updated = true;
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(text_str) {
                    if let Some(changed) = v["payload"]["changed"].as_array() {
                        updated_fields = changed
                            .iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect();
                    }
                }
            }
        }
    }
    assert!(
        got_feature_updated,
        "should send feature.updated for prd agent"
    );
    assert_eq!(updated_fields, vec!["prd"]);
}

#[tokio::test]
async fn test_on_item_completed_regular_item_no_feature_updated() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
        .execute(&engine.write_pool)
        .await
        .unwrap();

    engine
        .on_item_completed(AgentSlot::QueueItem(42), Some("done"))
        .await;

    let mut got_feature_updated = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("\"updated\"") && text_str.contains("\"feature\"") {
                got_feature_updated = true;
            }
        }
    }
    assert!(
        !got_feature_updated,
        "regular items should NOT send feature.updated"
    );
}

#[tokio::test]
async fn test_on_item_completed_marks_agent_session_completed() {
    let (engine, _rx) = test_engine_with_schema().await;

    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'test')")
        .execute(&engine.write_pool)
        .await
        .unwrap();

    let session_id: i64 = sqlx::query_scalar(
        "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'plan', 'running') RETURNING id",
    )
    .fetch_one(&engine.write_pool).await.unwrap();

    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::Plan, session_id);

    engine
        .on_item_completed(AgentSlot::Plan, Some("done"))
        .await;

    let status: String = sqlx::query_scalar("SELECT status FROM agent_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_one(&engine.write_pool)
        .await
        .unwrap();
    assert_eq!(
        status, "completed",
        "agent_sessions should be marked completed"
    );
}

// ── replay_state_to_client ──

#[tokio::test]
async fn test_replay_state_sends_queue_update_and_agent_messages() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO features (id, project_id, title, status) VALUES (1, 1, 'test', 'in-progress')",
    )
    .execute(&engine.write_pool)
    .await
    .unwrap();

    engine.agent_manager.active_items.insert(AgentSlot::Prd, 20);
    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::Prd, "cc-pause-789".to_string());

    engine.replay_state_to_client().await.unwrap();

    let mut got_queue_update = false;
    let mut got_agent_paused = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("queue_update") {
                got_queue_update = true;
            }
            if text_str.contains("agent_paused") && text_str.contains("cc-pause-789") {
                got_agent_paused = true;
            }
        }
    }
    assert!(got_queue_update, "should send queue_update");
    assert!(
        got_agent_paused,
        "should send agent_paused for paused agent"
    );
}

#[tokio::test]
async fn test_replay_state_sends_pending_question_permission_request() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO features (id, project_id, title, status) VALUES (1, 1, 'test', 'in-progress')",
    )
    .execute(&engine.write_pool)
    .await
    .unwrap();

    let pq = serde_json::json!({
        "tool_name": "AskUserQuestion",
        "tool_input": {"question": "Which database?"},
        "request_id": "toolu_abc123",
        "pattern": "AskUserQuestion"
    });
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, pending_questions) VALUES (30, 1, 'plan', 'running', ?)"
    )
    .bind(pq.to_string())
    .execute(&engine.write_pool).await.unwrap();

    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::Plan, 30);
    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::Plan, "cc-session-xyz".to_string());

    engine.replay_state_to_client().await.unwrap();

    let mut got_queue_update = false;
    let mut got_agent_paused = false;
    let mut got_permission_request = false;
    let mut permission_payload: Option<serde_json::Value> = None;

    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("queue_update") {
                got_queue_update = true;
            }
            if text_str.contains("agent_paused") {
                got_agent_paused = true;
            }
            if text_str.contains("permission.request") {
                got_permission_request = true;
                permission_payload = serde_json::from_str(text_str).ok();
            }
        }
    }
    assert!(got_queue_update, "should send queue_update");
    assert!(got_agent_paused, "should send agent_paused");
    assert!(
        got_permission_request,
        "should replay permission.request for pending question"
    );

    let payload = permission_payload.expect("permission.request should be valid JSON");
    let p = &payload["payload"];
    assert_eq!(p["tool_name"].as_str().unwrap(), "AskUserQuestion");
    assert_eq!(p["request_id"].as_str().unwrap(), "toolu_abc123");
    assert_eq!(
        p["tool_input"]["question"].as_str().unwrap(),
        "Which database?"
    );
}

#[tokio::test]
async fn test_replay_state_no_pending_questions_no_permission_request() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO features (id, project_id, title, status) VALUES (1, 1, 'test', 'in-progress')",
    )
    .execute(&engine.write_pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status) VALUES (31, 1, 'prd', 'running')"
    ).execute(&engine.write_pool).await.unwrap();

    engine.agent_manager.active_items.insert(AgentSlot::Prd, 31);
    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::Prd, "cc-pause-no-pq".to_string());

    engine.replay_state_to_client().await.unwrap();

    let mut got_queue_update = false;
    let mut got_agent_paused = false;
    let mut got_permission_request = false;

    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("queue_update") {
                got_queue_update = true;
            }
            if text_str.contains("agent_paused") {
                got_agent_paused = true;
            }
            if text_str.contains("permission.request") {
                got_permission_request = true;
            }
        }
    }
    assert!(got_queue_update, "should send queue_update");
    assert!(got_agent_paused, "should send agent_paused");
    assert!(
        !got_permission_request,
        "should NOT send permission.request when no pending questions"
    );
}

#[tokio::test]
async fn test_replay_state_sends_queue_update_with_no_active_agents() {
    let (engine, mut rx) = test_engine_with_schema().await;

    sqlx::query(
        "INSERT INTO features (id, project_id, title, status) VALUES (1, 1, 'test', 'in-progress')",
    )
    .execute(&engine.write_pool)
    .await
    .unwrap();

    assert!(engine.agent_manager.active_items.is_empty());

    engine.replay_state_to_client().await.unwrap();

    let mut got_queue_update = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("queue_update") {
                got_queue_update = true;
                assert!(
                    text_str.contains("workflow_status"),
                    "queue_update should include workflow_status"
                );
            }
        }
    }
    assert!(
        got_queue_update,
        "should send queue_update even with no active agents"
    );
}

// ── on_item_paused ──

#[tokio::test]
async fn test_on_item_paused_sends_agent_paused_for_session_slot() {
    let (engine, mut rx) = test_engine().await;

    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::Session(42), 42);
    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::Session(42), "cc-session-123".to_string());

    engine.on_item_paused(AgentSlot::Session(42)).await;

    let mut got_agent_paused = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("agent_paused") && text_str.contains("cc-session-123") {
                got_agent_paused = true;
            }
        }
    }
    assert!(
        got_agent_paused,
        "on_item_paused should send agent_paused WS event for session slot"
    );
}

#[tokio::test]
async fn test_on_item_paused_sends_agent_paused_for_queue_item() {
    let (engine, mut rx) = test_engine().await;

    engine
        .agent_manager
        .active_items
        .insert(AgentSlot::QueueItem(7), 99);
    engine
        .agent_manager
        .paused_sessions
        .insert(AgentSlot::QueueItem(7), "cc-queue-456".to_string());

    engine.on_item_paused(AgentSlot::QueueItem(7)).await;

    let mut got_agent_paused = false;
    while let Ok(msg) = rx.try_recv() {
        if let Message::Text(text) = msg {
            let text_str: &str = &text;
            if text_str.contains("agent_paused") && text_str.contains("cc-queue-456") {
                got_agent_paused = true;
            }
        }
    }
    assert!(
        got_agent_paused,
        "on_item_paused should send agent_paused WS event for queue item slot"
    );
}
