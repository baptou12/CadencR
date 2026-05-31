//! `session.init`: row creation, resume-session-id capture, validation
//! errors, and the resume `runtime_session_id` notification.

use super::support::*;

#[tokio::test]
async fn test_init_creates_session_with_no_resume_for_new_feature() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    // Session should exist in memory
    let sessions = sdk_sessions.lock().await;
    let db_id: i64 = session_id.parse().unwrap();
    let handle = sessions.get(&db_id).unwrap();

    // Brand new feature → no resume_session_id
    assert!(handle.resume_session_id.is_none());
}

#[tokio::test]
async fn test_init_captures_resume_session_id_from_db() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let resume_sid = "11111111-1111-4111-8111-111111111111";

    // Pre-create a session row with a runtime_session_id (simulating previous app run)
    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_session_id) VALUES (1, 'session', 'paused', ?)"
    )
    .bind(resume_sid)
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    let sessions = sdk_sessions.lock().await;
    let db_id: i64 = session_id.parse().unwrap();
    let handle = sessions.get(&db_id).unwrap();

    // Should have captured the existing runtime_session_id for resume
    assert_eq!(handle.resume_session_id, Some(resume_sid.to_string()));
}

#[tokio::test]
async fn test_init_no_resume_when_runtime_session_id_is_null() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    // Pre-create a session row WITHOUT runtime_session_id (e.g., after clear)
    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'session', 'paused')"
    )
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    let sessions = sdk_sessions.lock().await;
    let db_id: i64 = session_id.parse().unwrap();
    let handle = sessions.get(&db_id).unwrap();

    assert!(handle.resume_session_id.is_none());
}

#[tokio::test]
async fn test_init_missing_feature_id_returns_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let envelope = make_envelope("session", "init", serde_json::json!({ "cwd": "/tmp/test" }));
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "MISSING_FEATURE_ID");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_init_missing_cwd_returns_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let envelope = make_envelope("session", "init", serde_json::json!({ "feature_id": 1 }));
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "MISSING_CWD");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_init_missing_feature_returns_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let envelope = make_envelope(
        "session",
        "init",
        serde_json::json!({ "feature_id": 999, "cwd": "/tmp/test" }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "FEATURE_NOT_FOUND");
    } else {
        panic!("expected text message");
    }

    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_sessions")
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap();
    assert_eq!(session_count, 0);
}

#[tokio::test]
async fn test_init_reuses_existing_session_row() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    // First init creates the row
    let session_id_1 = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    // Second init for same feature reuses the row
    let session_id_2 = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    assert_eq!(session_id_1, session_id_2);
}

#[tokio::test]
async fn claude_init_allows_bypass_capability_without_activating_bypass_mode() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        .execute(&app_state.write_pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('claude_bypass_permissions_enabled', 'true')",
    )
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let session_id = init_session_with_payload(
        &tx,
        &mut rx,
        &sdk_sessions,
        &app_state,
        SessionInitPayload {
            provider: Some("claude_code".to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: Some("plan".to_string()),
            system_prompt: None,
            cwd: Some("/tmp/test".to_string()),
            feature_id: Some(1),
        },
    )
    .await;

    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&session_id.parse::<i64>().unwrap()).unwrap();
    let QueryState::Pending(options) = &handle.state else {
        panic!("expected pending session before first prompt");
    };
    assert!(options.allow_bypass_permissions);
    assert_eq!(
        options.permission_mode,
        Some(RuntimePermissionMode::Plan),
        "allowing Bypass capability must not activate bypassPermissions"
    );
}

#[tokio::test]
async fn test_different_features_get_different_sessions() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id_1 = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let session_id_2 = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 2).await;

    assert_ne!(session_id_1, session_id_2);
}

#[tokio::test]
async fn test_init_resume_sends_runtime_session_id_message() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let resume_sid = "22222222-2222-4222-8222-222222222222";

    // Pre-create a session row with a runtime_session_id (simulating previous run)
    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_session_id) VALUES (1, 'session', 'paused', ?)"
    )
    .bind(resume_sid)
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let envelope = make_envelope(
        "session",
        "init",
        serde_json::json!({
            "cwd": "/tmp/test",
            "feature_id": 1,
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    // First message should be "initialized"
    let msg1 = rx.recv().await.unwrap();
    if let Message::Text(text) = msg1 {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "initialized");
    } else {
        panic!("expected text message for initialized");
    }

    // Second message should be "runtime_session_id"
    let msg2 = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv())
        .await
        .expect("timed out waiting for runtime_session_id message")
        .unwrap();
    if let Message::Text(text) = msg2 {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.domain, "session");
        assert_eq!(env.action, "runtime_session_id");
        let sid = env
            .payload
            .get("runtime_session_id")
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(sid, resume_sid);
    } else {
        panic!("expected text message for runtime_session_id");
    }
}

#[tokio::test]
async fn test_init_no_resume_does_not_send_runtime_session_id_message() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    // No pre-existing session — brand new feature
    let envelope = make_envelope(
        "session",
        "init",
        serde_json::json!({
            "cwd": "/tmp/test",
            "feature_id": 1,
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    // First message should be "initialized"
    let msg1 = rx.recv().await.unwrap();
    if let Message::Text(text) = msg1 {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "initialized");
    } else {
        panic!("expected text message for initialized");
    }

    // No further messages should be in the channel
    assert!(
        rx.try_recv().is_err(),
        "expected no runtime_session_id message for new session"
    );
}
