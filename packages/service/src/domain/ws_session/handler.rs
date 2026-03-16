use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
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
use super::permissions::{self, ResolvedPermission};
use super::persistence::WsSessionPersistence;
use super::protocol::*;

/// Parse a permission mode string from the client into a PermissionMode enum value.
fn parse_permission_mode(mode: &str) -> PermissionMode {
    match mode {
        "acceptEdits" => PermissionMode::AcceptEdits,
        "bypassPermissions" => PermissionMode::BypassPermissions,
        "plan" => PermissionMode::Plan,
        "dontAsk" => PermissionMode::DontAsk,
        _ => PermissionMode::Default,
    }
}

/// Response sent through the permission channel from the WebSocket handler.
struct PermissionResponse {
    decision: PermissionDecision,
    feedback: Option<String>,
    updated_input: Option<serde_json::Value>,
}

/// CanUseTool implementation that resolves permissions server-side when possible,
/// and bridges to the WebSocket client only when user approval is needed.
struct WsBridgeCanUseTool {
    sender: WsSender,
    response_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    worktree_path: PathBuf,
    session_cache: Arc<Mutex<HashSet<String>>>,
    allowed_patterns: Arc<HashSet<String>>,
}

#[async_trait]
impl CanUseTool for WsBridgeCanUseTool {
    async fn can_use_tool(&self, request: PermissionRequest) -> PermissionResult {
        debug!(
            tool_name = %request.tool_name,
            tool_use_id = %request.tool_use_id,
            "WsBridgeCanUseTool::can_use_tool called"
        );

        // Resolve permission server-side
        let cache = self.session_cache.lock().await;
        let resolved = permissions::resolve_permission(
            &request.tool_name,
            &request.input,
            &self.worktree_path,
            &cache,
        );
        drop(cache);

        match resolved {
            ResolvedPermission::Allow => {
                debug!(tool_name = %request.tool_name, "auto-allowed");
                return PermissionResult::Allow {
                    updated_input: None,
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id),
                };
            }
            ResolvedPermission::Deny { reason } => {
                debug!(tool_name = %request.tool_name, reason = %reason, "auto-denied");
                return PermissionResult::Deny {
                    message: reason,
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id),
                };
            }
            ResolvedPermission::NeedsPrompt {
                description,
                pattern,
            } => {
                // Check if pattern is in pre-loaded allowed patterns from settings files
                if self.allowed_patterns.contains(&pattern) {
                    debug!(tool_name = %request.tool_name, pattern = %pattern, "allowed by settings pattern");
                    self.session_cache.lock().await.insert(pattern);
                    return PermissionResult::Allow {
                        updated_input: None,
                        updated_permissions: None,
                        tool_use_id: Some(request.tool_use_id),
                    };
                }

                // Must prompt the user via WebSocket
                debug!(tool_name = %request.tool_name, pattern = %pattern, "prompting user");
                let payload = PermissionRequestPayload {
                    request_id: request.tool_use_id.clone(),
                    tool_name: request.tool_name.clone(),
                    tool_input: request.input.clone(),
                    description: Some(description),
                    pattern: Some(pattern.clone()),
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
                    Some(response) => {
                        match response.decision {
                            PermissionDecision::AllowOnce => {
                                self.session_cache.lock().await.insert(pattern);
                                PermissionResult::Allow {
                                    updated_input: response.updated_input,
                                    updated_permissions: None,
                                    tool_use_id: Some(request.tool_use_id),
                                }
                            }
                            PermissionDecision::AllowFuture => {
                                self.session_cache.lock().await.insert(pattern.clone());
                                if let Err(e) = permissions::append_to_settings_local(
                                    &self.worktree_path,
                                    &pattern,
                                ) {
                                    error!(error = %e, "failed to persist permission to settings.local.json");
                                }
                                PermissionResult::Allow {
                                    updated_input: response.updated_input,
                                    updated_permissions: None,
                                    tool_use_id: Some(request.tool_use_id),
                                }
                            }
                            PermissionDecision::Deny => {
                                let message = response
                                    .feedback
                                    .unwrap_or_else(|| "User denied permission".to_string());
                                PermissionResult::Deny {
                                    message,
                                    interrupt: Some(false),
                                    tool_use_id: Some(request.tool_use_id),
                                }
                            }
                        }
                    }
                    None => {
                        PermissionResult::Deny {
                            message: "Permission channel closed".to_string(),
                            interrupt: Some(false),
                            tool_use_id: Some(request.tool_use_id),
                        }
                    }
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
        permission_tx: mpsc::Sender<PermissionResponse>,
    },
}

/// Serializable session config for respawning with --resume after model change.
#[derive(Clone)]
struct SessionConfig {
    cwd: PathBuf,
    /// Pre-canonicalized worktree path for permission checks (avoids repeated syscalls).
    canonical_cwd: PathBuf,
    permission_mode: Option<PermissionMode>,
    system_prompt: Option<String>,
}

/// Handle for a running SDK session, stored per-connection.
/// Keyed by `i64` (agent_sessions.id). DB is the source of truth for session
/// config; memory holds only live process state and ephemeral tracking.
struct SdkHandle {
    state: QueryState,
    /// feature_id for persistence lookups.
    feature_id: i64,
    /// The model the user wants for the next turn. Updated by model.set.
    desired_model: Option<String>,
    /// The model the CLI was actually spawned with.
    spawned_model: Option<String>,
    /// The permission mode the user wants. Updated by mode.set.
    desired_permission_mode: Option<PermissionMode>,
    /// The permission mode the CLI was actually spawned with.
    spawned_permission_mode: Option<PermissionMode>,
    /// Session-level cache of approved permission patterns.
    session_cache: Arc<Mutex<HashSet<String>>>,
    /// Pre-loaded allowed patterns from settings files.
    allowed_patterns: Arc<HashSet<String>>,
    /// Claude CLI session ID to use for --resume on the first prompt.
    /// Set from the DB row at init time; consumed (taken) when spawning.
    resume_session_id: Option<String>,
    /// Config for respawning with --resume after model/mode change.
    config: SessionConfig,
}

type SdkSessions = Arc<Mutex<HashMap<i64, SdkHandle>>>;
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
        if let QueryState::Active { query, .. } = handle.state {
            persist_and_close_query(&query, &state.write_pool, db_session_id).await;
        }
        WsSessionPersistence::mark_paused_static(&state.write_pool, db_session_id).await;
    }
    drop(sessions);

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
        "init" => handle_init(envelope, sender, sdk_sessions, app_state).await,
        "prompt.send" => handle_prompt_send(envelope, sender, sdk_sessions, app_state).await,
        "permission.respond" => {
            handle_permission_respond(envelope, sender, sdk_sessions).await
        }
        "model.set" => handle_model_set(envelope, sender, sdk_sessions, app_state).await,
        "mode.set" => handle_mode_set(envelope, sender, sdk_sessions, app_state).await,
        "interrupt" => handle_interrupt(envelope, sender, sdk_sessions).await,
        "destroy" => handle_destroy(envelope, sender, sdk_sessions, app_state).await,
        "clear" => handle_clear(envelope, sender, sdk_sessions, app_state).await,
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

