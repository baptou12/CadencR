//! `session.permission.respond`: persisting AskUserQuestion answers and the
//! guard that skips persistence when the runtime rejects the response.

use super::support::*;

#[tokio::test]
async fn test_permission_respond_persists_ask_user_question_answer() {
    let app_state = make_test_app_state().await;

    let feature_id = 1i64;
    let db_session_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (?, 'session', 'running') RETURNING id"
    )
    .bind(feature_id)
    .fetch_one(&app_state.write_pool)
    .await
    .unwrap();

    // Test the persistence logic that handle_permission_respond uses
    // for AskUserQuestion answers (updated_input with answers field).
    let p = WsSessionPersistence::with_session_id(
        app_state.write_pool.clone(),
        feature_id,
        Some(db_session_id),
    );

    // Simulate what handle_permission_respond does for AskUserQuestion
    let updated_input = serde_json::json!({
        "question": "What is the project name?",
        "answers": [["Cadencr"]]
    });
    let answer_text =
        crate::domain::ws_session::question_answers::format_answers_plain_text(&updated_input)
            .unwrap();
    p.persist_user_message(&answer_text).await;

    // Verify it was persisted
    let (role, content, msg_type): (String, String, String) = sqlx::query_as(
        "SELECT role, content, message_type FROM agent_messages WHERE session_id = ?",
    )
    .bind(db_session_id)
    .fetch_one(&app_state.read_pool)
    .await
    .unwrap();

    assert_eq!(role, "user");
    assert_eq!(content, "What is the project name?\nAnswer: Cadencr");
    assert_eq!(msg_type, "user_message");
}

#[tokio::test]
async fn test_permission_respond_no_persist_without_answers() {
    let app_state = make_test_app_state().await;
    let feature_id = 1i64;
    let db_session_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (?, 'session', 'running') RETURNING id"
    )
    .bind(feature_id)
    .fetch_one(&app_state.write_pool)
    .await
    .unwrap();

    // Permission respond without answers (regular permission, not AskUserQuestion)
    let updated_input = serde_json::json!({
        "tool_name": "Write",
        "file_path": "/tmp/test.txt"
    });

    // The handler checks for structured answers — this should NOT persist anything
    if let Some(answer_text) =
        crate::domain::ws_session::question_answers::format_answers_plain_text(&updated_input)
    {
        let p = WsSessionPersistence::with_session_id(
            app_state.write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        p.persist_user_message(&answer_text).await;
    }

    // Verify nothing was persisted
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = ?")
        .bind(db_session_id)
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap();

    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_permission_respond_does_not_persist_question_answer_when_runtime_rejects() {
    let app_state = make_test_app_state().await;
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let feature_id = 1i64;

    let pending_question = serde_json::json!({
        "tool_name": "AskUserQuestion",
        "tool_input": { "question": "Pick a color" },
        "request_id": "q-missing",
        "pattern": null
    });
    let db_session_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO agent_sessions \
                (feature_id, agent_type, status, runtime_provider, pending_questions) \
             VALUES (?, 'session', 'running', 'opencode', ?) RETURNING id",
    )
    .bind(feature_id)
    .bind(pending_question.to_string())
    .fetch_one(&app_state.write_pool)
    .await
    .unwrap();

    sdk_sessions
        .lock()
        .await
        .insert(db_session_id, make_in_place_effort_handle(feature_id));

    let envelope = make_envelope(
        "session",
        "permission.respond",
        serde_json::json!({
            "session_id": db_session_id.to_string(),
            "request_id": "q-missing",
            "decision": "allow_once",
            "updated_input": {
                "question": "Pick a color",
                "answers": { "Pick a color": "Blue" }
            }
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "RUNTIME_PERMISSION_ERROR");
    } else {
        panic!("expected text message");
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = ?")
        .bind(db_session_id)
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
