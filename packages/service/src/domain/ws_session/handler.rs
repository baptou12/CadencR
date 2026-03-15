use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info};

use claude_agent_sdk_rs::{
    CanUseTool, Options, PermissionMode, PermissionRequest, PermissionResult, Query, SdkError,
    SdkMessage,
};

use crate::app_state::AppState;
use super::protocol::*;
use super::store::{SessionStore, WsSessionStatus};

/// CanUseTool implementation that bridges permission requests to the WebSocket client.
///
/// When the SDK needs tool permission, this sends a `session/permission.request`
/// envelope over the WebSocket and waits for the user's response on `response_rx`.
struct WsBridgeCanUseTool {
    sender: WsSender,
    response_rx: Arc<Mutex<mpsc::Receiver<PermissionResult>>>,
}

#[async_trait]
impl CanUseTool for WsBridgeCanUseTool {
    async fn can_use_tool(&self, request: PermissionRequest) -> PermissionResult {
        // Send permission request to WebSocket client
        let payload = PermissionRequestPayload {
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input: request.input.clone(),
            description: request.decision_reason.clone(),
        };
        let envelope = WsEnvelope::new(
            "session",
            "permission.request",
            serde_json::to_value(payload).unwrap(),
        );
        let _ = self.sender.send(Message::Text(String::from(envelope).into()));

        // Wait for user response
        let mut rx = self.response_rx.lock().await;
        match rx.recv().await {
            Some(result) => result,
            None => {
                // Channel closed — deny by default
                PermissionResult::Deny {
                    message: "Permission channel closed".to_string(),
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id),
                }
            }
        }
    }
}

/// State of the SDK query for a session.
enum QueryState {
    /// Session initialized but no prompt sent yet. Stores the Options to use when spawning.
    Pending(Options),
    /// Query is active (CLI subprocess running).
    Active {
        query: Arc<Mutex<Query>>,
        permission_tx: mpsc::Sender<PermissionResult>,
    },
}

/// Serializable session config for respawning with --resume after model change.
#[derive(Clone)]
struct SessionConfig {
    cwd: std::path::PathBuf,
    permission_mode: Option<PermissionMode>,
    system_prompt: Option<String>,
}