/// Handle session.init: DB-driven session creation.
async fn handle_init(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionInitPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    // feature_id is required for DB-first sessions
    let feature_id = match payload.feature_id {
        Some(fid) => fid,
        None => {
            send_error(sender, &envelope.id, "MISSING_FEATURE_ID", "feature_id is required for session init");
            return;
        }
    };

    // cwd is required
    let cwd = match payload.cwd {
        Some(ref cwd) if !cwd.is_empty() => cwd.clone(),
        _ => {
            send_error(sender, &envelope.id, "MISSING_CWD", "cwd is required for session init");
            return;
        }
    };

    // Find or create DB session row
    info!(feature_id, "handle_init: looking up session in DB for feature_id");
    let mut persistence = WsSessionPersistence::new(app_state.write_pool.clone(), feature_id);
    let pm_str = payload.permission_mode.as_deref();
    let db_session_id = match persistence.find_or_create_session(payload.model.as_deref(), pm_str).await {
        Some(id) => {
            info!(feature_id, db_session_id = id, "handle_init: found/created session row");
            id
        }
        None => {
            send_error(sender, &envelope.id, "DB_ERROR", "Failed to create/find session in database");
            return;
        }
    };

    // Read claude_session_id from DB row so we can --resume on first prompt.
    let resume_session_id = if let Some(row) = WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await {
        debug!(
            db_session_id,
            feature_id,
            claude_session_id = ?row.claude_session_id,
            status = %row.status,
            "handle_init: DB row state at init time"
        );
        row.claude_session_id
    } else {
        None
    };

    // Build SDK options
    let mut options = Options::default();
    options.cwd = std::path::PathBuf::from(&cwd);
    if let Some(ref model) = payload.model {
        options.model = Some(model.clone());
    }
    if let Some(ref pm) = payload.permission_mode {
        options.permission_mode = Some(parse_permission_mode(pm));
    }
    if let Some(ref sp) = payload.system_prompt {
        options.system_prompt = Some(sp.clone());
    }

    info!(db_session_id, feature_id, "session initialized (pending first prompt)");

    let desired_model = options.model.clone();
    let desired_permission_mode = options.permission_mode.clone();
    let canonical_cwd = permissions::canonicalize_worktree(&options.cwd);
    let config = SessionConfig {
        cwd: options.cwd.clone(),
        canonical_cwd: canonical_cwd.clone(),
        permission_mode: options.permission_mode.clone(),
        system_prompt: options.system_prompt.clone(),
    };
    let allowed_patterns = Arc::new(permissions::load_allowed_patterns(&options.cwd));
    let session_cache = Arc::new(Mutex::new(HashSet::new()));

    let handle = SdkHandle {
        state: QueryState::Pending(options),
        feature_id,
        desired_model,
        spawned_model: None,
        desired_permission_mode,
        spawned_permission_mode: None,
        resume_session_id,
        config,
        session_cache,
        allowed_patterns,
    };

    sdk_sessions
        .lock()
        .await
        .insert(db_session_id, handle);

    // Send initialized response — session_id is now the DB id as a string
    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "initialized",
        serde_json::to_value(SessionInitializedPayload {
            session_id: db_session_id.to_string(),
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Parse a session_id string from client payload into i64 DB key.
fn parse_session_id(s: &str) -> Option<i64> {
    s.parse::<i64>().ok()
}

/// Persist the Claude CLI session ID from a Query, close it, and return the ID.
async fn persist_and_close_query(query: &Mutex<Query>, pool: &sqlx::SqlitePool, db_session_id: i64) -> Option<String> {
    let mut q = query.lock().await;
    let cli_sid = q.session_id().await.map(|s| s.to_string());
    if let Some(ref sid) = cli_sid {
        debug!(db_session_id, claude_session_id = %sid, "persist_and_close: saving session_id");
        WsSessionPersistence::persist_claude_session_id_static(pool, db_session_id, sid).await;
    }
    q.close().await;
    cli_sid
}

/// Handle session.prompt.send: send prompt to CLI or spawn new query.
async fn handle_prompt_send(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: PromptSendPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "session_id must be a numeric DB id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                &format!("Session {db_session_id} not found. Send session.init first."),
            );
            return;
        }
    };

    // Check if we need to respawn due to model or permission mode change
    let model_changed = handle.desired_model != handle.spawned_model;
    let mode_changed = handle.desired_permission_mode != handle.spawned_permission_mode;
    let needs_respawn = matches!(&handle.state, QueryState::Active { .. })
        && (model_changed || mode_changed);

    if needs_respawn {
        info!(
            db_session_id,
            old_model = ?handle.spawned_model,
            new_model = ?handle.desired_model,
            old_mode = ?handle.spawned_permission_mode,
            new_mode = ?handle.desired_permission_mode,
            "model/mode changed, respawning CLI with --resume"
        );

        // Get claude session ID, persist it, and close the old query
        let claude_session_id = if let QueryState::Active { query, .. } = &handle.state {
            let mut q = query.lock().await;
            let sid = q.session_id().await;
            if let Some(ref cli_sid) = sid {
                WsSessionPersistence::persist_claude_session_id_static(
                    &app_state.write_pool, db_session_id, cli_sid,
                ).await;
            }
            q.close().await;
            sid
        } else {
            None
        };

        // Build fresh options with new model/mode + resume
        let options = Options {
            cwd: handle.config.cwd.clone(),
            permission_mode: handle.desired_permission_mode.clone(),
            model: handle.desired_model.clone(),
            system_prompt: handle.config.system_prompt.clone(),
            resume: claude_session_id,
            ..Options::default()
        };

        // Reset to pending so the spawn logic below handles it
        handle.spawned_model = handle.desired_model.clone();
        handle.spawned_permission_mode = handle.desired_permission_mode.clone();
        handle.config.permission_mode = handle.desired_permission_mode.clone();
        handle.state = QueryState::Pending(options);
    }

    match &handle.state {
        QueryState::Pending(_) => {
            // First prompt (or respawn after model change) — take the stored options and spawn.
            let spawned_model = handle.desired_model.clone();
            let config = handle.config.clone();
            let session_cache = handle.session_cache.clone();
            let allowed_patterns = handle.allowed_patterns.clone();
            let worktree_path = handle.config.canonical_cwd.clone();
            let feature_id = handle.feature_id;
            let mut options = match std::mem::replace(
                &mut handle.state,
                QueryState::Pending(Options::default()),
            ) {
                QueryState::Pending(opts) => opts,
                _ => unreachable!(),
            };

            // Use the claude_session_id captured at init time for --resume
            if options.resume.is_none() {
                if let Some(cli_sid) = handle.resume_session_id.take() {
                    info!(db_session_id, claude_session_id = %cli_sid, "resuming previous CLI session");
                    options.resume = Some(cli_sid);
                } else {
                    debug!(db_session_id, feature_id, "no claude_session_id found, spawning fresh");
                }
            }

            // Drop lock before spawning (async).
            drop(sessions);

            // Persist user message (session row already exists from handle_init)
            let write_pool = app_state.write_pool.clone();
            {
                let p = WsSessionPersistence::with_session_id(write_pool.clone(), feature_id, Some(db_session_id));
                p.persist_user_message(&payload.text).await;
            }

            // Set up permission bridge
            let (permission_tx, permission_rx) = mpsc::channel::<PermissionResponse>(16);
            let bridge = WsBridgeCanUseTool {
                sender: sender.clone(),
                response_rx: Arc::new(Mutex::new(permission_rx)),
                worktree_path,
                session_cache: session_cache.clone(),
                allowed_patterns: allowed_patterns.clone(),
            };
            options.can_use_tool = Some(Box::new(bridge));

            info!(db_session_id, prompt = %payload.text, model = ?options.model, "spawning SDK query");
            match claude_agent_sdk_rs::query(&payload.text, options).await {
                Ok(mut real_query) => {
                    info!(db_session_id, "SDK query spawned successfully, starting stream reader");
                    let message_rx = real_query.take_message_rx();
                    let query_arc = Arc::new(Mutex::new(real_query));

                    spawn_stream_reader(
                        db_session_id,
                        feature_id,
                        message_rx,
                        sender.clone(),
                        app_state.write_pool.clone(),
                    );

                    // Fire-and-forget auto-naming for first prompt
                    {
                        let write_pool = app_state.write_pool.clone();
                        let cwd = config.cwd.to_string_lossy().to_string();
                        let prompt_text = payload.text.clone();
                        let naming_sender = sender.clone();
                        tokio::spawn(async move {
                            if super::auto_name::has_default_title(&write_pool, feature_id).await {
                                let result = super::auto_name::auto_name_feature(
                                    write_pool,
                                    feature_id,
                                    prompt_text,
                                    cwd,
                                    None,
                                    naming_sender,
                                ).await;
                                info!(feature_id, name = ?result, "auto-named feature");
                            }
                        });
                    }

                    let spawned_pm = config.permission_mode.clone();
                    let mut sessions = sdk_sessions.lock().await;
                    sessions.insert(
                        db_session_id,
                        SdkHandle {
                            state: QueryState::Active {
                                query: query_arc,
                                permission_tx,
                            },
                            feature_id,
                            desired_model: spawned_model.clone(),
                            spawned_model,
                            desired_permission_mode: spawned_pm.clone(),
                            spawned_permission_mode: spawned_pm,
                            resume_session_id: None,
                            config,
                            session_cache,
                            allowed_patterns,
                        },
                    );
                }
                Err(e) => {
                    error!(db_session_id, error = %e, "SDK query spawn failed");
                    send_error(sender, &envelope.id, "SDK_SPAWN_ERROR", &e.to_string());
                }
            }
        }
        QueryState::Active { query, .. } => {
            // Persist follow-up user message
            let p = WsSessionPersistence::with_session_id(
                app_state.write_pool.clone(), handle.feature_id, Some(db_session_id),
            );
            p.persist_user_message(&payload.text).await;

            let q = query.lock().await;
            let turn_state = q.turn_state().await;
            info!(db_session_id, turn_state = ?turn_state, "follow-up prompt");
            let content = serde_json::json!(payload.text);
            if let Err(e) = q.stream_input(content).await {
                error!(db_session_id, error = %e, "stream_input failed");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
            }
        }
    }
}

