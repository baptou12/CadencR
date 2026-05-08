use std::path::PathBuf;
use std::sync::atomic::Ordering;

use axum::extract::ws::Message;
use tracing::{error, info};

use super::super::persistence::{PendingUserInputKind, WsSessionPersistence};
use super::super::protocol::*;
use super::post_plan_mode::{
    should_transition_after_plan_approval, transition_session_to_post_plan_mode,
};
use super::session_prompt::PermissionResponse;
use super::{
    default_permission_mode_wire, parse_permission_mode, parse_session_id, persist_and_close_query,
    provider_supports_mode, send_error, QueryState, SdkSessions, WsSender,
};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{
    RuntimePermissionDecision, RuntimePermissionResponse, RuntimePermissionResponseKind,
    RuntimeSessionHandle, RuntimeSpawnConfig,
};
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::agents::{adapter_for_model, runtime_adapter};
use crate::domain::workflow::engine::WsSender as WorkflowWsSender;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::question_answers::format_answers_plain_text;

async fn session_has_messages(
    pool: &sqlx::SqlitePool,
    session_id: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM agent_messages WHERE session_id = ?)")
        .bind(session_id)
        .fetch_one(pool)
        .await
        .map(|exists| exists != 0)
}

fn provider_for_model(current_provider: &str, model: &str) -> String {
    adapter_for_model(model)
        .map(|(provider_id, _)| provider_id)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            if current_provider != DEFAULT_PROVIDER && !model.contains('/') {
                return DEFAULT_PROVIDER.to_string();
            }

            current_provider.to_string()
        })
}

async fn persist_question_answer(
    pool: sqlx::SqlitePool,
    feature_id: i64,
    db_session_id: i64,
    updated_input: Option<&serde_json::Value>,
) {
    let Some(answer_text) = updated_input.and_then(format_answers_plain_text) else {
        return;
    };
    let p = WsSessionPersistence::with_session_id(pool, feature_id, Some(db_session_id));
    p.persist_user_message(&answer_text).await;
}

