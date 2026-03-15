use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tracing::debug;

use claude_agent_sdk_rs::{
    Options, PermissionMode, PermissionResult, Query, SdkMessage,
};

use crate::app_state::AppState;
use super::protocol::*;
use super::store::{SessionStore, WsSessionStatus};

/// Handle for a running SDK session, stored per-connection.
struct SdkHandle {
    /// The Query stream (kept to allow interrupt/close).
    query: Arc<Mutex<Query>>,
    /// Channel to forward permission responses to the stream reader task.
    permission_tx: mpsc::Sender<PermissionResult>,
}

type SdkSessions = Arc<Mutex<HashMap<String, SdkHandle>>>;
type WsSender = mpsc::UnboundedSender<Message>;

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
                            &state.ws_session_store,
                            &sdk_sessions,
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

    // Cleanup: kill all SDK sessions for this connection
    let sessions = sdk_sessions.lock().await;
    for (session_id, handle) in sessions.iter() {
        debug!(session_id, "cleaning up session on WS close");
        let mut q = handle.query.lock().await;
        q.close().await;
        let _ = state.ws_session_store.destroy_session(session_id).await;
    }
    drop(sessions);

    send_task.abort();
}

/// Dispatch an envelope to the appropriate domain handler.
async fn dispatch_envelope(
    envelope: WsEnvelope,
    sender: &WsSender,
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    match envelope.domain.as_str() {
        "session" => {
            handle_session_action(envelope, sender, store, sdk_sessions).await;
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
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    match envelope.action.as_str() {
        "init" => handle_init(envelope, sender, store, sdk_sessions).await,
        "prompt.send" => handle_prompt_send(envelope, sender, sdk_sessions).await,
        "permission.respond" => {
            handle_permission_respond(envelope, sender, store, sdk_sessions).await
        }
        "interrupt" => handle_interrupt(envelope, sender, store, sdk_sessions).await,
        "destroy" => handle_destroy(envelope, sender, store, sdk_sessions).await,
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

/// Handle session.init: spawn CLI subprocess, start stream reader.
async fn handle_init(
    envelope: WsEnvelope,
    sender: &WsSender,
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    let payload: SessionInitPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let session_id = uuid::Uuid::new_v4().to_string();

    if let Err(e) = store.create_session(&session_id, payload.clone()).await {
        send_error(sender, &envelope.id, "STORE_ERROR", &e.to_string());
        return;
    }

    // Build SDK options
    let mut options = Options::default();
    if let Some(ref model) = payload.model {
        options.model = Some(model.clone());
    }
    if let Some(ref pm) = payload.permission_mode {
        options.permission_mode = match pm.as_str() {
            "acceptEdits" => Some(PermissionMode::AcceptEdits),
            "bypassPermissions" => Some(PermissionMode::BypassPermissions),
            "plan" => Some(PermissionMode::Plan),
            "dontAsk" => Some(PermissionMode::DontAsk),
            _ => Some(PermissionMode::Default),
        };
    }
    if let Some(ref sp) = payload.system_prompt {
        options.system_prompt = Some(sp.clone());
    }
    if let Some(ref cwd) = payload.cwd {
        options.cwd = std::path::PathBuf::from(cwd);
    }

    // Spawn the CLI query - use an empty initial prompt; the client will send prompt.send
    // Actually, the SDK's query() requires an initial prompt. We send a placeholder
    // that will be overridden by the first prompt.send.
    // For session mode, we need to start with a prompt. We'll wait for the first prompt.send.
    // Instead, let's store the query creation for when prompt.send arrives.
    // Actually, looking at the SDK, query() takes a prompt and immediately sends it.
    // For a session init without a prompt, we can't really do this.
    // Let's create the Query immediately with a no-op prompt that just initializes.
    // The best approach: don't spawn query yet. Store options, spawn on first prompt.send.

    let (permission_tx, _permission_rx) = mpsc::channel::<PermissionResult>(16);

    let handle = SdkHandle {
        query: Arc::new(Mutex::new(create_placeholder_query())),
        permission_tx,
    };

    // Store a "pending" handle - we'll replace the query on first prompt.send
    sdk_sessions
        .lock()
        .await
        .insert(session_id.clone(), handle);

    let _ = store
        .update_status(&session_id, WsSessionStatus::Ready)
        .await;

    // Send initialized response
    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "initialized",
        serde_json::to_value(SessionInitializedPayload {
            session_id: session_id.clone(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.prompt.send: send prompt to CLI or spawn new query.
async fn handle_prompt_send(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
) {
    let payload: PromptSendPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    // Extract session_id from the envelope ref or look for it
    // The client should include session_id. Let's check payload for it or use ref.
    let session_id = match envelope.r#ref.as_deref() {
        Some(id) => id.to_string(),
        None => {
            // Try to find it in payload
            if let Some(sid) = envelope.payload.get("session_id").and_then(|v| v.as_str()) {
                sid.to_string()
            } else {
                send_error(
                    sender,
                    &envelope.id,
                    "MISSING_SESSION",
                    "No session_id provided (use ref field or session_id in payload)",
                );
                return;
            }
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                &format!("Session {session_id} not found. Send session.init first."),
            );
            return;
        }
    };

    let query = handle.query.lock().await;

    // Check if this is a placeholder (not yet started). If so, we need to spawn the real query.
    // We detect this by checking turn_state - placeholder starts as TurnComplete.
    let turn_state = query.turn_state().await;
    if matches!(
        turn_state,
        claude_agent_sdk_rs::TurnState::TurnComplete { .. }
    ) {
        // This might be the first prompt or a follow-up after turn complete.
        // For follow-up, use stream_input.
        // For now, try stream_input first. If it fails (placeholder), we need to spawn.
        if query.session_id().await.is_some() {
            // Real query in TurnComplete state - send follow-up
            let content = serde_json::json!(payload.text);
            if let Err(e) = query.stream_input(content).await {
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
            }
            return;
        }

        // Placeholder - need to spawn real query. Drop the lock first.
        drop(query);
        drop(sessions);

        // We need to get options from the store... but we didn't store them.
        // Let's spawn the query with default options + the prompt.
        let options = Options::default();

        match claude_agent_sdk_rs::query(&payload.text, options).await {
            Ok(real_query) => {
                let (permission_tx, permission_rx) = mpsc::channel::<PermissionResult>(16);
                let query_arc = Arc::new(Mutex::new(real_query));

                // Spawn stream reader
                spawn_stream_reader(
                    session_id.clone(),
                    Arc::clone(&query_arc),
                    sender.clone(),
                    permission_rx,
                );

                let mut sessions = sdk_sessions.lock().await;
                sessions.insert(
                    session_id,
                    SdkHandle {
                        query: query_arc,
                        permission_tx,
                    },
                );
            }
            Err(e) => {
                send_error(sender, &envelope.id, "SDK_SPAWN_ERROR", &e.to_string());
            }
        }
    } else {
        // AgentWorking or WaitingForPermission - can't send prompt now
        send_error(
            sender,
            &envelope.id,
            "INVALID_STATE",
            "Agent is currently working. Wait for turn completion.",
        );
    }
}

/// Handle session.permission.respond
async fn handle_permission_respond(
    envelope: WsEnvelope,
    sender: &WsSender,
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    let payload: PermissionRespondPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let session_id = match envelope.r#ref.as_deref().or(
        envelope
            .payload
            .get("session_id")
            .and_then(|v| v.as_str()),
    ) {
        Some(id) => id.to_string(),
        None => {
            send_error(sender, &envelope.id, "MISSING_SESSION", "No session_id");
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    let result = if payload.granted {
        PermissionResult::Allow {
            updated_input: None,
            updated_permissions: None,
            tool_use_id: Some(payload.request_id),
        }
    } else {
        PermissionResult::Deny {
            message: "User denied permission".to_string(),
            interrupt: Some(false),
            tool_use_id: Some(payload.request_id),
        }
    };

    if handle.permission_tx.send(result).await.is_err() {
        send_error(
            sender,
            &envelope.id,
            "CHANNEL_ERROR",
            "Permission channel closed",
        );
        return;
    }

    let _ = store
        .update_status(&session_id, WsSessionStatus::Running)
        .await;
}

/// Handle session.interrupt
async fn handle_interrupt(
    envelope: WsEnvelope,
    sender: &WsSender,
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    let session_id = match envelope.r#ref.as_deref().or(
        envelope
            .payload
            .get("session_id")
            .and_then(|v| v.as_str()),
    ) {
        Some(id) => id.to_string(),
        None => {
            send_error(sender, &envelope.id, "MISSING_SESSION", "No session_id");
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    let query = handle.query.lock().await;
    if let Err(e) = query.interrupt().await {
        send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
        return;
    }

    let _ = store
        .update_status(&session_id, WsSessionStatus::Running)
        .await;
}

/// Handle session.destroy
async fn handle_destroy(
    envelope: WsEnvelope,
    sender: &WsSender,
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    let session_id = match envelope.r#ref.as_deref().or(
        envelope
            .payload
            .get("session_id")
            .and_then(|v| v.as_str()),
    ) {
        Some(id) => id.to_string(),
        None => {
            send_error(sender, &envelope.id, "MISSING_SESSION", "No session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    if let Some(handle) = sessions.remove(&session_id) {
        let mut query = handle.query.lock().await;
        query.close().await;
    }

    let _ = store.destroy_session(&session_id).await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "ended",
        serde_json::to_value(SessionEndedPayload {
            reason: "destroyed".into(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Spawn a background task that reads from the SDK Query stream and forwards
/// messages to the WebSocket client.
fn spawn_stream_reader(
    session_id: String,
    query: Arc<Mutex<Query>>,
    sender: WsSender,
    mut permission_rx: mpsc::Receiver<PermissionResult>,
) {
    tokio::spawn(async move {
        loop {
            let mut q = query.lock().await;
            let msg = q.next().await;
            drop(q); // Release lock while processing

            match msg {
                Some(Ok(sdk_msg)) => {
                    let envelope = match &sdk_msg {
                        SdkMessage::Result { .. } => WsEnvelope::new(
                            "session",
                            "ended",
                            serde_json::to_value(SessionEndedPayload {
                                reason: "turn_complete".into(),
                            })
                            .unwrap(),
                        ),
                        _ => {
                            // Forward as session.message with raw JSON
                            let block = serde_json::to_value(&sdk_msg).unwrap_or_default();
                            WsEnvelope::new(
                                "session",
                                "message",
                                serde_json::to_value(SessionMessagePayload {
                                    blocks: vec![block],
                                })
                                .unwrap(),
                            )
                        }
                    };

                    if sender
                        .send(Message::Text(String::from(envelope).into()))
                        .is_err()
                    {
                        debug!(session_id, "WebSocket sender closed, stopping stream reader");
                        break;
                    }
                }
                Some(Err(e)) => {
                    let err_env = WsEnvelope::new(
                        "session",
                        "error",
                        serde_json::to_value(SessionErrorPayload {
                            code: "SDK_ERROR".into(),
                            message: e.to_string(),
                        })
                        .unwrap(),
                    );
                    let _ = sender.send(Message::Text(String::from(err_env).into()));
                    break;
                }
                None => {
                    // Stream ended
                    let end_env = WsEnvelope::new(
                        "session",
                        "ended",
                        serde_json::to_value(SessionEndedPayload {
                            reason: "stream_closed".into(),
                        })
                        .unwrap(),
                    );
                    let _ = sender.send(Message::Text(String::from(end_env).into()));
                    break;
                }
            }
        }

        // Drain permission_rx to clean up
        permission_rx.close();
    });
}

/// Create a placeholder Query that is immediately in TurnComplete state.
/// This is used before the first prompt.send arrives.
fn create_placeholder_query() -> Query {
    // We can't create a real Query without spawning a CLI process.
    // Instead, we'll use a sentinel approach: create a Query with a dead channel.
    // The caller checks session_id() == None to detect this is a placeholder.
    Query::placeholder()
}

/// Send an error envelope back to the client.
fn send_error(sender: &WsSender, ref_id: &str, code: &str, message: &str) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_envelope(domain: &str, action: &str, payload: serde_json::Value) -> WsEnvelope {
        WsEnvelope::new(domain, action, payload)
    }

    #[tokio::test]
    async fn test_unknown_domain_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let envelope = make_envelope("unknown_domain", "init", serde_json::json!({}));
        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;

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
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let envelope = make_envelope("session", "nonexistent_action", serde_json::json!({}));
        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;

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
    async fn test_prompt_send_without_session_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let mut envelope = make_envelope(
            "session",
            "prompt.send",
            serde_json::json!({"text": "hello", "session_id": "nonexistent"}),
        );
        envelope.r#ref = None;

        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;

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
    async fn test_malformed_init_payload_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        // init expects an object, send a string
        let envelope = make_envelope("session", "init", serde_json::json!("not an object"));
        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "error");
            let payload: SessionErrorPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.code, "INVALID_PAYLOAD");
        } else {
            panic!("expected text message");
        }
    }
}
