use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::ws::Message;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info};

use claude_agent_sdk_rs::{
    CanUseTool, Options, PermissionRequest, PermissionResult, SdkError, SdkMessage, SystemMessage,
};

use crate::app_state::AppState;
use super::super::permissions::{self, ResolvedPermission};
use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::{
    parse_session_id, send_error, send_claude_session_id,
    QueryState, SdkHandle, SdkSessions, WsSender,
};

/// Build the content value for the Claude CLI.
/// Returns a plain string Value when no images, or a JSON array of content blocks when images are present.
fn build_content_value(text: &str, images: &[ImagePayload]) -> serde_json::Value {
    if images.is_empty() {
        serde_json::Value::String(text.to_string())
    } else {
        let mut blocks: Vec<serde_json::Value> = Vec::with_capacity(1 + images.len());
        blocks.push(serde_json::json!({
            "type": "text",
            "text": text
        }));
        for img in images {
            blocks.push(serde_json::json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.mime_type,
                    "data": img.base64
                }
            }));
        }
        serde_json::Value::Array(blocks)
    }
}

/// Build the persistence string for a user message.
/// Plain text when no images, JSON-serialized content blocks when images are present.
fn build_persist_content(text: &str, images: &[ImagePayload]) -> String {
    if images.is_empty() {
        text.to_string()
    } else {
        let content = build_content_value(text, images);
        serde_json::to_string(&content).unwrap_or_else(|_| text.to_string())
    }
}

/// Response sent through the permission channel from the WebSocket handler.
pub struct PermissionResponse {
    pub(crate) decision: PermissionDecision,
    pub(crate) feedback: Option<String>,
    pub(crate) updated_input: Option<serde_json::Value>,
}

/// CanUseTool implementation that resolves permissions server-side when possible,
/// and bridges to the WebSocket client only when user approval is needed.
struct WsBridgeCanUseTool {
    sender: WsSender,
    response_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
    worktree_path: PathBuf,
    session_cache: Arc<Mutex<HashSet<String>>>,
    allowed_patterns: Arc<HashSet<String>>,
    feature_id: i64,
    db_session_id: i64,
    write_pool: sqlx::SqlitePool,
    turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
}

#[async_trait]
impl CanUseTool for WsBridgeCanUseTool {
    async fn can_use_tool(&self, request: PermissionRequest) -> PermissionResult {
        debug!(
            tool_name = %request.tool_name,
            tool_use_id = %request.tool_use_id,
            "WsBridgeCanUseTool::can_use_tool called"
        );

        // EnterPlanMode: persist permission_mode = 'plan' to DB
        if request.tool_name == "EnterPlanMode" {
            let _ = sqlx::query("UPDATE agent_sessions SET permission_mode = 'plan' WHERE id = ?")
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
            return PermissionResult::Allow {
                updated_input: request.input,
                updated_permissions: None,
                tool_use_id: Some(request.tool_use_id),
            };
        }

        // Intercept ExitPlanMode: persist to DB, send plan_approval event, and block until user responds.
        if request.tool_name == "ExitPlanMode" {
            // Check for a stored approval result (set when user approved while CLI was not running)
            #[derive(sqlx::FromRow)]
            struct ApprovalRow {
                plan_approval_result: Option<String>,
            }
            if let Ok(Some(row)) = sqlx::query_as::<_, ApprovalRow>(
                "SELECT plan_approval_result FROM agent_sessions WHERE id = ?"
            )
                .bind(self.db_session_id)
                .fetch_optional(&self.write_pool)
                .await
            {
                if let Some(ref result_str) = row.plan_approval_result {
                    if let Ok(result) = serde_json::from_str::<serde_json::Value>(result_str) {
                        // Clear stored result
                        let _ = sqlx::query(
                            "UPDATE agent_sessions SET plan_approval_result = NULL, pending_plan_approval = NULL WHERE id = ?"
                        )
                            .bind(self.db_session_id)
                            .execute(&self.write_pool)
                            .await;

                        let approved = result.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
                        if approved {
                            info!("ExitPlanMode: using stored approval result (approved)");
                            return PermissionResult::Allow {
                                updated_input: request.input,
                                updated_permissions: None,
                                tool_use_id: Some(request.tool_use_id),
                            };
                        } else {
                            let feedback = result.get("feedback")
                                .and_then(|v| v.as_str())
                                .unwrap_or("User requested changes to the plan.")
                                .to_string();
                            info!("ExitPlanMode: using stored approval result (denied)");
                            return PermissionResult::Deny {
                                message: feedback,
                                interrupt: Some(false),
                                tool_use_id: Some(request.tool_use_id),
                            };
                        }
                    }
                }
            }

            info!("ExitPlanMode detected, sending plan_approval and blocking");

            // Persist pending_plan_approval to DB so it survives app restarts
            let approval_json = serde_json::to_string(&request.input).unwrap_or_else(|_| "{}".to_string());
            let _ = sqlx::query("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
                .bind(&approval_json)
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;

            let payload = PermissionRequestPayload {
                request_id: request.tool_use_id.clone(),
                tool_name: request.tool_name.clone(),
                tool_input: request.input.clone(),
                description: Some("Plan is ready for approval".to_string()),
                pattern: None,
            };
            let envelope = WsEnvelope::new(
                "session",
                "permission.request",
                serde_json::to_value(payload).unwrap(),
            );
            let _ = self.sender.send(Message::Text(String::from(envelope).into()));

            WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "askUser");

            let mut rx = self.response_rx.lock().await;
            return match rx.recv().await {
                Some(response) => {
                    // Clear pending_plan_approval from DB
                    let _ = sqlx::query("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?")
                        .bind(self.db_session_id)
                        .execute(&self.write_pool)
                        .await;

                    WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "claude");
                    match response.decision {
                        PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => {
                            // Persist approval as a user message and switch to acceptEdits mode
                            let p = WsSessionPersistence::with_session_id(
                                self.write_pool.clone(), self.feature_id, Some(self.db_session_id),
                            );
                            p.persist_user_message("Plan approved.").await;
                            let _ = sqlx::query("UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE id = ?")
                                .bind(self.db_session_id)
                                .execute(&self.write_pool)
                                .await;
                            PermissionResult::Allow {
                                updated_input: request.input,
                                updated_permissions: None,
                                tool_use_id: Some(request.tool_use_id),
                            }
                        }
                        PermissionDecision::Deny => {
                            let feedback = response
                                .feedback
                                .unwrap_or_else(|| "User requested changes to the plan.".to_string());
                            // Persist feedback as a user message so it appears in conversation history
                            let p = WsSessionPersistence::with_session_id(
                                self.write_pool.clone(), self.feature_id, Some(self.db_session_id),
                            );
                            p.persist_user_message(&feedback).await;
                            PermissionResult::Deny {
                                message: feedback,
                                interrupt: Some(false),
                                tool_use_id: Some(request.tool_use_id),
                            }
                        }
                    }
                }
                None => {
                    // Channel closed (e.g., app restart) — leave pending_plan_approval in DB
                    // so it can be restored when the session reconnects.
                    PermissionResult::Deny {
                        message: "Plan approval channel closed".to_string(),
                        interrupt: Some(false),
                        tool_use_id: Some(request.tool_use_id),
                    }
                }
            };
        }