/// Handle for a running SDK session, stored per-connection.
struct SdkHandle {
    state: QueryState,
    /// The model the user wants for the next turn. Updated by model.set.
    desired_model: Option<String>,
    /// The model the CLI was actually spawned with.
    spawned_model: Option<String>,
    /// Config for respawning with --resume after model change.
    config: SessionConfig,
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
    let mut sessions = sdk_sessions.lock().await;
    for (session_id, handle) in sessions.drain() {
        debug!(session_id, "cleaning up session on WS close");
        if let QueryState::Active { query, .. } = handle.state {
            let mut q = query.lock().await;
            q.close().await;
        }
        let _ = state.ws_session_store.destroy_session(&session_id).await;
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
    info!(domain = %envelope.domain, action = %envelope.action, id = %envelope.id, "received envelope");
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
        "model.set" => handle_model_set(envelope, sender, sdk_sessions).await,
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

    info!(session_id, "session initialized (pending first prompt)");

    let desired_model = options.model.clone();
    let config = SessionConfig {
        cwd: options.cwd.clone(),
        permission_mode: options.permission_mode.clone(),
        system_prompt: options.system_prompt.clone(),
    };

    let handle = SdkHandle {
        state: QueryState::Pending(options),
        desired_model,
        spawned_model: None,
        config,
    };

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

    let session_id = payload.session_id.clone();

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&session_id) {
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

    // Check if we need to respawn due to model change
    let needs_respawn = matches!(&handle.state, QueryState::Active { .. })
        && handle.desired_model != handle.spawned_model;

    if needs_respawn {
        // Model changed — close old query and respawn with --resume
        info!(
            session_id,
            old_model = ?handle.spawned_model,
            new_model = ?handle.desired_model,
            "model changed, respawning CLI with --resume"
        );

        // Get claude session ID from old query before closing
        let claude_session_id = if let QueryState::Active { query, .. } = &handle.state {
            let q = query.lock().await;
            q.session_id().await
        } else {
            None
        };

        // Close old query
        if let QueryState::Active { query, .. } = &mut handle.state {
            let mut q = query.lock().await;
            q.close().await;
        }

        // Build fresh options with new model + resume
        let options = Options {
            cwd: handle.config.cwd.clone(),
            permission_mode: handle.config.permission_mode.clone(),
            model: handle.desired_model.clone(),
            system_prompt: handle.config.system_prompt.clone(),
            resume: claude_session_id,
            ..Options::default()
        };

        // Reset to pending so the spawn logic below handles it
        handle.spawned_model = handle.desired_model.clone();
        handle.state = QueryState::Pending(options);
    }

    match &handle.state {
        QueryState::Pending(_) => {
            // First prompt (or respawn after model change) — take the stored options and spawn.
            let spawned_model = handle.desired_model.clone();
            let config = handle.config.clone();
            let options = match std::mem::replace(
                &mut handle.state,
                QueryState::Pending(Options::default()),
            ) {
                QueryState::Pending(opts) => opts,
                _ => unreachable!(),
            };

            // Drop lock before spawning (async).
            drop(sessions);

            // Set up permission bridge
            let (permission_tx, permission_rx) = mpsc::channel::<PermissionResult>(16);
            let bridge = WsBridgeCanUseTool {
                sender: sender.clone(),
                response_rx: Arc::new(Mutex::new(permission_rx)),
            };
            let mut options = options;
            options.can_use_tool = Some(Box::new(bridge));

            info!(session_id, prompt = %payload.text, model = ?options.model, "spawning SDK query");
            match claude_agent_sdk_rs::query(&payload.text, options).await {
                Ok(mut real_query) => {
                    info!(session_id, "SDK query spawned successfully, starting stream reader");
                    let message_rx = real_query.take_message_rx();
                    let query_arc = Arc::new(Mutex::new(real_query));

                    spawn_stream_reader(
                        session_id.clone(),
                        message_rx,
                        sender.clone(),
                    );

                    let mut sessions = sdk_sessions.lock().await;
                    sessions.insert(
                        session_id,
                        SdkHandle {
                            state: QueryState::Active {
                                query: query_arc,
                                permission_tx,
                            },
                            desired_model: spawned_model.clone(),
                            spawned_model,
                            config,
                        },
                    );
                }
                Err(e) => {
                    error!(session_id, error = %e, "SDK query spawn failed");
                    send_error(sender, &envelope.id, "SDK_SPAWN_ERROR", &e.to_string());
                }
            }
        }
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            let turn_state = q.turn_state().await;
            info!(session_id, turn_state = ?turn_state, "follow-up prompt (same model)");
            if matches!(turn_state, claude_agent_sdk_rs::TurnState::TurnComplete { .. }) {
                let content = serde_json::json!(payload.text);
                if let Err(e) = q.stream_input(content).await {
                    error!(session_id, error = %e, "stream_input failed");
                    send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
                }
            } else {
                send_error(
                    sender,
                    &envelope.id,
                    "INVALID_STATE",
                    "Agent is currently working. Wait for turn completion.",
                );
            }
        }
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

    let session_id = payload.session_id.clone();

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    let permission_tx = match &handle.state {
        QueryState::Active { permission_tx, .. } => permission_tx,
        QueryState::Pending(_) => {
            send_error(sender, &envelope.id, "INVALID_STATE", "Session not yet active");
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

    if permission_tx.send(result).await.is_err() {
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

/// Handle session.model.set: change the model on an active query.
async fn handle_model_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
) {
    let payload: ModelSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let session_id = payload.session_id;

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    info!(session_id, model = %payload.model, "updating desired model");
    handle.desired_model = Some(payload.model.clone());

    // If pending, also update the stored options so the first spawn uses this model
    if let QueryState::Pending(options) = &mut handle.state {
        options.model = Some(payload.model.clone());
    }

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "model.set.ok",
        serde_json::to_value(serde_json::json!({ "model": payload.model })).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.interrupt
async fn handle_interrupt(
    envelope: WsEnvelope,
    sender: &WsSender,
    store: &Arc<dyn SessionStore>,
    sdk_sessions: &SdkSessions,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let session_id = payload.session_id;

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    let query = match &handle.state {
        QueryState::Active { query, .. } => query,
        QueryState::Pending(_) => {
            send_error(sender, &envelope.id, "INVALID_STATE", "Session not yet active");
            return;
        }
    };

    let q = query.lock().await;
    if let Err(e) = q.interrupt().await {
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
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let session_id = payload.session_id;

    let mut sessions = sdk_sessions.lock().await;
    if let Some(handle) = sessions.remove(&session_id) {
        if let QueryState::Active { query, .. } = handle.state {
            let mut q = query.lock().await;
            q.close().await;
        }
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

/// Spawn a background task that reads from the SDK message receiver and forwards
/// messages to the WebSocket client.
fn spawn_stream_reader(
    session_id: String,
    mut message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,
    sender: WsSender,
) {
    tokio::spawn(async move {
        info!(session_id, "stream reader started");
        loop {
            let msg = message_rx.recv().await;

            match msg {
                Some(Ok(sdk_msg)) => {
                    debug!(session_id, msg_type = ?std::mem::discriminant(&sdk_msg), "received SDK message");
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
                    error!(session_id, error = %e, "SDK stream error");
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
                    // Channel closed — stream ended
                    info!(session_id, "SDK stream closed");
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

    });
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

        let envelope = make_envelope(
            "session",
            "prompt.send",
            serde_json::json!({"text": "hello", "session_id": "nonexistent"}),
        );

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
    async fn test_permission_respond_without_active_session_returns_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let envelope = make_envelope(
            "session",
            "permission.respond",
            serde_json::json!({
                "session_id": "nonexistent",
                "request_id": "r1",
                "granted": true
            }),
        );

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
    async fn test_permission_tx_sends_to_bridge() {
        // Verify that permission_tx.send delivers to a WsBridgeCanUseTool receiver
        let (ws_tx, mut ws_rx) = mpsc::unbounded_channel::<Message>();
        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResult>(16);

        let bridge = WsBridgeCanUseTool {
            sender: ws_tx,
            response_rx: Arc::new(Mutex::new(perm_rx)),
        };

        // Spawn bridge call in background
        let bridge_handle = tokio::spawn(async move {
            bridge
                .can_use_tool(PermissionRequest {
                    tool_name: "Write".to_string(),
                    input: serde_json::json!({"file": "test.txt"}),
                    tool_use_id: "req_123".to_string(),
                    agent_id: None,
                    suggestions: None,
                    blocked_path: None,
                    decision_reason: Some("writing file".to_string()),
                })
                .await
        });

        // Bridge should send permission.request to WS
        let msg = ws_rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "permission.request");
            let payload: PermissionRequestPayload =
                serde_json::from_value(env.payload).unwrap();
            assert_eq!(payload.request_id, "req_123");
            assert_eq!(payload.tool_name, "Write");
            assert_eq!(payload.description, Some("writing file".to_string()));
        } else {
            panic!("expected text message");
        }

        // Simulate user granting permission via the channel
        perm_tx
            .send(PermissionResult::Allow {
                updated_input: None,
                updated_permissions: None,
                tool_use_id: Some("req_123".to_string()),
            })
            .await
            .unwrap();

        // Bridge should return the Allow result
        let result = bridge_handle.await.unwrap();
        assert!(matches!(result, PermissionResult::Allow { .. }));
    }

    /// Helper: send session.init and return the session_id from the response.
    async fn init_session(
        tx: &WsSender,
        rx: &mut mpsc::UnboundedReceiver<Message>,
        store: &Arc<dyn SessionStore>,
        sdk_sessions: &SdkSessions,
    ) -> String {
        let envelope = make_envelope("session", "init", serde_json::json!({}));
        dispatch_envelope(envelope, tx, store, sdk_sessions).await;

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
    async fn test_model_set_on_pending_session() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let session_id = init_session(&tx, &mut rx, &store, &sdk_sessions).await;

        let envelope = make_envelope(
            "session",
            "model.set",
            serde_json::json!({"session_id": session_id, "model": "claude-sonnet-4-20250514"}),
        );
        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "model.set.ok");
            let payload: serde_json::Value = env.payload;
            assert_eq!(payload["model"], "claude-sonnet-4-20250514");
        } else {
            panic!("expected text message");
        }
    }

    #[tokio::test]
    async fn test_model_set_on_nonexistent_session() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let envelope = make_envelope(
            "session",
            "model.set",
            serde_json::json!({"session_id": "does-not-exist", "model": "claude-sonnet-4-20250514"}),
        );
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
    async fn test_model_set_updates_desired_model() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let store: Arc<dyn SessionStore> =
            Arc::new(super::super::store::InMemorySessionStore::new());
        let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

        let session_id = init_session(&tx, &mut rx, &store, &sdk_sessions).await;

        // Set model to sonnet
        let envelope = make_envelope(
            "session",
            "model.set",
            serde_json::json!({"session_id": session_id, "model": "claude-sonnet-4-20250514"}),
        );
        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;
        let _ = rx.recv().await.unwrap(); // consume model.set.ok

        // Set model to opus
        let envelope = make_envelope(
            "session",
            "model.set",
            serde_json::json!({"session_id": session_id, "model": "claude-opus-4-20250514"}),
        );
        dispatch_envelope(envelope, &tx, &store, &sdk_sessions).await;

        let msg = rx.recv().await.unwrap();
        if let Message::Text(text) = msg {
            let env: WsEnvelope = serde_json::from_str(&text).unwrap();
            assert_eq!(env.action, "model.set.ok");
            let payload: serde_json::Value = env.payload;
            assert_eq!(payload["model"], "claude-opus-4-20250514");
        } else {
            panic!("expected text message");
        }

        // Verify the internal state reflects the latest model
        let sessions = sdk_sessions.lock().await;
        let handle = sessions.get(&session_id).unwrap();
        assert_eq!(handle.desired_model, Some("claude-opus-4-20250514".to_string()));
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
