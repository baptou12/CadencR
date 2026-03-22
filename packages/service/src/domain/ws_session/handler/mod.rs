mod app;
mod commands;
pub(crate) mod mcp_spawn;
mod session_control;
mod session_init;
pub(crate) mod session_prompt;
pub(crate) mod workflow;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info};

use claude_agent_sdk_rs::{Options, PermissionMode, Query};
#[cfg(test)]
use claude_agent_sdk_rs::{SdkError, SdkMessage};

use crate::app_state::AppState;
use super::persistence::WsSessionPersistence;
use super::protocol::*;

/// State of the SDK query for a session.
pub(super) enum QueryState {
    /// Session initialized but no prompt sent yet. Stores the Options to use when spawning.
    Pending(Options),
    /// Query is active (CLI subprocess running).
    Active {
        query: Arc<Mutex<Query>>,
        permission_tx: mpsc::Sender<session_prompt::PermissionResponse>,
    },
}

/// Serializable session config for respawning with --resume after model change.
#[derive(Clone)]
pub(super) struct SessionConfig {
    pub(super) cwd: PathBuf,
    /// Pre-canonicalized worktree path for permission checks (avoids repeated syscalls).
    pub(super) canonical_cwd: PathBuf,
    pub(super) permission_mode: Option<PermissionMode>,
    pub(super) system_prompt: Option<String>,
}

/// Handle for a running SDK session, stored per-connection.
/// Keyed by `i64` (agent_sessions.id). DB is the source of truth for session
/// config; memory holds only live process state and ephemeral tracking.
pub struct SdkHandle {
    pub(super) state: QueryState,
    /// feature_id for persistence lookups.
    pub(super) feature_id: i64,
    /// The model the user wants for the next turn. Updated by model.set.
    pub(super) desired_model: Option<String>,
    /// The model the CLI was actually spawned with.
    pub(super) spawned_model: Option<String>,
    /// The permission mode the user wants. Updated by mode.set.
    pub(super) desired_permission_mode: Option<PermissionMode>,
    /// The permission mode the CLI was actually spawned with.
    pub(super) spawned_permission_mode: Option<PermissionMode>,
    /// Session-level cache of approved permission patterns.
    pub(super) session_cache: Arc<Mutex<HashSet<String>>>,
    /// Pre-loaded allowed patterns from settings files.
    pub(super) allowed_patterns: Arc<HashSet<String>>,
    /// Claude CLI session ID to use for --resume on the first prompt.
    /// Set from the DB row at init time; consumed (taken) when spawning.
    pub(super) resume_session_id: Option<String>,
    /// Config for respawning with --resume after model/mode change.
    pub(super) config: SessionConfig,
}

pub(super) type SdkSessions = Arc<Mutex<HashMap<i64, SdkHandle>>>;
pub(super) type WsSender = mpsc::UnboundedSender<Message>;

/// Parse a permission mode string from the client into a PermissionMode enum value.
pub(super) fn parse_permission_mode(mode: &str) -> PermissionMode {
    match mode {
        "acceptEdits" => PermissionMode::AcceptEdits,
        "bypassPermissions" => PermissionMode::BypassPermissions,
        "plan" => PermissionMode::Plan,
        "dontAsk" => PermissionMode::DontAsk,
        _ => PermissionMode::Default,
    }
}

/// Parse a session_id string from client payload into i64 DB key.
pub(super) fn parse_session_id(s: &str) -> Option<i64> {
    s.parse::<i64>().ok()
}

/// Persist the Claude CLI session ID from a Query, close it, and return the ID.
pub(super) async fn persist_and_close_query(query: &Mutex<Query>, pool: &sqlx::SqlitePool, db_session_id: i64) -> Option<String> {
    let mut q = query.lock().await;
    let cli_sid = q.session_id().await.map(|s| s.to_string());
    if let Some(ref sid) = cli_sid {
        debug!(db_session_id, claude_session_id = %sid, "persist_and_close: saving session_id");
        WsSessionPersistence::persist_claude_session_id_static(pool, db_session_id, sid).await;
    }
    q.close().await;
    cli_sid
}

