//! `session.prompt.send`: session-not-found / invalid-id guards, the
//! first-prompt spawn path, and the non-blocking follow-up dispatch.

use super::support::*;

struct RecordingPromptSession {
    tx: mpsc::Sender<Value>,
    message_rx: Option<RuntimeMessageRx>,
}

#[async_trait::async_trait]
impl AgentRuntimeSession for RecordingPromptSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        self.message_rx.take().unwrap()
    }

    async fn session_id(&self) -> Option<String> {
        Some("runtime-session".to_string())
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        self.tx.send(content).await.unwrap();
        Ok(())
    }

    async fn interrupt(&self) -> Result<(), RuntimeError> {
        Ok(())
    }

    async fn close(&mut self) {}

    async fn set_model(&self, _model: &str) -> Result<(), RuntimeError> {
        Ok(())
    }

    async fn set_permission_mode(&self, _mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        Ok(())
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

#[tokio::test]
async fn test_prompt_send_without_init_returns_session_not_found() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let envelope = make_envelope(
        "session",
        "prompt.send",
        serde_json::json!({
            "session_id": "999",
            "text": "hello",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "SESSION_NOT_FOUND");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_replayed_prompt_send_streams_without_persisting_duplicate_user_message() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let db_id: i64 = session_id.parse().unwrap();
    let (prompt_tx, mut prompt_rx) = mpsc::channel(1);

    {
        let mut sessions = sdk_sessions.lock().await;
        let handle = sessions.get_mut(&db_id).unwrap();
        let (permission_tx, _permission_rx) =
            mpsc::channel::<session_prompt::PermissionResponse>(1);
        let (_message_tx, message_rx) = mpsc::channel(1);
        handle.state = QueryState::Active {
            query: Arc::new(RwLock::new(Box::new(RecordingPromptSession {
                tx: prompt_tx,
                message_rx: Some(message_rx),
            }))),
            permission_tx,
        };
        handle.spawned_model = handle.desired_model.clone();
        handle.spawned_permission_mode = handle.desired_permission_mode.clone();
        handle.spawned_access_mode = handle.desired_access_mode.clone();
        handle.spawned_thinking_effort = handle.desired_thinking_effort.clone();
    }

    let envelope = make_envelope(
        "session",
        "prompt.send",
        serde_json::json!({
            "session_id": session_id,
            "text": "replayed steering prompt",
            "client_message_id": "client-1",
            "replay": true,
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let streamed = tokio::time::timeout(std::time::Duration::from_secs(2), prompt_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(streamed, serde_json::json!("replayed steering prompt"));

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = ?")
        .bind(db_id)
        .fetch_one(&app_state.write_pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "replayed steering prompts are already persisted");
}

#[test]
fn first_prompt_spawn_path_releases_sdk_session_lock_before_awaits() {
    let source = include_str!("../session_prompt/prompt_send.rs");
    let drop_index = source
        .find("drop(sessions);")
        .expect("pending spawn path should explicitly release sdk_sessions");
    let persist_index = source
        .find("// Persist user message")
        .expect("pending spawn path should persist user message");

    assert!(
        drop_index < persist_index,
        "sdk_sessions must be released before awaited first-prompt work"
    );
}

#[tokio::test]
async fn test_first_prompt_broadcasts_agent_before_runtime_spawn() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let missing_cwd = "/tmp/cadencr-test-missing-runtime-cwd";
    let _ = tokio::fs::remove_dir_all(missing_cwd).await;
    let session_id = init_session_with_payload(
        &tx,
        &mut rx,
        &sdk_sessions,
        &app_state,
        SessionInitPayload {
            provider: Some(crate::domain::agents::runtime::DEFAULT_PROVIDER.to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: None,
            system_prompt: None,
            cwd: Some(missing_cwd.to_string()),
            feature_id: Some(1),
        },
    )
    .await;
    let db_id: i64 = session_id.parse().unwrap();
    let mut status_rx = app_state.session_status_tx.subscribe();

    let envelope = make_envelope(
        "session",
        "prompt.send",
        serde_json::json!({
            "session_id": session_id,
            "text": "start working",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let status_event = tokio::time::timeout(std::time::Duration::from_secs(2), status_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status_event.session_id, db_id);
    assert_eq!(
        status_event.status,
        crate::domain::session_status::AgentStatus::Agent
    );
}

#[tokio::test]
async fn test_follow_up_prompt_does_not_block_ws_dispatch() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let db_id: i64 = session_id.parse().unwrap();
    let release = Arc::new(tokio::sync::Notify::new());
    let mut status_rx = app_state.session_status_tx.subscribe();

    {
        let mut sessions = sdk_sessions.lock().await;
        let handle = sessions.get_mut(&db_id).unwrap();
        let (permission_tx, _permission_rx) =
            mpsc::channel::<session_prompt::PermissionResponse>(1);
        handle.state = QueryState::Active {
            query: Arc::new(RwLock::new(Box::new(BlockingFollowUpSession::new(
                release.clone(),
            )))),
            permission_tx,
        };
    }

    let envelope = make_envelope(
        "session",
        "prompt.send",
        serde_json::json!({
            "session_id": session_id,
            "text": "please run another command",
        }),
    );
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state),
    )
    .await;

    release.notify_waiters();
    assert!(
        result.is_ok(),
        "follow-up prompt handling must return without waiting for the provider turn"
    );

    let status_event = status_rx.recv().await.unwrap();
    assert_eq!(status_event.session_id, db_id);
    assert_eq!(
        status_event.status,
        crate::domain::session_status::AgentStatus::Agent
    );
}

#[tokio::test]
async fn test_prompt_send_with_invalid_session_id_returns_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let envelope = make_envelope(
        "session",
        "prompt.send",
        serde_json::json!({
            "session_id": "not-a-number",
            "text": "hello",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "INVALID_SESSION_ID");
    } else {
        panic!("expected text message");
    }
}
