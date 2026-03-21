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
        })
        .unwrap(),
    );
    let _ = sender.send(axum::extract::ws::Message::Text(String::from(reply).into()));

    // If resuming, immediately send the known claude_session_id so the frontend can display it
    if let Some(ref cli_sid) = resume_session_id {
        send_claude_session_id(sender, cli_sid);
    }

    // Broadcast turn state (session row just set to 'running')
    WsSessionPersistence::broadcast_turn_state(&app_state.turn_state_tx, feature_id, "claude");
}