/// Handle session.permission.respond
pub(super) async fn handle_permission_respond(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    // Extract everything we need from the handle, then drop the sdk_sessions
    // lock before ANY `.await` that touches the DB or runtime. The lock is
    // global; holding it across `q.respond_permission()` or
    // `permission_tx.send()` blocks every other handler from making progress.
    struct ExtractedHandle {
        feature_id: i64,
        runtime_provider: String,
        active: Option<ActiveParts>,
    }
    struct ActiveParts {
        query: crate::domain::agents::adapter::RuntimeSessionHandle,
        permission_tx: tokio::sync::mpsc::Sender<PermissionResponse>,
    }

    let extracted: ExtractedHandle = {
        let sessions = sdk_sessions.lock().await;
        let handle = match sessions.get(&db_session_id) {
            Some(h) => h,
            None => {
                send_error(
                    sender,
                    &envelope.id,
                    "SESSION_NOT_FOUND",
                    "Session not found",
                );
                return;
            }
        };
        let active = match &handle.state {
            QueryState::Active {
                query,
                permission_tx,
            } => Some(ActiveParts {
                query: std::sync::Arc::clone(query),
                permission_tx: permission_tx.clone(),
            }),
            QueryState::Pending(_) => None,
        };
        ExtractedHandle {
            feature_id: handle.feature_id,
            runtime_provider: handle.runtime_provider.clone(),
            active,
        }
    };
    // sdk_sessions lock dropped here.

    if extracted.active.is_none() {
        // Handle restored plan approval: CLI is not running, store result in DB
        // so the next CLI spawn can pick it up.
        if payload.request_id.starts_with("plan_restore_") {
            let approved = matches!(
                payload.decision,
                PermissionDecision::AllowOnce | PermissionDecision::AllowFuture
            );
            let result_json = serde_json::json!({
                "approved": approved,
                "feedback": payload.feedback,
            });
            // plan_approval_result is a sibling column (not a pending_* gate),
            // so it stays inline. The PlanApproval gate goes through the helper.
            let _ = sqlx::query("UPDATE agent_sessions SET plan_approval_result = ? WHERE id = ?")
                .bind(result_json.to_string())
                .bind(db_session_id)
                .execute(&app_state.write_pool)
                .await;
            // Pair clear + broadcast so the sidebar doesn't stay stuck on
            // Question after restore → Approve/Reject (normal paths use the
            // same helper via `mark_agent_resumed_static`). Plan-approval
            // gate: Deny-with-feedback hands the turn back to the agent;
            // bare Deny ends the turn.
            let next_status = crate::domain::permission_bridge::status_after_approval(
                payload.decision,
                payload.feedback.as_deref(),
            );
            WsSessionPersistence::mark_agent_resumed_static(
                &app_state.write_pool,
                &app_state.session_status_tx,
                db_session_id,
                extracted.feature_id,
                PendingUserInputKind::PlanApproval,
                next_status,
            )
            .await;
            info!(
                db_session_id,
                approved, "stored restored plan approval result in DB"
            );
            return;
        }
        send_error(
            sender,
            &envelope.id,
            "INVALID_STATE",
            "Session not yet active",
        );
        return;
    }
    let ActiveParts {
        query,
        permission_tx,
    } = extracted.active.expect("active presence checked above");

    let answer_to_persist = payload.updated_input.clone();

    let runtime_response = RuntimePermissionResponse {
        request_id: payload.request_id.clone(),
        decision: match payload.decision {
            PermissionDecision::AllowOnce => RuntimePermissionDecision::AllowOnce,
            PermissionDecision::AllowFuture => RuntimePermissionDecision::AllowFuture,
            PermissionDecision::Deny => RuntimePermissionDecision::Deny,
        },
        option_id: payload.option_id.clone(),
        feedback: payload.feedback.clone(),
        updated_input: payload.updated_input.clone(),
    };
    let permission_kind = {
        let q = query.lock().await;
        q.permission_response_kind(&payload.request_id)
    };
    if should_transition_after_plan_approval(permission_kind, runtime_response.decision) {
        if let Err(error) = transition_session_to_post_plan_mode(
            sdk_sessions,
            db_session_id,
            &app_state.write_pool,
            sender,
        )
        .await
        {
            send_error(
                sender,
                &envelope.id,
                "SDK_ERROR",
                &format!("Failed to apply post-plan permission mode: {error}"),
            );
            return;
        }
    }
    let respond_result = {
        let q = query.lock().await;
        q.respond_permission(runtime_response).await
    };
    let is_plan_approval = permission_kind == RuntimePermissionResponseKind::PlanApproval;
    match respond_result {
        Ok(()) => {
            let turn_feedback = if is_plan_approval {
                Some(payload.feedback.as_deref().unwrap_or("Plan feedback"))
            } else {
                payload.feedback.as_deref()
            };
            let next_status = crate::domain::permission_bridge::status_after_runtime_permission(
                permission_kind,
                payload.decision.clone(),
                turn_feedback,
            );
            if crate::domain::permission_bridge::runtime_permission_denial_completes_session(
                permission_kind,
                payload.decision.clone(),
                turn_feedback,
            ) {
                WsSessionPersistence::mark_completed_static(&app_state.write_pool, db_session_id)
                    .await;
                let ended = WsEnvelope::new(
                    "session",
                    "ended",
                    serde_json::to_value(SessionEndedPayload {
                        reason: "permission_denied".into(),
                    })
                    .unwrap(),
                );
                let _ = sender.send(Message::Text(String::from(ended).into()));
            }
            // Providers that resolve the permission in-SDK (OpenCode) never
            // persisted a pending_* row through the `handle_needs_prompt`
            // path — their askUser lives purely in the broadcast channel.
            // Clear all four columns defensively: if anything DID get
            // written (e.g. stream_reader.rs persisting OpenCode permissions
            // for reconnect-safety), this closes the gate atomically.
            WsSessionPersistence::clear_all_pending_user_input_static(
                &app_state.write_pool,
                db_session_id,
            )
            .await;
            persist_question_answer(
                app_state.write_pool.clone(),
                extracted.feature_id,
                db_session_id,
                answer_to_persist.as_ref(),
            )
            .await;
            WsSessionPersistence::broadcast_session_status(
                &app_state.session_status_tx,
                db_session_id,
                extracted.feature_id,
                next_status,
                None,
            );
            return;
        }
        Err(error) if extracted.runtime_provider != DEFAULT_PROVIDER => {
            send_error(
                sender,
                &envelope.id,
                "RUNTIME_PERMISSION_ERROR",
                &error.to_string(),
            );
            return;
        }
        Err(_) => {
            // Claude Code path: `respond_permission` is a no-op at the SDK
            // level; the response is delivered to `bridge.rs`'s
            // `wait_and_apply_decision` via the permission_tx channel below.
            // That function OWNS the DB clear + terminal broadcast, so we
            // don't touch either here.
        }
    }

    let response = PermissionResponse {
        request_id: payload.request_id,
        decision: payload.decision,
        option_id: payload.option_id,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
        is_approval_gate: false,
    };

    if permission_tx.send(response).await.is_err() {
        send_error(
            sender,
            &envelope.id,
            "CHANNEL_ERROR",
            "Permission channel closed",
        );
    } else {
        persist_question_answer(
            app_state.write_pool.clone(),
            extracted.feature_id,
            db_session_id,
            answer_to_persist.as_ref(),
        )
        .await;
    }
}

