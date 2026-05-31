//! `session_prompt::spawn_stream_reader`: Active→Pending transitions on
//! close/error, the removed-session no-op, ACP permission routing, and the
//! pending-input status guard.

use super::support::*;

#[tokio::test]
async fn test_stream_reader_transitions_active_to_pending_on_stream_close() {
    let app_state = make_test_app_state().await;
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();

    let db_session_id = 42i64;
    let feature_id = 1i64;
    let cli_session_id = "cli-sess-for-resume".to_string();

    // Insert an Active handle
    {
        let mut sessions = sdk_sessions.lock().await;
        sessions.insert(
            db_session_id,
            make_active_handle(feature_id, Some(cli_session_id.clone())),
        );
    }

    // Create a message channel and immediately close the sender to simulate stream end
    let (msg_tx, msg_rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
    drop(msg_tx);

    session_prompt::spawn_stream_reader(
        db_session_id,
        feature_id,
        msg_rx,
        ws_tx,
        app_state.write_pool.clone(),
        app_state.session_status_tx.clone(),
        sdk_sessions.clone(),
        crate::domain::agents::runtime::DEFAULT_PROVIDER.to_string(),
        None,
        None,
    );

    // Wait for the "session.ended" message from the stream reader
    let msg = ws_rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "ended");
        let payload: SessionEndedPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.reason, "stream_closed");
    } else {
        panic!("expected text message");
    }

    // Give the spawned task a moment to complete the state transition
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Verify state transitioned to Pending with resume session ID
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_session_id).unwrap();
    match &handle.state {
        QueryState::Pending(options) => {
            assert_eq!(options.resume_session_id, Some(cli_session_id));
            assert_eq!(options.cwd, PathBuf::from("/tmp/test"));
            assert_eq!(options.model, Some("sonnet".to_string()));
        }
        QueryState::Active { .. } => {
            panic!("expected Pending state after stream close, but found Active");
        }
    }
}

#[tokio::test]
async fn test_stream_reader_transitions_active_to_pending_on_error() {
    let app_state = make_test_app_state().await;
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();

    let db_session_id = 43i64;
    let feature_id = 2i64;

    // Insert an Active handle (no session ID this time)
    {
        let mut sessions = sdk_sessions.lock().await;
        sessions.insert(db_session_id, make_active_handle(feature_id, None));
    }

    // Create session row for mark_paused_static
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status) VALUES (?, ?, 'session', 'running')"
    )
    .bind(db_session_id)
    .bind(feature_id)
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    // Send an error through the channel
    let (msg_tx, msg_rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
    msg_tx
        .send(Err(RuntimeError::from(SdkError::ProcessExit {
            code: Some(1),
            stderr: "something went wrong".to_string(),
        })))
        .await
        .unwrap();
    drop(msg_tx);

    session_prompt::spawn_stream_reader(
        db_session_id,
        feature_id,
        msg_rx,
        ws_tx,
        app_state.write_pool.clone(),
        app_state.session_status_tx.clone(),
        sdk_sessions.clone(),
        crate::domain::agents::runtime::DEFAULT_PROVIDER.to_string(),
        None,
        None,
    );

    // Wait for the error message
    let msg = ws_rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
    } else {
        panic!("expected text message");
    }

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Verify state transitioned to Pending with no resume (no session ID)
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_session_id).unwrap();
    match &handle.state {
        QueryState::Pending(options) => {
            assert_eq!(options.resume_session_id, None);
        }
        QueryState::Active { .. } => {
            panic!("expected Pending state after stream error, but found Active");
        }
    }
}

#[tokio::test]
async fn test_stream_reader_no_transition_when_session_removed() {
    // If the session was already removed from the map (e.g., destroy),
    // the stream reader should not panic.
    let app_state = make_test_app_state().await;
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();

    // Don't insert any handle — simulate it being removed

    let (msg_tx, msg_rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
    drop(msg_tx);

    session_prompt::spawn_stream_reader(
        99,
        1,
        msg_rx,
        ws_tx,
        app_state.write_pool.clone(),
        app_state.session_status_tx.clone(),
        sdk_sessions.clone(),
        crate::domain::agents::runtime::DEFAULT_PROVIDER.to_string(),
        None,
        None,
    );

    // Should still get the ended message
    let msg = ws_rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "ended");
    }

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // No panic, no handle in map — just a no-op
    assert!(sdk_sessions.lock().await.is_empty());
}

#[tokio::test]
async fn test_stream_reader_routes_acp_permission_request() {
    let app_state = make_test_app_state().await;
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();

    let db_session_id = 77i64;
    let feature_id = 1i64;

    {
        let mut sessions = sdk_sessions.lock().await;
        sessions.insert(db_session_id, make_active_handle(feature_id, None));
    }

    let (msg_tx, msg_rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(4);
    let event = RuntimeEvent::new(
        crate::domain::agents::adapter::RuntimeEventMetadata {
            session_id: Some("sess-opencode".to_string()),
            usage: None,
            context_window: None,
            raw: serde_json::json!({
                "type": "acp_permission_request",
                "request_id": "perm-1",
                "tool_name": "Write",
                "tool_input": { "file_path": "/tmp/a.txt" },
                "description": "needs permission",
            }),
        },
        crate::domain::agents::adapter::RuntimeEventKind::Other,
    );
    msg_tx.send(Ok(event)).await.unwrap();
    drop(msg_tx);

    session_prompt::spawn_stream_reader(
        db_session_id,
        feature_id,
        msg_rx,
        ws_tx,
        app_state.write_pool.clone(),
        app_state.session_status_tx.clone(),
        sdk_sessions,
        "opencode".to_string(),
        None,
        None,
    );

    let msg = ws_rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "permission.request");
        assert_eq!(
            env.payload.get("request_id").and_then(|v| v.as_str()),
            Some("perm-1")
        );
        assert_eq!(
            env.payload.get("tool_name").and_then(|v| v.as_str()),
            Some("Write")
        );
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_stream_reader_result_keeps_pending_user_input_status() {
    let app_state = make_test_app_state().await;
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();
    let mut status_rx = app_state.session_status_tx.subscribe();
    let db_session_id = 78i64;
    let feature_id = 1i64;

    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, pending_permission) VALUES (?, ?, 'session', 'running', '{}')",
    )
    .bind(db_session_id)
    .bind(feature_id)
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let (msg_tx, msg_rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
    msg_tx
        .send(Ok(RuntimeEvent::new(
            crate::domain::agents::adapter::RuntimeEventMetadata::default(),
            RuntimeEventKind::Result,
        )))
        .await
        .unwrap();
    drop(msg_tx);

    session_prompt::spawn_stream_reader(
        db_session_id,
        feature_id,
        msg_rx,
        ws_tx,
        app_state.write_pool.clone(),
        app_state.session_status_tx.clone(),
        sdk_sessions,
        "codex".to_string(),
        None,
        None,
    );

    while let Some(Message::Text(text)) = ws_rx.recv().await {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        if env.action == "ended" {
            break;
        }
    }

    assert!(
        matches!(
            status_rx.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ),
        "turn result must not broadcast idle while permission/question input is pending"
    );
}