/// Handle session.permission.respond
async fn handle_permission_respond(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
) {
    let payload: PermissionRespondPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
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

    let response = PermissionResponse {
        decision: payload.decision,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
    };

    if permission_tx.send(response).await.is_err() {
        send_error(
            sender,
            &envelope.id,
            "CHANNEL_ERROR",
            "Permission channel closed",
        );
    }
}

/// Handle session.model.set: change the model and persist to DB.
async fn handle_model_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ModelSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    info!(db_session_id, model = %payload.model, "updating desired model");
    handle.desired_model = Some(payload.model.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            options.model = Some(payload.model.clone());
        }
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.set_model(&payload.model).await {
                error!(db_session_id, error = %e, "failed to set model on active query");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
                return;
            }
        }
    }

    // Persist to DB
    WsSessionPersistence::update_model_static(&app_state.write_pool, db_session_id, &payload.model).await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "model.set.ok",
        serde_json::to_value(serde_json::json!({ "model": payload.model })).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.mode.set: change the permission mode and persist to DB.
async fn handle_mode_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ModeSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let new_mode = parse_permission_mode(&payload.mode);

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    info!(db_session_id, mode = %payload.mode, "updating permission mode");
    handle.desired_permission_mode = Some(new_mode.clone());
    handle.config.permission_mode = Some(new_mode.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            options.permission_mode = Some(new_mode);
        }
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.set_permission_mode(new_mode).await {
                error!(db_session_id, error = %e, "failed to set permission mode on active query");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
                return;
            }
        }
    }

    // Persist to DB
    WsSessionPersistence::update_permission_mode_static(&app_state.write_pool, db_session_id, &payload.mode).await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "mode.changed",
        serde_json::to_value(serde_json::json!({ "mode": payload.mode })).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.interrupt