/// Handle session.provider.set: change the provider before the first prompt only.
pub(super) async fn handle_provider_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ProviderSetPayload = match serde_json::from_value(envelope.payload.clone()) {
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
                "Invalid session_id",
            );
            return;
        }
    };

    if runtime_adapter(&payload.provider).is_none() {
        send_error(
            sender,
            &envelope.id,
            "UNSUPPORTED_PROVIDER",
            &format!(
                "Runtime provider '{}' is not implemented yet",
                payload.provider
            ),
        );
        return;
    }

    let has_messages = match session_has_messages(&app_state.read_pool, db_session_id).await {
        Ok(value) => value,
        Err(error) => {
            error!(db_session_id, %error, "failed to verify session history before provider change");
            send_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                "Failed to verify session history",
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
                "Session not found",
            );
            return;
        }
    };

    if has_messages {
        send_error(
            sender,
            &envelope.id,
            "PROVIDER_LOCKED",
            "Provider cannot be changed after the conversation starts",
        );
        return;
    }

    match &mut handle.state {
        QueryState::Pending(options) => {
            let provider_changed = handle.runtime_provider != payload.provider;
            if provider_changed {
                handle.runtime_provider = payload.provider.clone();
                // Resume IDs are provider-specific; drop any stale value when switching providers.
                handle.resume_session_id = None;
                options.resume_session_id = None;

                // Permission modes are also provider-specific (Claude's `auto`
                // doesn't exist on Codex, Codex's `default` doesn't exist on
                // Claude, etc.). Reset the desired/spawned/options modes so
                // the next spawn picks the new provider's adapter default
                // rather than carrying stale Claude-flavored state into a
                // Codex session.
                handle.desired_permission_mode = None;
                handle.config.permission_mode = None;
                options.permission_mode = None;

                let new_mode_wire = default_permission_mode_wire(&payload.provider);
                let _ = sqlx::query("UPDATE agent_sessions SET runtime_provider = ? WHERE id = ?")
                    .bind(&payload.provider)
                    .bind(db_session_id)
                    .execute(&app_state.write_pool)
                    .await;
                WsSessionPersistence::update_permission_mode_static(
                    &app_state.write_pool,
                    db_session_id,
                    new_mode_wire,
                )
                .await;

                let reply = WsEnvelope::reply(
                    &envelope.id,
                    "session",
                    "provider.set.ok",
                    serde_json::json!({ "provider": payload.provider }),
                );
                let _ = sender.send(Message::Text(String::from(reply).into()));

                // Broadcast the new chip state via the standard `mode.changed`
                // envelope so the FE updates through the same path as a
                // user-initiated mode change (no optimistic update).
                let mode_changed = WsEnvelope::reply(
                    &envelope.id,
                    "session",
                    "mode.changed",
                    serde_json::json!({ "mode": new_mode_wire }),
                );
                let _ = sender.send(Message::Text(String::from(mode_changed).into()));
            } else {
                // Same-provider re-set: idempotent ack, no DB writes / mode reset.
                let reply = WsEnvelope::reply(
                    &envelope.id,
                    "session",
                    "provider.set.ok",
                    serde_json::json!({ "provider": payload.provider }),
                );
                let _ = sender.send(Message::Text(String::from(reply).into()));
            }
        }
        QueryState::Active { .. } => {
            send_error(
                sender,
                &envelope.id,
                "PROVIDER_LOCKED",
                "Provider cannot be changed after the conversation starts",
            );
        }
    }
}

