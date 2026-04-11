use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::ws::Message;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info, warn};

use claude_agent_sdk_rs::{CanUseTool, PermissionRequest, PermissionResult};

use super::super::permissions;
use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::{
    parse_session_id, send_claude_session_id, send_error, QueryState, SdkHandle, SdkSessions,
    WsSender,
};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{RuntimeMessageRx, RuntimeSpawnConfig};
use crate::domain::agents::runtime_adapter;
use crate::domain::permission_bridge::{self, ResolvedAction};
use crate::domain::workflow::engine::WsSender as WorkflowWsSender;
use crate::domain::workflow::worktree;

/// Build the content value for the Claude CLI.
/// Returns a plain string Value when no images, or a JSON array of content blocks when images are present.
pub(crate) fn build_content_value(text: &str, images: &[ImagePayload]) -> serde_json::Value {
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
pub(crate) fn build_persist_content(text: &str, images: &[ImagePayload]) -> String {
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
            return self.handle_exit_plan_mode(&request).await;
        }

        // Standard permission resolution via shared bridge
        let action = permission_bridge::resolve_permission_check(
            &request,
            &self.worktree_path,
            &self.session_cache,
            &self.allowed_patterns,
        )
        .await;

        match action {
            ResolvedAction::Resolved(result) => result,
            ResolvedAction::NeedsPrompt {
                description,
                pattern,
                force_prompt,
            } => {
                self.handle_needs_prompt(&request, description, pattern, force_prompt)
                    .await
            }
        }
    }
}

