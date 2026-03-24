use std::collections::HashSet;
use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::{debug, info};

use claude_agent_sdk_rs::Options;

use crate::app_state::AppState;
use super::super::permissions;
use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::{
    parse_permission_mode, send_claude_session_id, send_error,
    QueryState, SdkHandle, SdkSessions, SessionConfig, WsSender,
};

/// Handle session.init: DB-driven session creation.
pub(super) async fn handle_init(
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

    // Read session row for claude_session_id (--resume) and token usage restoration.
    let (resume_session_id, init_input_tokens, init_output_tokens, init_context_window) =
        if let Some(row) = WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await {
            debug!(
                db_session_id,
                feature_id,
                claude_session_id = ?row.claude_session_id,
                status = %row.status,
                "handle_init: DB row state at init time"
            );
            (row.claude_session_id, row.input_tokens, row.output_tokens, row.context_window)
        } else {
            (None, None, None, None)
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
        canonical_cwd,
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
        resume_session_id: resume_session_id.clone(),
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
            input_tokens: init_input_tokens.map(|v| v as u64),
            output_tokens: init_output_tokens.map(|v| v as u64),
            context_window: init_context_window.map(|v| v as u64),
        })
        .unwrap(),
    );
    let _ = sender.send(axum::extract::ws::Message::Text(String::from(reply).into()));

    // If resuming, immediately send the known claude_session_id so the frontend can display it
    if let Some(ref cli_sid) = resume_session_id {
        send_claude_session_id(sender, cli_sid);
    }

    // Check if there's a pending plan approval in the DB (e.g., from a previous app session)
    if let Some(row) = WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await {
        if row.pending_plan_approval.is_some() {
            info!(db_session_id, feature_id, "restoring pending plan approval from DB");
            let plan_input: serde_json::Value = row.pending_plan_approval
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!({}));
            let payload = super::super::protocol::PermissionRequestPayload {
                request_id: format!("plan_restore_{db_session_id}"),
                tool_name: "ExitPlanMode".to_string(),
                tool_input: plan_input,
                description: Some("Plan is ready for approval".to_string()),
                pattern: None,
            };
            let envelope = super::super::protocol::WsEnvelope::new(
                "session",
                "permission.request",
                serde_json::to_value(payload).unwrap(),
            );
            let _ = sender.send(axum::extract::ws::Message::Text(String::from(envelope).into()));
            WsSessionPersistence::broadcast_turn_state(&app_state.turn_state_tx, feature_id, "askUser");
            return;
        }
    }

    // Clear stale pending_questions so the frontend doesn't show a stale form.
    // The user can say "retry" to have the agent re-ask.
    let _ = sqlx::query("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ? AND pending_questions IS NOT NULL")
        .bind(db_session_id)
        .execute(&app_state.write_pool)
        .await;

    // Broadcast "none" to clear any stale turn state — session is idle until a prompt is sent
    WsSessionPersistence::broadcast_turn_state(&app_state.turn_state_tx, feature_id, "none");
}