/// Handle session.model.set: change the model and persist to DB.
pub(super) async fn handle_model_set(
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let has_messages = match session_has_messages(&app_state.read_pool, db_session_id).await {
        Ok(value) => value,
        Err(error) => {
            error!(db_session_id, %error, "failed to verify session history before model change");
            send_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                "Failed to verify session history",
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
                "Session not found",
            );
            return;
        }
    };

    let target_provider = provider_for_model(&handle.runtime_provider, &payload.model);
    if has_messages && handle.runtime_provider != target_provider {
        send_error(
            sender,
            &envelope.id,
            "PROVIDER_LOCKED",
            "Start a new session to switch providers",
        );
        return;
    }

    info!(db_session_id, model = %payload.model, "updating desired model");
    handle.desired_model = Some(payload.model.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            options.model = Some(payload.model.clone());
            if handle.runtime_provider != target_provider {
                handle.runtime_provider = target_provider.clone();
                handle.resume_session_id = None;
                options.resume_session_id = None;
                let _ = sqlx::query("UPDATE agent_sessions SET runtime_provider = ? WHERE id = ?")
                    .bind(&target_provider)
                    .bind(db_session_id)
                    .execute(&app_state.write_pool)
                    .await;
            }
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
    WsSessionPersistence::update_model_static(&app_state.write_pool, db_session_id, &payload.model)
        .await;
    // Seed the new model's context window ONLY when the target adapter can
    // answer authoritatively right now (e.g. opencode knows its catalog
    // windows). Never fall back to history — for Claude Code, the CLI is the
    // source of truth and the window arrives on the first `result` event.
    // Token counts are NOT reset: the conversation history has not changed,
    // only the model has. The first `result` from the new model will stamp
    // fresh token totals.
    let target_adapter = adapter_for_model(&payload.model)
        .map(|(_, a)| a)
        .or_else(|| runtime_adapter(&handle.runtime_provider));
    let seeded_window = match target_adapter {
        Some(adapter) => adapter.context_window_for_model(&payload.model).await,
        None => None,
    };
    WsSessionPersistence::update_context_window(
        &app_state.write_pool,
        db_session_id,
        seeded_window,
    )
    .await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "model.set.ok",
        serde_json::to_value(serde_json::json!({
            "model": payload.model,
            "context_window": seeded_window,
        }))
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.mode.set: change the permission mode and persist to DB.
pub(super) async fn handle_mode_set(
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let new_mode = parse_permission_mode(&payload.mode);

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.get_mut(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    // Reject modes the active provider doesn't support — guards against a
    // stale FE catalog (e.g. user just switched provider but UI hadn't
    // re-rendered) and surfaces the failure to the user via the standard
    // error envelope rather than silently dropping the request.
    if !provider_supports_mode(&handle.runtime_provider, &new_mode) {
        send_error(
            sender,
            &envelope.id,
            "MODE_NOT_SUPPORTED",
            &format!(
                "Provider {} does not support permission mode {}",
                handle.runtime_provider, payload.mode
            ),
        );
        return;
    }

    info!(db_session_id, mode = %payload.mode, "updating permission mode");
    handle.desired_permission_mode = Some(new_mode.clone());
    handle.config.permission_mode = Some(new_mode.clone());

    match &mut handle.state {
        QueryState::Pending(options) => {
            // No live CLI yet; the queued mode will be passed via
            // `Options.permission_mode` at spawn time.
            options.permission_mode = Some(new_mode);
        }
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.set_permission_mode(new_mode.clone()).await {
                // The CLI rejected (or never acked) the mode change.
                // Per `no-optimistic-updates.md` we leave the FE chip
                // alone — surface the error so the caller can retry. We
                // deliberately don't roll back `desired_permission_mode`:
                // the user's intent stays recorded so a subsequent
                // success starts from there rather than CLI state.
                error!(db_session_id, error = %e, "failed to set permission mode on active query");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
                return;
            }
            // Track what the CLI actually accepted. Without this,
            // `plan_post_plan_mode_transition`'s "already in target mode"
            // short-circuit (post_plan_mode.rs) reads stale state and
            // may skip the post-plan-approval transition.
            handle.spawned_permission_mode = Some(new_mode);
        }
    }

    // Persist to DB
    WsSessionPersistence::update_permission_mode_static(
        &app_state.write_pool,
        db_session_id,
        &payload.mode,
    )
    .await;

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "mode.changed",
        serde_json::to_value(serde_json::json!({ "mode": payload.mode })).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.effort.set: change the thinking effort for subsequent turns.
pub(super) async fn handle_effort_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: EffortSetPayload = match serde_json::from_value(envelope.payload.clone()) {
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
                "Invalid session_id",
            );
            return;
        }
    };

    // Snapshot the (provider, model) at the moment of the change so the per-
    // model workspace default is keyed against the model that's actually in
    // use right now. If the user later switches models, that's a separate
    // event and should not back-propagate to the previous model's default.
    let (active_query, runtime_provider, current_model): (
        Option<RuntimeSessionHandle>,
        String,
        Option<String>,
    ) = {
        let mut sessions = sdk_sessions.lock().await;
        let handle = match sessions.get_mut(&db_session_id) {
            Some(h) => h,
            None => {
                send_error(
                    sender,
                    &envelope.id,
                    "SESSION_NOT_FOUND",
                    "Session not found",
                );
                return;
            }
        };

        info!(
            db_session_id,
            thinking_effort = ?payload.thinking_effort,
            "updating desired thinking effort"
        );
        handle.desired_thinking_effort = payload.thinking_effort.clone();
        handle.config.thinking_effort = payload.thinking_effort.clone();

        let provider = handle.runtime_provider.clone();
        let model = handle
            .desired_model
            .clone()
            .or_else(|| handle.spawned_model.clone());

        let active = match &mut handle.state {
            QueryState::Pending(options) => {
                options.thinking_effort = payload.thinking_effort.clone();
                None
            }
            QueryState::Active { query, .. } => Some(query.clone()),
        };
        (active, provider, model)
    };

    if let Some(query) = active_query {
        let q = query.lock().await;
        let applies_in_place = q.applies_thinking_effort_in_place();
        if let Err(error) = q.set_thinking_effort(payload.thinking_effort.clone()).await {
            error!(db_session_id, %error, "failed to set thinking effort on active query");
            send_error(sender, &envelope.id, "SDK_ERROR", &error.to_string());
            return;
        }

        if applies_in_place {
            let mut sessions = sdk_sessions.lock().await;
            if let Some(handle) = sessions.get_mut(&db_session_id) {
                handle.spawned_thinking_effort = payload.thinking_effort.clone();
            }
        }
    }

    // Persist the conversation-level override (column on agent_sessions). A
    // None payload clears the override; the next session.init will fall back
    // to the per-model workspace default.
    WsSessionPersistence::update_thinking_effort_static(
        &app_state.write_pool,
        db_session_id,
        payload.thinking_effort.as_deref(),
    )
    .await;

    // Update the per-model workspace default so newly opened conversations on
    // the same model start at the level the user just chose. Resets (None)
    // intentionally do not erase the default — clearing for one conversation
    // shouldn't surprise the next new one.
    if let (Some(ref effort), Some(ref model_id)) = (&payload.thinking_effort, &current_model) {
        let key = crate::domain::settings::thinking_effort_model_key(&runtime_provider, model_id);
        if let Err(error) =
            crate::domain::workspace::repository::set_setting(&app_state.write_pool, &key, effort)
                .await
        {
            error!(
                db_session_id,
                %error,
                key = %key,
                "failed to persist per-model thinking effort default"
            );
        }
    }

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "effort.set.ok",
        serde_json::to_value(serde_json::json!({
            "thinking_effort": payload.thinking_effort,
        }))
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.interrupt
pub(super) async fn handle_interrupt(
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let sessions = sdk_sessions.lock().await;
    let handle = match sessions.get(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    match &handle.state {
        QueryState::Active { query, .. } => {
            let q = query.lock().await;
            if let Err(e) = q.interrupt().await {
                error!(db_session_id, error = %e, "interrupt failed");
                send_error(sender, &envelope.id, "SDK_ERROR", &e.to_string());
            }
        }
        QueryState::Pending(_) => {
            handle.manual_compact_cancel.store(true, Ordering::SeqCst);
            send_error(sender, &envelope.id, "INVALID_STATE", "Session not active");
        }
    }
}

/// Handle session.destroy: mark session as completed and close subprocess.
pub(super) async fn handle_destroy(
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let mut sessions = sdk_sessions.lock().await;
    let handle = match sessions.remove(&db_session_id) {
        Some(h) => h,
        None => {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        }
    };

    let feature_id = handle.feature_id;
    let runtime_provider = handle.runtime_provider.clone();

    // Close active subprocess if running
    if let QueryState::Active { query, .. } = handle.state {
        persist_and_close_query(
            &query,
            &app_state.write_pool,
            db_session_id,
            &runtime_provider,
        )
        .await;
    }

    WsSessionPersistence::mark_completed_static(&app_state.write_pool, db_session_id).await;
    WsSessionPersistence::broadcast_session_status(
        &app_state.session_status_tx,
        db_session_id,
        feature_id,
        crate::domain::session_status::AgentStatus::Idle,
        None,
    );

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

/// Handle session.delete: hard-delete a session and its messages from the DB.
pub(super) async fn handle_delete(
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    // Remove from in-memory map if present (shouldn't be active, but clean up)
    sdk_sessions.lock().await.remove(&db_session_id);

    match WsSessionPersistence::delete_session_static(&app_state.write_pool, db_session_id).await {
        Ok((feature_id, agent_type)) => {
            WsSessionPersistence::broadcast_session_status(
                &app_state.session_status_tx,
                db_session_id,
                feature_id,
                crate::domain::session_status::AgentStatus::Idle,
                None,
            );

            // When deleting a plan or prd agent, reset workflow status to idle
            // so the UI doesn't show a ghost agent on next hydration.
            if matches!(agent_type.as_deref(), Some("plan") | Some("prd")) {
                use crate::domain::features::repository::{
                    force_workflow_status, get_workflow_status,
                };
                use crate::domain::workflow::status::WorkflowStatus;
                let previous: WorkflowStatus =
                    get_workflow_status(&app_state.write_pool, feature_id)
                        .await
                        .unwrap_or(WorkflowStatus::Idle);
                if let Err(e) =
                    force_workflow_status(&app_state.write_pool, feature_id, WorkflowStatus::Idle)
                        .await
                {
                    error!(feature_id, %e, "failed to reset workflow status after session delete");
                } else {
                    let status_msg = WsEnvelope::new(
                        "workflow",
                        "status_changed",
                        serde_json::to_value(WorkflowStatusChangedPayload {
                            feature_id,
                            status: "idle".to_string(),
                            previous_status: previous.to_string(),
                        })
                        .unwrap(),
                    );
                    let _ = sender.send(Message::Text(String::from(status_msg).into()));
                }
            }

            let reply = WsEnvelope::reply(
                &envelope.id,
                "session",
                "deleted",
                serde_json::json!({ "session_id": db_session_id.to_string() }),
            );
            let _ = sender.send(Message::Text(String::from(reply).into()));
        }
        Err(reason) => {
            send_error(sender, &envelope.id, "DELETE_FAILED", &reason);
        }
    }
}

/// Handle session.clear: archive conversation and reset to fresh state.
pub(super) async fn handle_clear(
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
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
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
                "Session not found",
            );
            return;
        }
    };

    // Close active subprocess if any, capturing runtime_session_id for archive.
    // If stream already finished (Pending with resume), extract from those options.
    let cli_sid = match &handle.state {
        QueryState::Active { query, .. } => {
            persist_and_close_query(
                query,
                &app_state.write_pool,
                db_session_id,
                &handle.runtime_provider,
            )
            .await
        }
        QueryState::Pending(opts) => opts.resume_session_id.clone(),
    };

    // Also clear the init-time resume_session_id in case it wasn't consumed yet
    let cli_sid = cli_sid.or_else(|| handle.resume_session_id.take());

    // Archive and clear in DB (pass cli_sid to avoid re-reading it)
    WsSessionPersistence::archive_and_clear(
        &app_state.write_pool,
        db_session_id,
        cli_sid.as_deref(),
    )
    .await;

    // Reset handle to Pending with fresh options (no resume)
    let fresh_options = RuntimeSpawnConfig {
        cwd: handle.config.cwd.clone(),
        permission_mode: handle.desired_permission_mode.clone(),
        model: handle.desired_model.clone(),
        thinking_effort: handle.desired_thinking_effort.clone(),
        system_prompt: handle.config.system_prompt.clone(),
        env: handle.config.env.clone(),
        ..RuntimeSpawnConfig::default()
    };
    handle.state = QueryState::Pending(fresh_options);

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "cleared",
        serde_json::json!({
            "session_id": db_session_id.to_string(),
            "previous_session_id": cli_sid,
        }),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Broadcast a `session.lifecycle` envelope so the frontend turn-lifecycle