        // Tools like AskUserQuestion must always be forwarded to the frontend
        // so the UI can display a dynamic form and collect the user's response.
        let force_prompt = permissions::FRONTEND_PROMPT_TOOLS.contains(&request.tool_name.as_str());

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
                    updated_input: request.input,
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
                // Check if pattern is in pre-loaded allowed patterns from settings files.
                // Skip for force_prompt tools — they always need the frontend round-trip.
                if !force_prompt && self.allowed_patterns.contains(&pattern) {
                    debug!(tool_name = %request.tool_name, pattern = %pattern, "allowed by settings pattern");
                    self.session_cache.lock().await.insert(pattern);
                    return PermissionResult::Allow {
                        updated_input: request.input,
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

                // Broadcast turn → askUser
                WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "askUser");

                // Wait for user response
                let original_input = request.input;
                let mut rx = self.response_rx.lock().await;
                match rx.recv().await {
                    Some(response) => {
                        // Broadcast turn → claude (user responded)
                        WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "claude");

                        let input = response.updated_input.unwrap_or(original_input);
                        match response.decision {
                            PermissionDecision::AllowOnce => {
                                if !force_prompt {
                                    self.session_cache.lock().await.insert(pattern);
                                }
                                PermissionResult::Allow {
                                    updated_input: input,
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
                                    updated_input: input,
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

/// Handle session.prompt.send: send prompt to CLI or spawn new query.
pub(super) async fn handle_prompt_send(
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
            let persist_content = build_persist_content(&payload.text, &payload.images);
            {
                let p = WsSessionPersistence::with_session_id(write_pool.clone(), feature_id, Some(db_session_id));
                p.persist_user_message(&persist_content).await;
            }

            // Set up permission bridge
            let (permission_tx, permission_rx) = mpsc::channel::<PermissionResponse>(16);
            let bridge = WsBridgeCanUseTool {
                sender: sender.clone(),
                response_rx: Arc::new(Mutex::new(permission_rx)),
                worktree_path,
                session_cache: session_cache.clone(),
                allowed_patterns: allowed_patterns.clone(),
                feature_id,
                db_session_id,
                write_pool: write_pool.clone(),
                turn_state_tx: app_state.turn_state_tx.clone(),
            };
            options.can_use_tool = Some(Box::new(bridge));

            let content_value = build_content_value(&payload.text, &payload.images);
            info!(db_session_id, prompt = %payload.text, model = ?options.model, "spawning SDK query");
            match claude_agent_sdk_rs::query(content_value, options).await {
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
                        app_state.turn_state_tx.clone(),
                        sdk_sessions.clone(),
                        spawned_model.as_deref(),
                    );

                    // Fire-and-forget auto-naming for first prompt
                    {
                        let write_pool = app_state.write_pool.clone();
                        let cwd = config.cwd.to_string_lossy().to_string();
                        let prompt_text = payload.text.clone();
                        let naming_sender = sender.clone();
                        tokio::spawn(async move {
                            if super::super::auto_name::has_default_title(&write_pool, feature_id).await {
                                let result = super::super::auto_name::auto_name_feature(
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
            let persist_content = build_persist_content(&payload.text, &payload.images);
            let p = WsSessionPersistence::with_session_id(
                app_state.write_pool.clone(), handle.feature_id, Some(db_session_id),
            );
            p.persist_user_message(&persist_content).await;

            let q = query.lock().await;
            let turn_state = q.turn_state().await;
            info!(db_session_id, turn_state = ?turn_state, "follow-up prompt");
            let content = build_content_value(&payload.text, &payload.images);
            if let Err(e) = q.stream_input(content).await {
                error!(db_session_id, error = %e, "stream_input failed");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
            }
        }
    }
}

/// Spawn a background task that reads from the SDK message receiver and forwards
/// messages to the WebSocket client.
pub(super) fn spawn_stream_reader(
    db_session_id: i64,
    feature_id: i64,
    mut message_rx: mpsc::Receiver<Result<SdkMessage, SdkError>>,
    sender: WsSender,
    write_pool: sqlx::SqlitePool,
    turn_state_tx: tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
    sdk_sessions: SdkSessions,
    model: Option<&str>,
) {
    let initial_context_window = model
        .map(|m| crate::domain::usage::context_window_for_model(m))
        .unwrap_or(crate::api::DEFAULT_CONTEXT_WINDOW);
    tokio::spawn(async move {
        info!(db_session_id, "stream reader started");
        let mut persistence = WsSessionPersistence::with_session_id(
            write_pool.clone(), feature_id, Some(db_session_id),
        );
        // Capture the CLI session ID from the first message that has one.
        // Every SdkMessage variant carries a session_id field.
        let mut needs_session_id_capture = true;
        let mut context_window: u64 = initial_context_window;

        loop {
            let msg = message_rx.recv().await;

            match msg {
                Some(Ok(sdk_msg)) => {
                    if needs_session_id_capture {
                        if let Some(cli_sid) = sdk_msg.session_id() {
                            if !cli_sid.is_empty() {
                                needs_session_id_capture = false;
                                info!(db_session_id, claude_session_id = %cli_sid, "stream_reader: persisting CLI session_id to DB");
                                WsSessionPersistence::persist_claude_session_id_static(
                                    &write_pool, db_session_id, cli_sid,
                                ).await;
                                // Notify frontend of the Claude Code session ID
                                send_claude_session_id(&sender, cli_sid);
                            }
                        }
                    }

                    // Capture context window from init model
                    if let SdkMessage::System(SystemMessage::Init { ref model, .. }) = sdk_msg {
                        context_window = crate::domain::usage::context_window_for_model(model);
                        WsSessionPersistence::update_context_window(&write_pool, db_session_id, context_window).await;
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
                                context_window,
                            }).unwrap(),
                        );
                        let _ = sender.send(Message::Text(String::from(usage_env).into()));
                    }

                    let envelope = match &sdk_msg {
                        SdkMessage::Result { .. } => {
                            // Mark session completed
                            WsSessionPersistence::mark_completed_static(&write_pool, db_session_id).await;
                            WsSessionPersistence::broadcast_turn_state(&turn_state_tx, feature_id, "none");
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
                    WsSessionPersistence::broadcast_turn_state(&turn_state_tx, feature_id, "none");
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

        // Transition Active → Pending so the next prompt.send spawns a fresh
        // CLI process with --resume instead of writing to the dead stdin.
        let mut sessions = sdk_sessions.lock().await;
        if let Some(handle) = sessions.get_mut(&db_session_id) {
            if let QueryState::Active { ref query, .. } = handle.state {
                let q = query.lock().await;
                let claude_session_id = q.session_id().await;
                drop(q);

                let options = Options {
                    cwd: handle.config.cwd.clone(),
                    permission_mode: handle.desired_permission_mode.clone(),
                    model: handle.desired_model.clone(),
                    system_prompt: handle.config.system_prompt.clone(),
                    resume: claude_session_id,
                    ..Options::default()
                };

                info!(db_session_id, "stream ended, transitioning Active → Pending for resume");
                handle.state = QueryState::Pending(options);
            }
        }

    });
}
