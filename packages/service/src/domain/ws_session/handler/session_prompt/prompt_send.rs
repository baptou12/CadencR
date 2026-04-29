use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error, info, warn};

use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::agents::runtime_adapter;
use crate::domain::workflow::engine::WsSender as WorkflowWsSender;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::permissions;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{PromptSendPayload, WsEnvelope};

use super::super::{parse_session_id, send_error, QueryState, SdkHandle, SdkSessions, WsSender};
use super::bridge::{
    build_content_value, build_persist_content, PermissionResponse, WsBridgeCanUseTool,
};
use super::errors::persist_pause_and_send_session_error;
use super::stream_reader::spawn_stream_reader;

/// Handle session.prompt.send: send prompt to runtime or spawn new query.
pub(crate) async fn handle_prompt_send(
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

    // Check if we need to respawn due to model, permission mode, or effort change.
    let model_changed = handle.desired_model != handle.spawned_model;
    let mode_changed = handle.desired_permission_mode != handle.spawned_permission_mode;
    let effort_changed = handle.desired_thinking_effort != handle.spawned_thinking_effort;
    let needs_respawn = matches!(&handle.state, QueryState::Active { .. })
        && (model_changed || mode_changed || effort_changed);

    if needs_respawn {
        info!(
            db_session_id,
            old_model = ?handle.spawned_model,
            new_model = ?handle.desired_model,
            old_mode = ?handle.spawned_permission_mode,
            new_mode = ?handle.desired_permission_mode,
            old_effort = ?handle.spawned_thinking_effort,
            new_effort = ?handle.desired_thinking_effort,
            "runtime config changed, respawning runtime with --resume"
        );

        // Get runtime session ID, persist it, and close the old query.
        let runtime_session_id = if let QueryState::Active { query, .. } = &handle.state {
            let sid = query.lock().await.session_id().await;
            if let Some(ref cli_sid) = sid {
                WsSessionPersistence::persist_runtime_session_id_static(
                    &app_state.write_pool,
                    db_session_id,
                    &handle.runtime_provider,
                    cli_sid,
                )
                .await;
            }
            query.lock().await.close().await;
            sid
        } else {
            None
        };

        // Build fresh options with new model/mode + resume.
        let options = RuntimeSpawnConfig {
            cwd: handle.config.cwd.clone(),
            permission_mode: handle.desired_permission_mode.clone(),
            model: handle.desired_model.clone(),
            thinking_effort: handle.desired_thinking_effort.clone(),
            system_prompt: handle.config.system_prompt.clone(),
            resume_session_id: runtime_session_id,
            env: handle.config.env.clone(),
            ..RuntimeSpawnConfig::default()
        };

        // Reset to pending so the spawn logic below handles it.
        handle.spawned_model = handle.desired_model.clone();
        handle.spawned_permission_mode = handle.desired_permission_mode.clone();
        handle.spawned_thinking_effort = handle.desired_thinking_effort.clone();
        handle.config.permission_mode = handle.desired_permission_mode.clone();
        handle.config.thinking_effort = handle.desired_thinking_effort.clone();
        handle.state = QueryState::Pending(options);
    }

    match &handle.state {
        QueryState::Pending(_) => {
            // First prompt (or respawn after model change) — take stored options and spawn.
            let spawned_model = handle.desired_model.clone();
            let spawned_thinking_effort = handle.desired_thinking_effort.clone();
            let mut config = handle.config.clone();
            let session_cache = handle.session_cache.clone();
            let mut allowed_patterns = handle.allowed_patterns.clone();
            let feature_id = handle.feature_id;
            let provider_id = handle.runtime_provider.clone();
            let mut options = match std::mem::replace(
                &mut handle.state,
                QueryState::Pending(RuntimeSpawnConfig::default()),
            ) {
                QueryState::Pending(opts) => opts,
                _ => unreachable!(),
            };

            // Use the runtime session ID captured at init time for --resume.
            if options.resume_session_id.is_none() {
                if let Some(runtime_sid) = handle.resume_session_id.take() {
                    info!(db_session_id, runtime_session_id = %runtime_sid, "resuming previous runtime session");
                    options.resume_session_id = Some(runtime_sid);
                } else {
                    debug!(
                        db_session_id,
                        feature_id, "no runtime_session_id found, spawning fresh"
                    );
                }
            }

            let initial_canonical_cwd = handle.config.canonical_cwd.clone();

            // Drop lock before spawn (async).
            drop(sessions);

            // Persist user message (session row already exists from handle_init).
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

            // Worktree creation (blocking) — must complete before runtime spawn.
            let mut worktree_path = initial_canonical_cwd;
            let use_worktree = payload.use_worktree.unwrap_or(false);
            if use_worktree {
                // 1. Synchronous auto-name (need title for branch name)
                if super::super::super::auto_name::has_default_title(&write_pool, feature_id).await
                {
                    let result = super::super::super::auto_name::auto_name_feature(
                        write_pool.clone(),
                        feature_id,
                        payload.text.clone(),
                        config.cwd.to_string_lossy().to_string(),
                        sender.clone(),
                    )
                    .await;
                    info!(feature_id, name = ?result, "auto-named feature for worktree");
                }

                // 2. Create worktree.
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
                                // 3. Fire-and-forget setup commands.
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
                                // 4. Override cwd to worktree path.
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

            // Set up permission bridge.
            let (permission_tx, permission_rx) = mpsc::channel::<PermissionResponse>(16);
            let content_value = build_content_value(&payload.text, &payload.images);
            let adapter = match runtime_adapter(&provider_id) {
                Some(adapter) => adapter,
                None => {
                    let message =
                        format!("No runtime adapter registered for provider '{provider_id}'");
                    persist_pause_and_send_session_error(
                        &write_pool,
                        &app_state.turn_state_tx,
                        sender,
                        &envelope.id,
                        feature_id,
                        db_session_id,
                        "UNSUPPORTED_PROVIDER",
                        &message,
                    )
                    .await;
                    return;
                }
            };

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
            options.permission_handler = Some(Arc::new(bridge));
            if let Some(ref sid) = options.resume_session_id {
                if !adapter.is_valid_resume_session_id(sid) {
                    warn!(
                        db_session_id,
                        resume_session_id = %sid,
                        provider = %provider_id,
                        "dropping invalid resume_session_id before spawn"
                    );
                    options.resume_session_id = None;
                }
            }

            info!(
                db_session_id,
                prompt = %payload.text,
                model = ?options.model,
                provider = %provider_id,
                "spawning runtime query"
            );
            match adapter.spawn(content_value, options).await {
                Ok(mut runtime_session) => {
                    info!(
                        db_session_id,
                        "runtime query spawned successfully, starting stream reader"
                    );
                    WsSessionPersistence::mark_running_static(&app_state.write_pool, db_session_id)
                        .await;
                    let provider_context_window = runtime_session.context_window();
                    let runtime_control_endpoint = runtime_session.runtime_control_endpoint();
                    if let Some(cw) = provider_context_window {
                        WsSessionPersistence::update_context_window(
                            &app_state.write_pool,
                            db_session_id,
                            Some(cw),
                        )
                        .await;
                    }
                    WsSessionPersistence::broadcast_turn_state(
                        &app_state.turn_state_tx,
                        feature_id,
                        "agent",
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
                        provider_id.clone(),
                        spawned_model.as_deref(),
                        provider_context_window,
                    );

                    // Fire-and-forget auto-naming for first prompt.
                    if !use_worktree {
                        let write_pool = app_state.write_pool.clone();
                        let cwd = config.cwd.to_string_lossy().to_string();
                        let prompt_text = payload.text.clone();
                        let naming_sender = sender.clone();
                        tokio::spawn(async move {
                            if super::super::super::auto_name::has_default_title(
                                &write_pool,
                                feature_id,
                            )
                            .await
                            {
                                let result = super::super::super::auto_name::auto_name_feature(
                                    write_pool,
                                    feature_id,
                                    prompt_text,
                                    cwd,
                                    naming_sender,
                                )
                                .await;
                                info!(feature_id, name = ?result, "auto-named feature");
                            }
                        });
                    }

                    let spawned_pm = config.permission_mode.clone();
                    let spawned_effort = spawned_thinking_effort.clone();
                    let mut sessions = sdk_sessions.lock().await;
                    sessions.insert(
                        db_session_id,
                        SdkHandle {
                            state: QueryState::Active {
                                query: query_arc,
                                permission_tx,
                            },
                            feature_id,
                            runtime_provider: provider_id,
                            desired_model: spawned_model.clone(),
                            spawned_model,
                            desired_permission_mode: spawned_pm.clone(),
                            spawned_permission_mode: spawned_pm,
                            desired_thinking_effort: spawned_effort.clone(),
                            spawned_thinking_effort: spawned_effort,
                            runtime_control_endpoint,
                            resume_session_id: None,
                            config,
                            session_cache,
                            allowed_patterns,
                            manual_compact_cancel: Arc::new(std::sync::atomic::AtomicBool::new(
                                false,
                            )),
                        },
                    );
                }
                Err(e) => {
                    let message = e.to_string();
                    error!(db_session_id, error = %message, "runtime query spawn failed");
                    persist_pause_and_send_session_error(
                        &write_pool,
                        &app_state.turn_state_tx,
                        sender,
                        &envelope.id,
                        feature_id,
                        db_session_id,
                        "SDK_SPAWN_ERROR",
                        &message,
                    )
                    .await;
                }
            }
        }
        QueryState::Active { query, .. } => {
            // Persist follow-up user message.
            let persist_content = build_persist_content(&payload.text, &payload.images);
            let p = WsSessionPersistence::with_session_id(
                app_state.write_pool.clone(),
                handle.feature_id,
                Some(db_session_id),
            );
            p.persist_user_message(&persist_content).await;

            // Follow-up turns re-enter the "agent working" state. The stream
            // reader is already running (same runtime as turn 1), so it's
            // this path — not spawn_stream_reader — that must push the agent
            // back to "running" both in DB (so snapshots reflect it) and on
            // the turn-state broadcast (so the sidebar and every other
            // `featureTurnStates` consumer light up). Without these two
            // writes, turn 1's `mark_completed_static` + `"none"` tombstone
            // from `stream_reader.rs:191-197` stay sticky across the second
            // prompt and the UI never shows the agent is alive again.
            WsSessionPersistence::mark_running_static(&app_state.write_pool, db_session_id).await;
            WsSessionPersistence::broadcast_turn_state(
                &app_state.turn_state_tx,
                handle.feature_id,
                "agent",
            );

            let q = query.lock().await;
            info!(db_session_id, "follow-up prompt");
            let content = build_content_value(&payload.text, &payload.images);
            let stream_result = q.stream_input(content).await;
            drop(q);
            if let Err(e) = stream_result {
                let message = e.to_string();
                error!(db_session_id, error = %message, "stream_input failed");
                persist_pause_and_send_session_error(
                    &app_state.write_pool,
                    &app_state.turn_state_tx,
                    sender,
                    &envelope.id,
                    handle.feature_id,
                    db_session_id,
                    "SDK_ERROR",
                    &message,
                )
                .await;
            }
        }
    }
}