/// state machine flips only on backend-confirmed transitions (per
/// `no-optimistic-updates.md`). Used by both suspend and resume paths.
fn broadcast_lifecycle(sender: &WsSender, session_id: i64, kind: SessionLifecycleKind) {
    let envelope = WsEnvelope::new(
        "session",
        "lifecycle",
        serde_json::to_value(SessionLifecyclePayload {
            session_id: session_id.to_string(),
            kind,
        })
        .unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(envelope).into()));
}

/// Handle `session.suspend`. Provider-neutral pause driven by the renderer
/// when the OS reports a pending suspend. For an active runtime we capture
/// the session id (so it can be `--resume`'d after wake even if the
/// subprocess dies), abort the in-flight turn via the existing `interrupt()`
/// trait method, and persist `paused` to the DB. The lifecycle envelope is
/// emitted only when there's an active runtime — a Pending session has
/// nothing to suspend, so flipping the FE banner for it would be misleading.
pub(super) async fn handle_suspend(
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
    let Some(db_session_id) = parse_session_id(&payload.session_id) else {
        send_error(
            sender,
            &envelope.id,
            "INVALID_SESSION_ID",
            "Invalid session_id",
        );
        return;
    };

    // Extract the live query handle while briefly holding the lock, then
    // drop it so the await on `interrupt()` doesn't block other handlers
    // (same pattern as `handle_permission_respond`).
    let active: Option<(RuntimeSessionHandle, String, i64)> = {
        let sessions = sdk_sessions.lock().await;
        let Some(handle) = sessions.get(&db_session_id) else {
            send_error(
                sender,
                &envelope.id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        };
        match &handle.state {
            QueryState::Active { query, .. } => Some((
                std::sync::Arc::clone(query),
                handle.runtime_provider.clone(),
                handle.feature_id,
            )),
            QueryState::Pending(_) => None,
        }
    };

    let Some((query, runtime_provider, feature_id)) = active else {
        // Pending session: nothing to interrupt, no resume id to persist,
        // no banner to flip. The envelope reply is silent to keep DB/UI
        // state consistent.
        return;
    };

    // Capture session id BEFORE interrupt: once the subprocess starts
    // tearing down, `session_id()` may return None for some adapters.
    let cli_sid = {
        let q = query.lock().await;
        let sid = q.session_id().await;
        let interrupt_result = q.interrupt().await;
        drop(q);
        if let Err(error) = interrupt_result {
            info!(db_session_id, %error, "suspend: interrupt failed (treating as best-effort)");
        }
        sid
    };
    if let Some(sid) = cli_sid.as_deref() {
        // Persist so resume survives a subprocess death during suspend.
        // DB is the source of truth for resume IDs across restarts.
        WsSessionPersistence::persist_runtime_session_id_static(
            &app_state.write_pool,
            db_session_id,
            &runtime_provider,
            sid,
        )
        .await;
    }
    WsSessionPersistence::mark_paused_static(&app_state.write_pool, db_session_id).await;
    WsSessionPersistence::broadcast_session_status(
        &app_state.session_status_tx,
        db_session_id,
        feature_id,
        crate::domain::session_status::AgentStatus::Idle,
        None,
    );

    broadcast_lifecycle(
        sender,
        db_session_id,
        SessionLifecycleKind::SuspendRequested,
    );
}

/// Handle `session.resume`. Counterpart to `handle_suspend`: provider-neutral
/// acknowledgement of OS wake. We don't respawn anything — the renderer has
/// already called `forceReconnectAll` to refresh transport, and the next
/// user prompt picks up `resume_session_id` from the DB via the existing
/// pending-spawn path. The lifecycle envelope is broadcast unconditionally
/// because the renderer can fan this out before the reconnect has finished
/// rebuilding `sdk_sessions` — an existence check here would race the new
/// connection and produce spurious `SESSION_NOT_FOUND` errors.
pub(super) async fn handle_resume(envelope: WsEnvelope, sender: &WsSender) {
    let payload: SessionActionPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };
    let Some(db_session_id) = parse_session_id(&payload.session_id) else {
        send_error(
            sender,
            &envelope.id,
            "INVALID_SESSION_ID",
            "Invalid session_id",
        );
        return;
    };

    broadcast_lifecycle(sender, db_session_id, SessionLifecycleKind::Resumed);
}

/// Handle session.retry_worktree_setup: re-run setup commands for an existing worktree.
pub(super) async fn handle_retry_worktree_setup(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let payload: serde_json::Value = envelope.payload;
    let feature_id = match payload.get("feature_id").and_then(|v| v.as_i64()) {
        Some(fid) => fid,
        None => {
            send_error(
                sender,
                &envelope.id,
                "MISSING_FEATURE_ID",
                "feature_id is required",
            );
            return;
        }
    };

    let wt_path_str =
        match worktree::get_setting(&app_state.read_pool, feature_id, "worktree_path").await {
            Some(p) => p,
            None => {
                send_error(
                    sender,
                    &envelope.id,
                    "NO_WORKTREE",
                    "No worktree found for this feature",
                );
                return;
            }
        };

    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "retry_worktree_setup.ok",
        serde_json::json!({
            "feature_id": feature_id,
        }),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));

    let rp = app_state.read_pool.clone();
    let wp = app_state.write_pool.clone();
    let ws = WorkflowWsSender::new(sender.clone());
    let path = PathBuf::from(wt_path_str);
    tokio::spawn(async move {
        worktree::run_setup_commands(rp, wp, feature_id, path, ws).await;
    });
}
