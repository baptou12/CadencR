use axum::extract::ws::Message;

use super::super::super::persistence::WsSessionPersistence;
use super::super::super::protocol::*;
use super::super::helpers::{parse_session_id, send_error};
use super::super::post_plan_mode::{
    should_transition_after_plan_approval, transition_session_to_post_plan_mode,
};
use super::super::session_prompt::PermissionResponse;
use super::super::types::{QueryState, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::{RuntimePermissionResponse, RuntimePermissionResponseKind};
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::ws_session::question_answers::format_answers_plain_text;

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

fn acknowledge_permission_response(sender: &WsSender, envelope_id: &str) {
    let ack = WsEnvelope::reply(
        envelope_id,
        "session",
        "acknowledged",
        serde_json::json!({ "action": "permission.respond" }),
    );
    let _ = sender.send(Message::Text(String::from(ack).into()));
}

/// Whether `sessions` holds a live (`Active`) handle for this session. Locks
/// briefly and releases before the caller acquires any further lock, so it
/// never nests the per-connection map lock with the owner-map lock.
async fn session_is_active(sessions: &SdkSessions, db_session_id: i64) -> bool {
    let guard = sessions.lock().await;
    matches!(
        guard.get(&db_session_id).map(|h| &h.state),
        Some(QueryState::Active { .. })
    )
}

/// Handle session.permission.respond
pub(crate) async fn handle_permission_respond(
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

    // Resolve the connection that owns this session's live turn. The fast path
    // is our own map (we drove the turn). A remote viewer's own map only holds
    // a `Pending` handle, so it falls back to the global registry to reach the
    // host's live query — this is what makes answering a permission/question/
    // plan work from any connected device, not just the turn owner.
    let effective_sessions: SdkSessions = if session_is_active(sdk_sessions, db_session_id).await {
        sdk_sessions.clone()
    } else {
        app_state
            .active_turns
            .owner_sessions(db_session_id)
            .await
            .unwrap_or_else(|| sdk_sessions.clone())
    };
    let sdk_sessions = &effective_sessions;

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
        decision: payload
            .decision
            .to_runtime_decision(payload.option_id.as_deref()),
        option_id: payload.option_id.clone(),
        feedback: payload.feedback.clone(),
        updated_input: payload.updated_input.clone(),
    };
    let permission_kind = {
        let q = query.read().await;
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
        let q = query.read().await;
        q.respond_permission(runtime_response).await
    };
    let is_plan_approval = permission_kind == RuntimePermissionResponseKind::PlanApproval;
    match respond_result {
        Ok(()) => {
            // Acknowledge the UI as soon as the runtime accepts the response.
            // Permission handling must not wait behind SQLite cleanup,
            // status broadcasts, or answer persistence; otherwise the
            // frontend request/response timer can expire even though the
            // ACP server request was already answered.
            acknowledge_permission_response(sender, &envelope.id);
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
            // Clear all pending-input columns defensively: if anything DID get
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
        acknowledge_permission_response(sender, &envelope.id);
        persist_question_answer(
            app_state.write_pool.clone(),
            extracted.feature_id,
            db_session_id,
            answer_to_persist.as_ref(),
        )
        .await;
    }
}