async fn handle_interrupt(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
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
    }
}

/// Handle session.destroy: mark completed in DB, close subprocess.
async fn handle_destroy(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    if let Some(handle) = sessions.remove(&db_session_id) {
        if let QueryState::Active { query, .. } = handle.state {
            persist_and_close_query(&query, &app_state.write_pool, db_session_id).await;
        }
    }

    // Mark completed in DB
    WsSessionPersistence::mark_completed_static(&app_state.write_pool, db_session_id).await;

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

/// Handle session.clear: archive claude_session_id, insert divider, reset handle.
async fn handle_clear(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(sender, &envelope.id, "INVALID_SESSION_ID", "Invalid session_id");
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(sender, &envelope.id, "SESSION_NOT_FOUND", "Session not found");
            return;
        }
    };

    // Close active subprocess if any, capturing claude_session_id for archive
    let cli_sid = if let QueryState::Active { query, .. } = &handle.state {
        persist_and_close_query(query, &app_state.write_pool, db_session_id).await
    } else {
        None
    };

    // Archive and clear in DB (pass cli_sid to avoid re-reading it)
    WsSessionPersistence::archive_and_clear(&app_state.write_pool, db_session_id, cli_sid.as_deref()).await;

    // Reset handle to Pending with fresh options (no resume)
    let fresh_options = Options {
        cwd: handle.config.cwd.clone(),
        permission_mode: handle.desired_permission_mode.clone(),
        model: handle.desired_model.clone(),
        system_prompt: handle.config.system_prompt.clone(),
        ..Options::default()
    };
    handle.state = QueryState::Pending(fresh_options);

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "cleared",
        serde_json::json!({ "session_id": db_session_id.to_string() }),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Spawn a background task that reads from the SDK message receiver and forwards