/// Send an error envelope back to the client.
pub(super) fn send_error(sender: &WsSender, ref_id: &str, code: &str, message: &str) {
    let err = WsEnvelope::reply(
        ref_id,
        "session",
        "error",
        serde_json::to_value(SessionErrorPayload {
            code: code.into(),
            message: message.into(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(err).into()));
}

/// Notify the frontend of the Claude Code CLI session ID (UUID used for --resume).
pub(super) fn send_claude_session_id(sender: &WsSender, cli_sid: &str) {
    let envelope = WsEnvelope::new(
        "session",
        "claude_session_id",
        serde_json::json!({ "claude_session_id": cli_sid }),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

/// Top-level Axum WebSocket handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_connection(socket, state))
}

/// Runs the WebSocket connection loop after upgrade.
async fn handle_connection(socket: WebSocket, state: AppState) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<Message>();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

    // Spawn outbound forwarder: reads from channel, writes to WebSocket sink
    let send_task = tokio::spawn(async move {
        use futures::SinkExt;
        while let Some(msg) = outbound_rx.recv().await {
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Inbound loop: read messages from client
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            Message::Text(text) => {
                let text_str: &str = &text;
                match WsEnvelope::try_from(text_str.to_string()) {
                    Ok(envelope) => {
                        dispatch_envelope(
                            envelope,
                            &outbound_tx,
                            &sdk_sessions,
                            &state,
                        )
                        .await;
                    }
                    Err(e) => {
                        let err_env = WsEnvelope::new(
                            "session",
                            "error",
                            serde_json::to_value(SessionErrorPayload {
                                code: "PARSE_ERROR".into(),
                                message: format!("Invalid envelope: {e}"),
                            })
                            .unwrap(),
                        );
                        let _ = outbound_tx.send(Message::Text(String::from(err_env).into()));
                    }
                }
            }
            Message::Close(_) => break,
            _ => {} // ignore binary, ping, pong
        }
    }

    // Cleanup: mark sessions paused and persist claude_session_id before dropping
    let mut sessions = sdk_sessions.lock().await;
    debug!(count = sessions.len(), "WS cleanup: draining sessions");
    for (db_session_id, handle) in sessions.drain() {
        let feature_id = handle.feature_id;
        if let QueryState::Active { query, .. } = handle.state {
            persist_and_close_query(&query, &state.write_pool, db_session_id).await;
        }
        WsSessionPersistence::mark_paused_static(&state.write_pool, db_session_id).await;
        WsSessionPersistence::broadcast_turn_state(&state.turn_state_tx, feature_id, "none");
    }
    drop(sessions);

    // Detach WS sender from workflow engines (keep engines alive for reconnect)
    for feature_id in workflow::tracked_feature_ids() {
        debug!(feature_id, "WS cleanup: detaching sender from workflow engine");
        workflow::detach_engine_sender(feature_id);
    }

    send_task.abort();
}

/// Dispatch an envelope to the appropriate domain handler.
async fn dispatch_envelope(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    info!(domain = %envelope.domain, action = %envelope.action, id = %envelope.id, "received envelope");
    match envelope.domain.as_str() {
        "session" => {
            handle_session_action(envelope, sender, sdk_sessions, app_state).await;
        }
        "commands" => {
            commands::handle_commands_action(envelope, sender).await;
        }
        "workflow" => {
            workflow::handle_workflow_action(envelope, sender, sdk_sessions, app_state).await;
        }
        "app" => {
            app::handle_app_action(envelope, sender, app_state).await;
        }
        unknown => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "session",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "UNKNOWN_DOMAIN".into(),
                    message: format!("Unknown domain: {unknown}"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
    }
}

/// Handle session domain actions.
async fn handle_session_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "init" => session_init::handle_init(envelope, sender, sdk_sessions, app_state).await,
        "prompt.send" => session_prompt::handle_prompt_send(envelope, sender, sdk_sessions, app_state).await,
        "permission.respond" => {
            session_control::handle_permission_respond(envelope, sender, sdk_sessions, app_state).await
        }
        "model.set" => session_control::handle_model_set(envelope, sender, sdk_sessions, app_state).await,
        "mode.set" => session_control::handle_mode_set(envelope, sender, sdk_sessions, app_state).await,
        "interrupt" => session_control::handle_interrupt(envelope, sender, sdk_sessions).await,
        "destroy" => session_control::handle_destroy(envelope, sender, sdk_sessions, app_state).await,
        "delete" => session_control::handle_delete(envelope, sender, sdk_sessions, app_state).await,
        "clear" => session_control::handle_clear(envelope, sender, sdk_sessions, app_state).await,
        unknown => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "session",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "UNKNOWN_ACTION".into(),
                    message: format!("Unknown session action: {unknown}"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_envelope(domain: &str, action: &str, payload: serde_json::Value) -> WsEnvelope {
        WsEnvelope::new(domain, action, payload)
    }

    async fn make_test_app_state() -> AppState {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        // Create tables needed by handler tests
        sqlx::query(
            r#"CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL DEFAULT 'session',
                status TEXT NOT NULL DEFAULT 'idle',
                claude_session_id TEXT,
                model TEXT,
                permission_mode TEXT,
                has_file_changes INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                ended_at TEXT,
                pending_questions TEXT,
                pending_permission TEXT,
                pending_plan_approval TEXT,
                pending_prd_approval TEXT,
                plan_approval_result TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                context_window INTEGER NOT NULL DEFAULT 200000
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT,
                content TEXT NOT NULL DEFAULT '',
                message_type TEXT NOT NULL DEFAULT 'text',
                tool_name TEXT,
                tool_use_id TEXT,
                parent_tool_use_id TEXT,
                model TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE session_claude_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                claude_session_id TEXT NOT NULL,
                created_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE features (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                workflow_status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        // Insert a default feature for tests that reference feature_id = 1
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'Test Feature')")
            .execute(&pool)
            .await
            .unwrap();

        AppState::with_pool(pool)
    }

    /// Helper: send a session.init envelope and return the db_session_id from the response.
    async fn init_session(
        tx: &WsSender,
        rx: &mut mpsc::UnboundedReceiver<Message>,
        sdk_sessions: &SdkSessions,
        app_state: &AppState,
        feature_id: i64,
    ) -> String {
        let envelope = make_envelope(
            "session",
            "init",
            serde_json::json!({
                "cwd": "/tmp/test",
                "feature_id": feature_id,
            }),
        );
        dispatch_envelope(envelope, tx, sdk_sessions, app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "initialized");
            let payload: SessionInitializedPayload =
                serde_json::from_value(env.payload).unwrap();
            payload.session_id
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_unknown_domain_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let envelope = make_envelope("unknown_domain", "init", serde_json::json!({}));
        let app_state = make_test_app_state().await;
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "error");
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "UNKNOWN_DOMAIN");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_unknown_action_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let envelope = make_envelope("session", "nonexistent_action", serde_json::json!({}));
        let app_state = make_test_app_state().await;
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "error");
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "UNKNOWN_ACTION");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_parse_session_id() {
        assert_eq!(parse_session_id("42"), Some(42));
        assert_eq!(parse_session_id("abc"), None);
        assert_eq!(parse_session_id(""), None);
    }

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

        // Pre-create a session row with a claude_session_id (simulating previous app run)
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'session', 'paused', 'cli-sess-abc')"
        )
        .execute(&app_state.write_pool)
        .await
        .unwrap();

        let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

        let sessions = sdk_sessions.lock().await;
        let db_id: i64 = session_id.parse().unwrap();
        let handle = sessions.get(&db_id).unwrap();

        // Should have captured the existing claude_session_id for resume
        assert_eq!(handle.resume_session_id, Some("cli-sess-abc".to_string()));
    }

    #[tokio::test]
    async fn test_init_no_resume_when_claude_session_id_is_null() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        // Pre-create a session row WITHOUT claude_session_id (e.g., after clear)
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
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "SESSION_NOT_FOUND");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_init_missing_feature_id_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        let envelope = make_envelope(
            "session",
            "init",
            serde_json::json!({ "cwd": "/tmp/test" }),
        );
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "error");
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
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

        let envelope = make_envelope(
            "session",
            "init",
            serde_json::json!({ "feature_id": 1 }),
        );
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "error");
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "MISSING_CWD");
        } else {
            panic!("expected text message");
        }
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
    async fn test_different_features_get_different_sessions() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        let session_id_1 = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
        let session_id_2 = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 2).await;

        assert_ne!(session_id_1, session_id_2);
    }

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
            app_state.write_pool.clone(), feature_id, Some(db_session_id),
        );

        // Simulate what handle_permission_respond does for AskUserQuestion
        let updated_input = serde_json::json!({
            "question": "What is the project name?",
            "answers": { "0": "Question: What is the project name?\nAnswer: Cadence" }
        });
        let answer_text = updated_input.get("answers")
            .and_then(|a| a.get("0"))
            .and_then(|v| v.as_str())
            .unwrap();
        p.persist_user_message(answer_text).await;

        // Verify it was persisted
        let (role, content, msg_type): (String, String, String) = sqlx::query_as(
            "SELECT role, content, message_type FROM agent_messages WHERE session_id = ?"
        )
        .bind(db_session_id)
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap();

        assert_eq!(role, "user");
        assert_eq!(content, "Question: What is the project name?\nAnswer: Cadence");
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

        // The handler checks for answers.0 — this should NOT persist anything
        if let Some(answers) = updated_input.get("answers") {
            if let Some(answer_text) = answers.get("0").and_then(|v| v.as_str()) {
                let p = WsSessionPersistence::with_session_id(
                    app_state.write_pool.clone(), feature_id, Some(db_session_id),
                );
                p.persist_user_message(answer_text).await;
            }
        }

        // Verify nothing was persisted
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ?"
        )
        .bind(db_session_id)
        .fetch_one(&app_state.read_pool)
        .await
        .unwrap();

        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_init_resume_sends_claude_session_id_message() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        // Pre-create a session row with a claude_session_id (simulating previous run)
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, claude_session_id) VALUES (1, 'session', 'paused', 'resume-uuid-123')"
        )
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

        // Second message should be "claude_session_id"
        let msg2 = rx.recv().await.unwrap();
        if let Message::Text(text) = msg2 {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.domain, "session");
            assert_eq!(env.action, "claude_session_id");
            let sid = env.payload.get("claude_session_id").unwrap().as_str().unwrap();
            assert_eq!(sid, "resume-uuid-123");
        } else {
            panic!("expected text message for claude_session_id");
        }
    }

    #[tokio::test]
    async fn test_init_no_resume_does_not_send_claude_session_id_message() {
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
        assert!(rx.try_recv().is_err(), "expected no claude_session_id message for new session");
    }

    /// Helper: insert an SdkHandle with QueryState::Active using a test stub Query.
    fn make_active_handle(
        feature_id: i64,
        session_id: Option<String>,
    ) -> SdkHandle {
        let query = Query::new_test_stub(session_id);
        let (permission_tx, _permission_rx) = mpsc::channel::<session_prompt::PermissionResponse>(1);
        SdkHandle {
            state: QueryState::Active {
                query: Arc::new(Mutex::new(query)),
                permission_tx,
            },
            feature_id,
            desired_model: Some("sonnet".to_string()),
            spawned_model: Some("sonnet".to_string()),
            desired_permission_mode: None,
            spawned_permission_mode: None,
            session_cache: Arc::new(Mutex::new(HashSet::new())),
            allowed_patterns: Arc::new(HashSet::new()),
            resume_session_id: None,
            config: SessionConfig {
                cwd: PathBuf::from("/tmp/test"),
                canonical_cwd: PathBuf::from("/tmp/test"),
                permission_mode: None,
                system_prompt: None,
            },
        }
    }

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
            sessions.insert(db_session_id, make_active_handle(feature_id, Some(cli_session_id.clone())));
        }

        // Create a message channel and immediately close the sender to simulate stream end
        let (msg_tx, msg_rx) = mpsc::channel::<Result<SdkMessage, SdkError>>(1);
        drop(msg_tx);

        session_prompt::spawn_stream_reader(
            db_session_id,
            feature_id,
            msg_rx,
            ws_tx,
            app_state.write_pool.clone(),
            app_state.turn_state_tx.clone(),
            sdk_sessions.clone(),
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
                assert_eq!(options.resume, Some(cli_session_id));
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
        let (msg_tx, msg_rx) = mpsc::channel::<Result<SdkMessage, SdkError>>(1);
        msg_tx.send(Err(SdkError::ProcessExit {
            code: Some(1),
            stderr: "something went wrong".to_string(),
        })).await.unwrap();
        drop(msg_tx);

        session_prompt::spawn_stream_reader(
            db_session_id,
            feature_id,
            msg_rx,
            ws_tx,
            app_state.write_pool.clone(),
            app_state.turn_state_tx.clone(),
            sdk_sessions.clone(),
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
                assert_eq!(options.resume, None);
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

        let (msg_tx, msg_rx) = mpsc::channel::<Result<SdkMessage, SdkError>>(1);
        drop(msg_tx);

        session_prompt::spawn_stream_reader(
            99,
            1,
            msg_rx,
            ws_tx,
            app_state.write_pool.clone(),
            app_state.turn_state_tx.clone(),
            sdk_sessions.clone(),
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
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "INVALID_SESSION_ID");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_app_subscribe_turn_states_sends_snapshot() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        let envelope = make_envelope("app", "subscribe.turn_states", serde_json::json!({}));
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.domain, "app");
            assert_eq!(env.action, "turn_states.snapshot");
            // Payload should have a "states" object (empty since no running sessions)
            let states = env.payload.get("states").unwrap();
            assert!(states.is_object());
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_app_subscribe_forwards_broadcast_updates() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        let envelope = make_envelope("app", "subscribe.turn_states", serde_json::json!({}));
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        // Drain the snapshot message
        let _ = rx.recv().await.unwrap();

        // Broadcast a turn state change
        WsSessionPersistence::broadcast_turn_state(&app_state.turn_state_tx, 42, "askUser");

        // Give the forwarding task a moment to process
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.domain, "app");
            assert_eq!(env.action, "turn_states.update");
            assert_eq!(env.payload.get("feature_id").unwrap().as_i64().unwrap(), 42);
            assert_eq!(env.payload.get("turn").unwrap().as_str().unwrap(), "askUser");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_app_unknown_action_does_not_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        let envelope = make_envelope("app", "unknown_action", serde_json::json!({}));
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        // No message sent (unknown actions are silently ignored)
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_session_delete_paused_session() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        // Create and pause a session
        let session_id_str = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
        let db_session_id: i64 = session_id_str.parse().unwrap();
        WsSessionPersistence::mark_paused_static(&app_state.write_pool, db_session_id).await;

        let envelope = make_envelope(
            "session",
            "delete",
            serde_json::json!({ "session_id": session_id_str }),
        );
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "deleted");
        } else {
            panic!("expected text message");
        }

        // Verify DB row is gone
        let row: Option<(i64,)> = sqlx::query_as("SELECT id FROM agent_sessions WHERE id = ?")
            .bind(db_session_id)
            .fetch_optional(&app_state.read_pool)
            .await
            .unwrap();
        assert!(row.is_none());
    }

    #[tokio::test]
    async fn test_session_delete_running_session_fails() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        // Create a session (status = 'running' by default)
        let session_id_str = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

        let envelope = make_envelope(
            "session",
            "delete",
            serde_json::json!({ "session_id": session_id_str }),
        );
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "error");
            let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "DELETE_FAILED");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_session_delete_plan_agent_resets_workflow_status() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
        let app_state = make_test_app_state().await;

        // Create a feature with plan_approval status
        sqlx::query("UPDATE features SET workflow_status = 'plan_approval' WHERE id = 1")
            .execute(&app_state.write_pool).await.unwrap();

        // Insert a plan-type session and pause it
        sqlx::query("INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'plan', 'paused')")
            .execute(&app_state.write_pool).await.unwrap();
        let (session_id,): (i64,) = sqlx::query_as("SELECT id FROM agent_sessions WHERE feature_id = 1 AND agent_type = 'plan'")
            .fetch_one(&app_state.write_pool).await.unwrap();

        let envelope = make_envelope(
            "session",
            "delete",
            serde_json::json!({ "session_id": session_id.to_string() }),
        );
        dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

        // First message: status_changed to idle
        let msg1 = rx.recv().await.unwrap();
        if let Message::Text(text) = msg1 {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.domain, "workflow");
            assert_eq!(env.action, "status_changed");
            let status: String = env.payload.get("status").unwrap().as_str().unwrap().to_string();
            assert_eq!(status, "idle");
        } else {
            panic!("expected status_changed message");
        }

        // Second message: session deleted confirmation
        let msg2 = rx.recv().await.unwrap();
        if let Message::Text(text) = msg2 {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "deleted");
        } else {
            panic!("expected deleted message");
        }

        // Verify workflow status is reset in DB
        let (ws_status,): (String,) = sqlx::query_as("SELECT workflow_status FROM features WHERE id = 1")
            .fetch_one(&app_state.read_pool).await.unwrap();
        assert_eq!(ws_status, "idle");
    }
}
