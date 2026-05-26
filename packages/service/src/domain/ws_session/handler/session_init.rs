use super::super::permissions;
use super::super::persistence::WsSessionPersistence;
use super::super::protocol::*;
use super::{
    default_permission_mode, parse_permission_mode, send_error, send_runtime_session_id,
    QueryState, SdkHandle, SdkSessions, SessionConfig, WsSender,
};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::agents::{resolve_effective_provider, runtime_adapter};
use crate::domain::settings;
use crate::domain::workflow::worktree;
use std::sync::Arc;
use tracing::{debug, info};
#[path = "session_init_feature.rs"]
mod session_init_feature;
#[path = "session_init_restore.rs"]
mod session_init_restore;
#[path = "session_init_resume.rs"]
mod session_init_resume;

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

    // Register the WS sender so HTTP handlers (e.g. auto-rename) can push
    // envelopes to this connection later.
    app_state
        .ws_feature_senders
        .register(feature_id, sender.clone())
        .await;

    let Some(project_id) = session_init_feature::require_feature_project_id(
        app_state,
        sender,
        &envelope.id,
        feature_id,
    )
    .await
    else {
        return;
    };

    // Find or create DB session row
    info!(
        feature_id,
        "handle_init: looking up session in DB for feature_id"
    );
    let configured_codex_access_mode =
        super::codex_access::configured_access_mode(&app_state.read_pool).await;
    let mut persistence = WsSessionPersistence::new(app_state.write_pool.clone(), feature_id);
    let pm_str = payload.permission_mode.as_deref();
    let db_session_id = match persistence
        .find_or_create_session_with_codex_permission_mode(
            payload.model.as_deref(),
            pm_str,
            Some(&configured_codex_access_mode),
        )
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

    let configured_provider = settings::resolve_setting(
        &app_state.read_pool,
        &crate::domain::agents::runtime::runtime_setting_key("session"),
        Some(feature_id),
        Some(project_id),
        Some(DEFAULT_PROVIDER),
    )
    .await
    .unwrap_or_else(|| DEFAULT_PROVIDER.to_string());
    let stored_model = row.as_ref().and_then(|r| r.model.clone());
    let effective_model = stored_model.clone().or(payload.model.clone());
    let stored_thinking_effort = row.as_ref().and_then(|r| r.thinking_effort.clone());
    let effective_provider = resolve_effective_provider(
        runtime_provider
            .or(payload.provider.clone())
            .unwrap_or(configured_provider),
        effective_model.as_deref(),
    );

    // Thinking-effort cascade (model-keyed, not agent-type-keyed):
    //   1. Explicit override from the init payload (frontend just toggled it).
    //   2. Persisted conversation-level override (column on agent_sessions).
    //   3. Workspace per-model default (`thinking_effort_model_<provider>_<model>`).
    //   4. None.
    // Skip the workspace lookup when an earlier step already resolved a value —
    // hydrating from the row is the common case and we don't need a DB hit
    // when no fallback would be consulted.
    let prior_thinking_effort = payload
        .thinking_effort
        .clone()
        .or_else(|| stored_thinking_effort.clone());
    let effective_thinking_effort = match prior_thinking_effort {
        Some(effort) => Some(effort),
        None => match effective_model.as_ref() {
            Some(model_id) => {
                settings::resolve_setting(
                    &app_state.read_pool,
                    &settings::thinking_effort_model_key(&effective_provider, model_id),
                    None,
                    None,
                    None,
                )
                .await
            }
            None => None,
        },
    };

    // Anchor the resolved value to the conversation when it didn't already
    // have one. Future model/effort changes on *other* conversations must not
    // retroactively change this one.
    if stored_thinking_effort.is_none() {
        if let Some(ref effort) = effective_thinking_effort {
            WsSessionPersistence::update_thinking_effort_static(
                &app_state.write_pool,
                db_session_id,
                Some(effort),
            )
            .await;
        }
    }
    let resume_session_id = row.as_ref().and_then(|r| {
        session_init_resume::resume_session_id_for_provider(
            &effective_provider,
            r.runtime_provider.as_deref(),
            r.runtime_session_id.as_deref(),
        )
    });
    let init_input_tokens = row.as_ref().and_then(|r| r.input_tokens);
    let init_output_tokens = row.as_ref().and_then(|r| r.output_tokens);
    let init_context_window = row.as_ref().and_then(|r| r.context_window);

    let Some(adapter) = runtime_adapter(&effective_provider) else {
        send_error(
            sender,
            &envelope.id,
            "UNSUPPORTED_PROVIDER",
            &format!(
                "Runtime provider '{effective_provider}' is not implemented yet for session agents"
            ),
        );
        return;
    };

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
    runtime_config.thinking_effort = effective_thinking_effort.clone();
    // `bypassPermissions` is the agent-equivalent of running as root. We
    // require an explicit project-level acknowledgement stored in settings so
    // a prompt-injected client can't flip it on its own — writes to
    // `bypass_acknowledged` are gated by the settings allowlist.
    if payload.permission_mode.as_deref() == Some("bypassPermissions") {
        let ack = settings::resolve_setting(
            &app_state.read_pool,
            "bypass_acknowledged",
            Some(feature_id),
            Some(project_id),
            Some("false"),
        )
        .await
        .unwrap_or_else(|| "false".to_string());
        if ack != "true" {
            send_error(
                sender,
                &envelope.id,
                "BYPASS_NOT_ACKED",
                "bypassPermissions requires bypass_acknowledged=true in project settings",
            );
            return;
        }
    }
    // Honor the client's choice when supplied; otherwise fall back to the
    // active provider's default. The DB-read and provider-switch paths
    // already apply this default — session.init was the missing site.
    runtime_config.permission_mode = Some(
        payload
            .permission_mode
            .as_deref()
            .map(parse_permission_mode)
            .unwrap_or_else(|| default_permission_mode(&effective_provider)),
    );
    let effective_codex_permission_mode = row
        .as_ref()
        .and_then(|session| session.codex_permission_mode.clone())
        .unwrap_or_else(|| configured_codex_access_mode.clone());
    runtime_config.access_mode = super::codex_access::runtime_access_mode(
        &effective_provider,
        Some(&effective_codex_permission_mode),
        &configured_codex_access_mode,
    );
    runtime_config.system_prompt = payload.system_prompt.clone();
    if effective_provider == crate::domain::agents::claude_code::PROVIDER_ID {
        let (_, profile_env) =
            crate::domain::agents::claude_code::profiles::resolve_active_profile_env(
                &app_state.read_pool,
            )
            .await;
        runtime_config.env = profile_env;
    }

    info!(
        db_session_id,
        feature_id, "session initialized (pending first prompt)"
    );

    let desired_model = runtime_config.model.clone();
    let desired_permission_mode = runtime_config.permission_mode.clone();
    let desired_access_mode = runtime_config.access_mode.clone();
    let desired_thinking_effort = runtime_config.thinking_effort.clone();
    let canonical_cwd = permissions::canonicalize_worktree(&runtime_config.cwd);
    let config = SessionConfig {
        cwd: runtime_config.cwd.clone(),
        canonical_cwd,
        permission_mode: runtime_config.permission_mode.clone(),
        access_mode: runtime_config.access_mode.clone(),
        thinking_effort: runtime_config.thinking_effort.clone(),
        system_prompt: runtime_config.system_prompt.clone(),
        env: runtime_config.env.clone(),
    };
    let handle = SdkHandle {
        state: QueryState::Pending(runtime_config),
        feature_id,
        runtime_provider: effective_provider.clone(),
        desired_model,
        spawned_model: None,
        desired_permission_mode,
        spawned_permission_mode: None,
        desired_access_mode,
        spawned_access_mode: None,
        desired_thinking_effort,
        spawned_thinking_effort: None,
        runtime_control_endpoint: None,
        resume_session_id: resume_session_id.clone(),
        config,
        manual_compact_cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        manual_compact_spawn_pending: Arc::new(std::sync::atomic::AtomicBool::new(false)),
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
            thinking_effort: effective_thinking_effort,
            codex_permission_mode: if effective_provider
                == crate::domain::agents::codex::PROVIDER_ID
            {
                Some(effective_codex_permission_mode)
            } else {
                None
            },
            input_tokens: init_input_tokens.map(|v| v as u64),
            output_tokens: init_output_tokens.map(|v| v as u64),
            context_window: init_context_window.map(|v| v as u64),
            supports_prompt_receipts: adapter.supports_prompt_receipts(),
        })
        .unwrap(),
    );
    let _ = sender.send(axum::extract::ws::Message::Text(String::from(reply).into()));

    // If resuming, immediately send the known runtime_session_id so the frontend can display it
    if let Some(ref cli_sid) = resume_session_id {
        send_runtime_session_id(sender, cli_sid);
    }

    session_init_restore::restore_pending_or_idle(app_state, sender, db_session_id, feature_id)
        .await;
}