impl WsBridgeCanUseTool {
    /// Handle ExitPlanMode: check for stored approval, send plan_approval
    /// event, and block until user responds.
    async fn handle_exit_plan_mode(&self, request: &PermissionRequest) -> PermissionResult {
        // Check for a stored approval result (set when user approved while CLI was not running)
        if let Some(result) = self.check_stored_approval(request).await {
            return result;
        }

        info!("ExitPlanMode detected, sending plan_approval and blocking");

        // Persist pending_plan_approval to DB so it survives app restarts
        let approval_json =
            serde_json::to_string(&request.input).unwrap_or_else(|_| "{}".to_string());
        if let Err(e) =
            sqlx::query("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
                .bind(&approval_json)
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await
        {
            warn!(session_id = self.db_session_id, error = %e, "failed to persist pending_plan_approval");
        }

        // Send permission.request immediately so the frontend shows the approval
        // bar without delay (the plan content is attached below).
        self.send_plan_permission_request(request, request.input.clone());

        WsSessionPersistence::broadcast_turn_state(&self.turn_state_tx, self.feature_id, "askUser");

        // Attach plan content and send enriched permission.request so PlanBlock
        // renders both live and after app restart.
        let enriched_input = self.attach_plan_to_exit_block(request).await;
        if enriched_input != request.input {
            let enriched_json =
                serde_json::to_string(&enriched_input).unwrap_or_else(|_| "{}".to_string());
            if let Err(e) =
                sqlx::query("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
                    .bind(&enriched_json)
                    .bind(self.db_session_id)
                    .execute(&self.write_pool)
                    .await
            {
                warn!(session_id = self.db_session_id, error = %e, "failed to persist enriched pending_plan_approval");
            }
            self.send_plan_permission_request(request, enriched_input);
        }

        let mut rx = self.response_rx.lock().await;
        match rx.recv().await {
            Some(response) => {
                if let Err(e) = sqlx::query(
                    "UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?",
                )
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await
                {
                    warn!(session_id = self.db_session_id, error = %e, "failed to clear pending_plan_approval");
                }

                WsSessionPersistence::broadcast_turn_state(
                    &self.turn_state_tx,
                    self.feature_id,
                    "claude",
                );
                self.apply_exit_plan_decision(request, response).await
            }
            None => {
                // Channel closed — leave pending_plan_approval in DB for reconnect
                PermissionResult::Deny {
                    message: "Plan approval channel closed".to_string(),
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id.clone()),
                }
            }
        }
    }

    /// Check for a stored plan approval result from a previous session.
    async fn check_stored_approval(&self, request: &PermissionRequest) -> Option<PermissionResult> {
        #[derive(sqlx::FromRow)]
        struct ApprovalRow {
            plan_approval_result: Option<String>,
        }
        let row = sqlx::query_as::<_, ApprovalRow>(
            "SELECT plan_approval_result FROM agent_sessions WHERE id = ?",
        )
        .bind(self.db_session_id)
        .fetch_optional(&self.write_pool)
        .await
        .ok()??;

        let result_str = row.plan_approval_result.as_ref()?;
        let result = serde_json::from_str::<serde_json::Value>(result_str).ok()?;

        // Clear stored result
        if let Err(e) = sqlx::query(
            "UPDATE agent_sessions SET plan_approval_result = NULL, pending_plan_approval = NULL WHERE id = ?"
        )
        .bind(self.db_session_id)
        .execute(&self.write_pool)
        .await
        {
            warn!(session_id = self.db_session_id, error = %e, "failed to clear plan_approval_result and pending_plan_approval");
        }

        let approved = result
            .get("approved")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if approved {
            info!("ExitPlanMode: using stored approval result (approved)");
            Some(PermissionResult::Allow {
                updated_input: request.input.clone(),
                updated_permissions: None,
                tool_use_id: Some(request.tool_use_id.clone()),
            })
        } else {
            let feedback = result
                .get("feedback")
                .and_then(|v| v.as_str())
                .unwrap_or("User requested changes to the plan.")
                .to_string();
            info!("ExitPlanMode: using stored approval result (denied)");
            Some(PermissionResult::Deny {
                message: feedback,
                interrupt: Some(false),
                tool_use_id: Some(request.tool_use_id.clone()),
            })
        }
    }

    /// Apply the user's decision for ExitPlanMode approval.
    async fn apply_exit_plan_decision(
        &self,
        request: &PermissionRequest,
        response: PermissionResponse,
    ) -> PermissionResult {
        match response.decision {
            PermissionDecision::AllowOnce | PermissionDecision::AllowFuture => {
                let p = WsSessionPersistence::with_session_id(
                    self.write_pool.clone(),
                    self.feature_id,
                    Some(self.db_session_id),
                );
                p.persist_user_message("Plan approved.").await;
                let _ = sqlx::query(
                    "UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE id = ?",
                )
                .bind(self.db_session_id)
                .execute(&self.write_pool)
                .await;
                PermissionResult::Allow {
                    updated_input: request.input.clone(),
                    updated_permissions: None,
                    tool_use_id: Some(request.tool_use_id.clone()),
                }
            }
            PermissionDecision::Deny => {
                let feedback = response
                    .feedback
                    .unwrap_or_else(|| "User requested changes to the plan.".to_string());
                let p = WsSessionPersistence::with_session_id(
                    self.write_pool.clone(),
                    self.feature_id,
                    Some(self.db_session_id),
                );
                p.persist_user_message(&feedback).await;
                PermissionResult::Deny {
                    message: feedback,
                    interrupt: Some(false),
                    tool_use_id: Some(request.tool_use_id.clone()),
                }
            }
        }
    }

    /// Attach plan file content to the ExitPlanMode tool_call row in agent_messages.
    /// Finds the most recent Write to a `.claude/plans/` path in this session,
    /// reads the file, and returns the enriched tool input (with `plan` field).
    async fn attach_plan_to_exit_block(&self, request: &PermissionRequest) -> serde_json::Value {
        // Find the plan file path from the most recent Write tool_call
        let plan_path: Option<String> = sqlx::query_scalar(
            "SELECT content FROM agent_messages \
             WHERE session_id = ? AND message_type = 'tool_call' AND tool_name = 'Write' \
             AND content LIKE '%plans/%' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(self.db_session_id)
        .fetch_optional(&self.write_pool)
        .await
        .ok()
        .flatten();

        let plan_content = match plan_path {
            Some(content_json) => {
                let parsed: Option<String> =
                    serde_json::from_str::<serde_json::Value>(&content_json)
                        .ok()
                        .and_then(|v| v.get("file_path")?.as_str().map(String::from));
                match parsed {
                    Some(file_path) => tokio::fs::read_to_string(&file_path).await.ok(),
                    None => None,
                }
            }
            None => None,
        };

        let mut enriched = request.input.clone();
        if let Some(plan_md) = plan_content {
            enriched["plan"] = serde_json::Value::String(plan_md);
            let updated_content = serde_json::to_string(&enriched).unwrap_or_default();
            crate::domain::features::repository::retry_update_agent_message_content(
                &self.write_pool,
                self.db_session_id,
                &request.tool_use_id,
                &updated_content,
                &crate::domain::features::repository::ToolCallFilter::ToolName(
                    "ExitPlanMode".to_string(),
                ),
            )
            .await;
        }
        enriched
    }

    fn send_plan_permission_request(
        &self,
        request: &PermissionRequest,
        tool_input: serde_json::Value,
    ) {
        let payload = PermissionRequestPayload {
            request_id: request.tool_use_id.clone(),
            tool_name: request.tool_name.clone(),
            tool_input,
            description: Some("Plan is ready for approval".to_string()),
            pattern: None,
        };
        let envelope = WsEnvelope::new(
            "session",
            "permission.request",
            serde_json::to_value(payload).unwrap(),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));
    }

    /// Handle a NeedsPrompt result: send session-specific envelope and
    /// wait for user decision via the shared bridge.
    async fn handle_needs_prompt(
        &self,
        request: &PermissionRequest,
        description: String,
        pattern: String,
        force_prompt: bool,
    ) -> PermissionResult {
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
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));

