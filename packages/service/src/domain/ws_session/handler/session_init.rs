use std::collections::HashSet;
use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::{debug, info};

use super::super::permissions;
use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::{
    parse_permission_mode, send_error, send_runtime_session_id, QueryState, SdkHandle, SdkSessions,
    SessionConfig, WsSender,
};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::agents::{adapter_for_model, runtime_adapter};
use crate::domain::settings;
use crate::domain::workflow::worktree;

fn resume_session_id_for_provider(
    provider_id: &str,
    row_runtime_provider: Option<&str>,
    runtime_session_id: Option<&str>,
) -> Option<String> {
    // Only resume when the stored provider matches (or is unset).
    if row_runtime_provider.is_some() && row_runtime_provider != Some(provider_id) {
        return None;
    }
    let adapter = runtime_adapter(provider_id)?;
    adapter.resolve_resume_session_id(runtime_session_id)
}

fn resolve_effective_provider(provider_id: String, model: Option<&str>) -> String {
    if provider_id == DEFAULT_PROVIDER {
        if let Some(model) = model {
            if let Some((adapter_id, _)) = adapter_for_model(model) {
                return adapter_id.to_string();
            }
        }
    }
    provider_id
}

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
            send_error(
                sender,
                &envelope.id,
                "MISSING_FEATURE_ID",
                "feature_id is required for session init",
            );
            return;
        }
    };

    // cwd is required
    let cwd = match payload.cwd {
        Some(ref cwd) if !cwd.is_empty() => cwd.clone(),
        _ => {
            send_error(
                sender,
                &envelope.id,
                "MISSING_CWD",
                "cwd is required for session init",
            );
            return;
        }
    };

    // Find or create DB session row
    info!(
        feature_id,
        "handle_init: looking up session in DB for feature_id"
    );
    let mut persistence = WsSessionPersistence::new(app_state.write_pool.clone(), feature_id);
    let pm_str = payload.permission_mode.as_deref();
    let db_session_id = match persistence
        .find_or_create_session(payload.model.as_deref(), pm_str)
        .await
    {
        Some(id) => {
            info!(
                feature_id,
                db_session_id = id,
                "handle_init: found/created session row"
            );
            id
        }
        None => {
            send_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                "Failed to create/find session in database",
            );
            return;
        }
    };

    // Read session row for runtime_session_id (--resume), token usage, and stored model.
    let row = WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await;
    let runtime_provider = row.as_ref().and_then(|r| r.runtime_provider.clone());
    if let Some(ref r) = row {
        debug!(
            db_session_id,
            feature_id,
            runtime_provider = ?r.runtime_provider,
            runtime_session_id = ?r.runtime_session_id,
            status = %r.status,
            model = ?r.model,
            "handle_init: DB row state at init time"
        );
    }

    let project_id = sqlx::query_scalar::<_, i64>("SELECT project_id FROM features WHERE id = ?")
        .bind(feature_id)
        .fetch_optional(&app_state.read_pool)
        .await
        .ok()
        .flatten();
    let configured_provider = settings::resolve_setting(
        &app_state.read_pool,
        &crate::domain::agents::runtime::runtime_setting_key("session"),
        Some(feature_id),
        project_id,
        Some(DEFAULT_PROVIDER),
    )
    .await
    .unwrap_or_else(|| DEFAULT_PROVIDER.to_string());
    let stored_model = row.as_ref().and_then(|r| r.model.clone());
    let effective_model = stored_model.clone().or(payload.model.clone());
    let effective_provider = resolve_effective_provider(
        runtime_provider
            .or(payload.provider.clone())
            .unwrap_or(configured_provider),
        effective_model.as_deref(),
    );
    let resume_session_id = row.as_ref().and_then(|r| {
        resume_session_id_for_provider(
            &effective_provider,
            r.runtime_provider.as_deref(),
            r.runtime_session_id.as_deref(),
        )
    });
    let init_input_tokens = row.as_ref().and_then(|r| r.input_tokens);
    let init_output_tokens = row.as_ref().and_then(|r| r.output_tokens);
    let init_context_window = row.as_ref().and_then(|r| r.context_window);

    if runtime_adapter(&effective_provider).is_none() {
        send_error(
            sender,
            &envelope.id,
            "UNSUPPORTED_PROVIDER",
            &format!(
                "Runtime provider '{effective_provider}' is not implemented yet for session agents"
            ),
        );
        return;
    }

    if let Err(error) = sqlx::query("UPDATE agent_sessions SET runtime_provider = ? WHERE id = ?")
        .bind(&effective_provider)
        .bind(db_session_id)
        .execute(&app_state.write_pool)
        .await
    {
        tracing::warn!(
            db_session_id,
            runtime_provider = %effective_provider,
            %error,
            "failed to persist session runtime provider"
        );
    }

    // Build SDK options — prefer the model stored in the DB (last used) over the frontend settings model
    let mut runtime_config = RuntimeSpawnConfig::default();
    // If the feature has a worktree, use its path as cwd (critical for --resume)
    let effective_cwd =
        match worktree::get_setting(&app_state.read_pool, feature_id, "worktree_path").await {
            Some(wt_path) if std::path::Path::new(&wt_path).exists() => {
                info!(feature_id, worktree_path = %wt_path, "using worktree path as cwd");
                wt_path
            }
            _ => cwd,
        };
    runtime_config.cwd = std::path::PathBuf::from(&effective_cwd);
    if let Some(ref model) = effective_model {
        runtime_config.model = Some(model.clone());
    }
    if let Some(ref pm) = payload.permission_mode {
        runtime_config.permission_mode = Some(parse_permission_mode(pm));
    }
    if let Some(ref sp) = payload.system_prompt {
        runtime_config.system_prompt = Some(sp.clone());
    }

    info!(
        db_session_id,
        feature_id, "session initialized (pending first prompt)"
    );

    let desired_model = runtime_config.model.clone();
    let desired_permission_mode = runtime_config.permission_mode.clone();
    let canonical_cwd = permissions::canonicalize_worktree(&runtime_config.cwd);
    let config = SessionConfig {
        cwd: runtime_config.cwd.clone(),
        canonical_cwd,
        permission_mode: runtime_config.permission_mode.clone(),
        system_prompt: runtime_config.system_prompt.clone(),
    };
    let allowed_patterns = Arc::new(permissions::load_allowed_patterns(&runtime_config.cwd));
    let session_cache = Arc::new(Mutex::new(HashSet::new()));

    let handle = SdkHandle {
        state: QueryState::Pending(runtime_config),
        feature_id,
        runtime_provider: effective_provider.clone(),
        desired_model,
        spawned_model: None,
        desired_permission_mode,
        spawned_permission_mode: None,
        resume_session_id: resume_session_id.clone(),
        config,
        session_cache,
        allowed_patterns,
    };

    sdk_sessions.lock().await.insert(db_session_id, handle);

    // Send initialized response — session_id is now the DB id as a string
    let reply = WsEnvelope::reply(
        &envelope.id,
        "session",
        "initialized",
        serde_json::to_value(SessionInitializedPayload {
            session_id: db_session_id.to_string(),
            provider: Some(effective_provider.clone()),
            model: effective_model,
            input_tokens: init_input_tokens.map(|v| v as u64),
            output_tokens: init_output_tokens.map(|v| v as u64),
            context_window: init_context_window.map(|v| v as u64),
        })
        .unwrap(),
    );
    let _ = sender.send(axum::extract::ws::Message::Text(String::from(reply).into()));

    // If resuming, immediately send the known runtime_session_id so the frontend can display it
    if let Some(ref cli_sid) = resume_session_id {
        send_runtime_session_id(sender, cli_sid);
    }

    // Check if there's a pending plan approval in the DB (e.g., from a previous app session)
    if let Some(row) =
        WsSessionPersistence::get_session_row(&app_state.read_pool, db_session_id).await
    {
        if row.pending_plan_approval.is_some() {
            info!(
                db_session_id,
                feature_id, "restoring pending plan approval from DB"
            );
            let plan_input: serde_json::Value = row
                .pending_plan_approval
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!({}));
            let payload = super::super::protocol::PermissionRequestPayload {
                request_id: format!("plan_restore_{db_session_id}"),
                tool_name: "ExitPlanMode".to_string(),
                tool_input: plan_input,
                description: Some("Plan is ready for approval".to_string()),
                pattern: None,
                preview: None,
                options: Vec::new(),
            };
            let envelope = super::super::protocol::WsEnvelope::new(
                "session",
                "permission.request",
                serde_json::to_value(payload).unwrap(),
            );
            let _ = sender.send(axum::extract::ws::Message::Text(
                String::from(envelope).into(),
            ));
            WsSessionPersistence::broadcast_turn_state(
                &app_state.turn_state_tx,
                feature_id,
                "askUser",
            );
            return;
        }

        if let Some(payload) = row.pending_permission.as_deref().and_then(|value| {
            serde_json::from_str::<super::super::protocol::PermissionRequestPayload>(value).ok()
        }) {
            let envelope = super::super::protocol::WsEnvelope::new(
                "session",
                "permission.request",
                serde_json::to_value(payload).unwrap(),
            );
            let _ = sender.send(axum::extract::ws::Message::Text(
                String::from(envelope).into(),
            ));
            WsSessionPersistence::broadcast_turn_state(
                &app_state.turn_state_tx,
                feature_id,
                "askUser",
            );
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

#[cfg(test)]
mod tests {
    use super::resume_session_id_for_provider;
    use crate::domain::agents::runtime::DEFAULT_PROVIDER;

    #[test]
    fn resume_session_for_claude_rejects_non_uuid() {
        let resume = resume_session_id_for_provider(
            DEFAULT_PROVIDER,
            Some(DEFAULT_PROVIDER),
            Some("ses_27f586910ffeUNaKL2l5UARerl"),
        );
        assert_eq!(resume, None);
    }

    #[test]
    fn resume_session_for_claude_accepts_uuid() {
        let sid = "11111111-1111-4111-8111-111111111111";
        let resume =
            resume_session_id_for_provider(DEFAULT_PROVIDER, Some(DEFAULT_PROVIDER), Some(sid));
        assert_eq!(resume, Some(sid.to_string()));
    }

    #[test]
    fn resume_session_for_non_claude_only_when_provider_matches() {
        let opencode_sid = "ses_27f586910ffeUNaKL2l5UARerl";
        let matching =
            resume_session_id_for_provider("opencode", Some("opencode"), Some(opencode_sid));
        assert_eq!(matching, Some(opencode_sid.to_string()));

        let mismatched =
            resume_session_id_for_provider("claude_code", Some("opencode"), Some(opencode_sid));
        assert_eq!(mismatched, None);
    }
}