/// messages to the WebSocket client.
fn spawn_stream_reader(
    db_session_id: i64,
    feature_id: i64,
    mut message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,
    sender: WsSender,
    write_pool: sqlx::SqlitePool,
) {
    tokio::spawn(async move {
        info!(db_session_id, "stream reader started");
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(), feature_id, Some(db_session_id),
        );
        // Capture the CLI session ID from the first message that has one.
        // Every SdkMessage variant carries a session_id field.
        let mut needs_session_id_capture = true;

        loop {
            let msg = message_rx.recv().await;

            match msg {
                Some(Ok(sdk_msg)) => {
                    debug!(db_session_id, msg_type = ?std::mem::discriminant(&sdk_msg), "SDK MSG → WS");

                    if needs_session_id_capture {
                        if let Some(cli_sid) = sdk_msg.session_id() {
                            if !cli_sid.is_empty() {
                                needs_session_id_capture = false;
                                info!(db_session_id, claude_session_id = %cli_sid, "stream_reader: persisting CLI session_id to DB");
                                WsSessionPersistence::persist_claude_session_id_static(
                                    &write_pool, db_session_id, cli_sid,
                                ).await;
                            }
                        }
                    }

                    // Persist before forwarding (best-effort)
                    persistence.persist_sdk_message(&sdk_msg).await;

                    // Extract and broadcast token usage (mirrors legacy SdkQueryRunner behavior)
                    if let Some(usage) = sdk_msg.usage() {
                        let total_input = usage.input_tokens
                            + usage.cache_creation_input_tokens.unwrap_or(0)
                            + usage.cache_read_input_tokens.unwrap_or(0);
                        let total_output = usage.output_tokens;

                        // Persist to DB (best-effort)
                        WsSessionPersistence::update_token_usage(&write_pool, db_session_id, total_input, total_output).await;

                        // Broadcast to frontend
                        let usage_env = WsEnvelope::new(
                            "session",
                            "usage_update",
                            serde_json::to_value(SessionUsageUpdatePayload {
                                input_tokens: total_input,
                                output_tokens: total_output,
                                context_window: 200_000,
                            }).unwrap(),
                        );
                        let _ = sender.send(Message::Text(String::from(usage_env).into()));
                    }

                    let envelope = match &sdk_msg {
                        SdkMessage::Result { .. } => {
                            // Mark session completed
                            WsSessionPersistence::mark_completed_static(&write_pool, db_session_id).await;
                            WsEnvelope::new(
                                "session",
                                "ended",
                                serde_json::to_value(SessionEndedPayload {
                                    reason: "turn_complete".into(),
                                })
                                .unwrap(),
                            )
                        }
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
                        debug!(db_session_id, "WebSocket sender closed, stopping stream reader");
                        break;
                    }
                }
                Some(Err(e)) => {
                    error!(db_session_id, error = %e, "SDK stream error");
                    WsSessionPersistence::mark_paused_static(&write_pool, db_session_id).await;
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
                    info!(db_session_id, "SDK stream closed");
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
                ended_at TEXT
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

        AppState {
            read_pool: pool.clone(),
            write_pool: pool,
            electron_port: 0,
        }
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
}