        permission_bridge::wait_and_apply_decision(
            &self.response_rx,
            &request.tool_use_id,
            request.input.clone(),
            &pattern,
            force_prompt,
            &self.worktree_path,
            &self.session_cache,
            &self.turn_state_tx,
            self.feature_id,
        )
        .await
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "session_id must be a numeric DB id",
            );
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
    let needs_respawn =
        matches!(&handle.state, QueryState::Active { .. }) && (model_changed || mode_changed);

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
            let sid = query.lock().await.session_id().await;
            if let Some(ref cli_sid) = sid {
                WsSessionPersistence::persist_claude_session_id_static(
                    &app_state.write_pool,
                    db_session_id,
                    cli_sid,
                )
                .await;
            }
            query.lock().await.close().await;
            sid
        } else {
            None
        };

        // Build fresh options with new model/mode + resume
        let options = RuntimeSpawnConfig {
            cwd: handle.config.cwd.clone(),
            permission_mode: handle.desired_permission_mode.clone(),
            model: handle.desired_model.clone(),
            system_prompt: handle.config.system_prompt.clone(),
            resume_session_id: claude_session_id,
            ..RuntimeSpawnConfig::default()
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
            let mut config = handle.config.clone();
            let session_cache = handle.session_cache.clone();
            let allowed_patterns = handle.allowed_patterns.clone();
            let feature_id = handle.feature_id;
            let mut options = match std::mem::replace(
                &mut handle.state,
                QueryState::Pending(RuntimeSpawnConfig::default()),
            ) {
                QueryState::Pending(opts) => opts,
                _ => unreachable!(),
            };

            // Use the claude_session_id captured at init time for --resume
            if options.resume_session_id.is_none() {
                if let Some(cli_sid) = handle.resume_session_id.take() {
                    info!(db_session_id, claude_session_id = %cli_sid, "resuming previous CLI session");
                    options.resume_session_id = Some(cli_sid);
                } else {
                    debug!(
                        db_session_id,
                        feature_id, "no claude_session_id found, spawning fresh"
                    );
                }
            }

            let initial_canonical_cwd = handle.config.canonical_cwd.clone();

            // Drop lock before spawning (async).
            drop(sessions);

            // Persist user message (session row already exists from handle_init)
            let write_pool = app_state.write_pool.clone();
            let persist_content = build_persist_content(&payload.text, &payload.images);
            {
                let p = WsSessionPersistence::with_session_id(
                    write_pool.clone(),
                    feature_id,
                    Some(db_session_id),
                );
                p.persist_user_message(&persist_content).await;
            }

            // Worktree creation (blocking) — must complete before CLI spawn
            let mut worktree_path = initial_canonical_cwd;
            let mut allowed_patterns = allowed_patterns;
            let use_worktree = payload.use_worktree.unwrap_or(false);
            if use_worktree {
                // 1. Synchronous auto-name (need title for branch name)
                if super::super::auto_name::has_default_title(&write_pool, feature_id).await {
                    let result = super::super::auto_name::auto_name_feature(
                        write_pool.clone(),
                        feature_id,
                        payload.text.clone(),
                        config.cwd.to_string_lossy().to_string(),
                        None,
                        sender.clone(),
                    )
                    .await;
                    info!(feature_id, name = ?result, "auto-named feature for worktree");
                }

                // 2. Create worktree
                let wf_sender = WorkflowWsSender::new(sender.clone());
                match worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await {
                    Ok(project_id) => {
                        match worktree::ensure_worktree(
                            &app_state.read_pool,
                            &write_pool,
                            feature_id,
                            project_id,
                            &wf_sender,
                        )
                        .await
                        {
                            Ok(wt_path) => {
                                info!(feature_id, path = %wt_path.display(), "worktree created for session");
                                // 3. Fire-and-forget setup commands
                                let setup_step = worktree::get_setting(
                                    &app_state.read_pool,
                                    feature_id,
                                    "worktree_setup_step",
                                )
                                .await;
                                if setup_step.as_deref() != Some("ready") {
                                    let rp = app_state.read_pool.clone();
                                    let wp = write_pool.clone();
                                    let ws2 = WorkflowWsSender::new(sender.clone());
                                    let p = wt_path.clone();
                                    tokio::spawn(async move {
                                        worktree::run_setup_commands(rp, wp, feature_id, p, ws2)
                                            .await;
                                    });
                                }
                                // 4. Override cwd to worktree path
                                options.cwd = wt_path.clone();
                                let canonical = permissions::canonicalize_worktree(&wt_path);
                                worktree_path = canonical.clone();
                                config.cwd = wt_path;
                                config.canonical_cwd = canonical;
                                allowed_patterns =
                                    Arc::new(permissions::load_allowed_patterns(&config.cwd));
                            }
                            Err(e) => {
                                error!(feature_id, error = %e, "worktree creation failed, proceeding with original cwd");
                            }
                        }
                    }
                    Err(e) => {
                        error!(feature_id, error = %e, "could not look up project_id for worktree, proceeding with original cwd");
                    }
                }
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
            let provider_id = sqlx::query_scalar::<_, String>(
                "SELECT runtime_provider FROM agent_sessions WHERE id = ? AND runtime_provider IS NOT NULL",
            )
            .bind(db_session_id)
            .fetch_optional(&app_state.read_pool)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| crate::domain::agents::runtime::DEFAULT_PROVIDER.to_string());
            let adapter = match runtime_adapter(&provider_id) {
                Some(adapter) => adapter,
                None => {
                    send_error(
                        sender,
                        &envelope.id,
                        "UNSUPPORTED_PROVIDER",
                        &format!("No runtime adapter registered for provider '{provider_id}'"),
                    );
                    return;
                }
            };

            info!(db_session_id, prompt = %payload.text, model = ?options.model, provider = %provider_id, "spawning runtime query");
            match adapter.spawn(content_value, options).await {
                Ok(mut runtime_session) => {
                    info!(
                        db_session_id,
                        "runtime query spawned successfully, starting stream reader"
                    );
                    WsSessionPersistence::mark_running_static(&app_state.write_pool, db_session_id)
                        .await;
                    WsSessionPersistence::broadcast_turn_state(
                        &app_state.turn_state_tx,
                        feature_id,
                        "claude",
                    );
                    let message_rx = runtime_session.take_message_rx();
                    let query_arc = Arc::new(Mutex::new(runtime_session));

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

                    // Fire-and-forget auto-naming for first prompt (skip if worktree already named synchronously)
                    if !use_worktree {
                        let write_pool = app_state.write_pool.clone();
                        let cwd = config.cwd.to_string_lossy().to_string();
                        let prompt_text = payload.text.clone();
                        let naming_sender = sender.clone();
                        tokio::spawn(async move {
                            if super::super::auto_name::has_default_title(&write_pool, feature_id)
                                .await
                            {
                                let result = super::super::auto_name::auto_name_feature(
                                    write_pool,
                                    feature_id,
                                    prompt_text,
                                    cwd,
                                    None,
                                    naming_sender,
                                )
                                .await;
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
                    error!(db_session_id, error = %e, "runtime query spawn failed");
                    send_error(sender, &envelope.id, "SDK_SPAWN_ERROR", &e.to_string());
                }
            }
        }
        QueryState::Active { query, .. } => {
            // Persist follow-up user message
            let persist_content = build_persist_content(&payload.text, &payload.images);
            let p = WsSessionPersistence::with_session_id(
                app_state.write_pool.clone(),
                handle.feature_id,
                Some(db_session_id),
            );
            p.persist_user_message(&persist_content).await;

            let q = query.lock().await;
            info!(db_session_id, "follow-up prompt");
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
    mut message_rx: RuntimeMessageRx,
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
            write_pool.clone(),
            feature_id,
            Some(db_session_id),
        );
        // Capture the runtime session ID from the first event that has one.
        let mut needs_session_id_capture = true;
        let mut context_window: u64 = initial_context_window;

        loop {
            let msg = message_rx.recv().await;

            match msg {
                Some(Ok(runtime_event)) => {
                    if needs_session_id_capture {
                        if let Some(cli_sid) = runtime_event.session_id() {
                            if !cli_sid.is_empty() {
                                needs_session_id_capture = false;
                                info!(db_session_id, claude_session_id = %cli_sid, "stream_reader: persisting CLI session_id to DB");
                                WsSessionPersistence::persist_claude_session_id_static(
                                    &write_pool,
                                    db_session_id,
                                    cli_sid,
                                )
                                .await;
                                // Notify frontend of the Claude Code session ID
                                send_claude_session_id(&sender, cli_sid);
                            }
                        }
                    }

                    // Capture context window from init model
                    if let Some(init) = runtime_event.init() {
                        if let Some(model) = init.model.as_deref() {
                            context_window = crate::domain::usage::context_window_for_model(model);
                        }
                        WsSessionPersistence::update_context_window(
                            &write_pool,
                            db_session_id,
                            context_window,
                        )
                        .await;
                    }

                    // Persist before forwarding (best-effort)
                    persistence.persist_runtime_event(&runtime_event).await;

                    // Extract and broadcast token usage (mirrors legacy SdkQueryRunner behavior)
                    if let Some(usage) = runtime_event.usage() {
                        // Persist to DB (best-effort)
                        WsSessionPersistence::update_token_usage(
                            &write_pool,
                            db_session_id,
                            usage.input_tokens,
                            usage.output_tokens,
                        )
                        .await;

                        // Broadcast to frontend
                        let usage_env = WsEnvelope::new(
                            "session",
                            "usage_update",
                            serde_json::to_value(SessionUsageUpdatePayload {
                                input_tokens: usage.input_tokens,
                                output_tokens: usage.output_tokens,
                                context_window,
                            })
                            .unwrap(),
                        );
                        let _ = sender.send(Message::Text(String::from(usage_env).into()));
                    }

                    let envelope = if runtime_event.is_result() {
                        // Mark session completed
                        WsSessionPersistence::mark_completed_static(&write_pool, db_session_id)
                            .await;
                        WsSessionPersistence::broadcast_turn_state(
                            &turn_state_tx,
                            feature_id,
                            "none",
                        );
                        WsEnvelope::new(
                            "session",
                            "ended",
                            serde_json::to_value(SessionEndedPayload {
                                reason: "turn_complete".into(),
                            })
                            .unwrap(),
                        )
                    } else {
                        // Forward as session.message with raw JSON
                        let block = runtime_event.raw_json().clone();
                        WsEnvelope::new(
                            "session",
                            "message",
                            serde_json::to_value(SessionMessagePayload {
                                blocks: vec![block],
                            })
                            .unwrap(),
                        )
                    };

                    if sender
                        .send(Message::Text(String::from(envelope).into()))
                        .is_err()
                    {
                        debug!(
                            db_session_id,
                            "WebSocket sender closed, stopping stream reader"
                        );
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

                let options = RuntimeSpawnConfig {
                    cwd: handle.config.cwd.clone(),
                    permission_mode: handle.desired_permission_mode.clone(),
                    model: handle.desired_model.clone(),
                    system_prompt: handle.config.system_prompt.clone(),
                    resume_session_id: claude_session_id,
                    ..RuntimeSpawnConfig::default()
                };

                info!(
                    db_session_id,
                    "stream ended, transitioning Active → Pending for resume"
                );
                handle.state = QueryState::Pending(options);
            }
        }
    });
}
