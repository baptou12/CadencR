use tracing::{error, info, warn};

use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::permissions;
use crate::domain::ws_session::protocol::PromptSendPayload;

use super::super::{SessionConfig, WsSender};

pub(super) async fn prepare_worktree_if_requested(
    app_state: &AppState,
    write_pool: &sqlx::SqlitePool,
    sender: &WsSender,
    payload: &PromptSendPayload,
    feature_id: i64,
    config: &mut SessionConfig,
    options: &mut RuntimeSpawnConfig,
) -> bool {
    let use_worktree = payload.use_worktree.unwrap_or(false);
    if !use_worktree {
        return false;
    }
    auto_name_for_worktree(write_pool, sender, payload, feature_id, config).await;
    create_and_apply_worktree(app_state, write_pool, sender, feature_id, config, options).await;
    true
}

pub(super) fn spawn_auto_name_if_needed(
    use_worktree: bool,
    write_pool: sqlx::SqlitePool,
    sender: WsSender,
    feature_id: i64,
    prompt_text: String,
    cwd: String,
) {
    if use_worktree {
        return;
    }
    tokio::spawn(async move {
        match super::super::super::auto_name::has_default_title(&write_pool, feature_id).await {
            Ok(true) => {
                let result = super::super::super::auto_name::auto_name_feature(
                    write_pool,
                    feature_id,
                    prompt_text,
                    cwd,
                    sender,
                )
                .await;
                info!(feature_id, name = ?result, "auto-named feature");
            }
            Ok(false) => {}
            Err(error) => warn!(feature_id, %error, "auto-name: failed to check title"),
        }
    });
}

async fn auto_name_for_worktree(
    write_pool: &sqlx::SqlitePool,
    sender: &WsSender,
    payload: &PromptSendPayload,
    feature_id: i64,
    config: &SessionConfig,
) {
    match super::super::super::auto_name::has_default_title(write_pool, feature_id).await {
        Ok(true) => {
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
        Ok(false) => {}
        Err(error) => warn!(feature_id, %error, "auto-name: failed to check title"),
    }
}

async fn create_and_apply_worktree(
    app_state: &AppState,
    write_pool: &sqlx::SqlitePool,
    sender: &WsSender,
    feature_id: i64,
    config: &mut SessionConfig,
    options: &mut RuntimeSpawnConfig,
) {
    match worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await {
        Ok(project_id) => {
            apply_worktree_for_project(
                app_state, write_pool, sender, feature_id, project_id, config, options,
            )
            .await;
        }
        Err(error) => {
            error!(feature_id, %error, "could not look up project_id for worktree, proceeding with original cwd");
        }
    }
}

async fn apply_worktree_for_project(
    app_state: &AppState,
    write_pool: &sqlx::SqlitePool,
    sender: &WsSender,
    feature_id: i64,
    project_id: i64,
    config: &mut SessionConfig,
    options: &mut RuntimeSpawnConfig,
) {
    match worktree::ensure_worktree(
        &app_state.read_pool,
        write_pool,
        feature_id,
        project_id,
        sender,
    )
    .await
    {
        Ok(worktree_path) => {
            info!(feature_id, path = %worktree_path.display(), "worktree created for session");
            maybe_spawn_setup_commands(app_state, write_pool, sender, feature_id, &worktree_path)
                .await;
            options.cwd = worktree_path.clone();
            config.canonical_cwd = permissions::canonicalize_worktree(&worktree_path);
            config.cwd = worktree_path;
        }
        Err(error) => {
            error!(feature_id, %error, "worktree creation failed, proceeding with original cwd");
        }
    }
}

async fn maybe_spawn_setup_commands(
    app_state: &AppState,
    write_pool: &sqlx::SqlitePool,
    sender: &WsSender,
    feature_id: i64,
    worktree_path: &std::path::Path,
) {
    let setup_step =
        worktree::get_setting(&app_state.read_pool, feature_id, "worktree_setup_step").await;
    if setup_step.as_deref() == Some("ready") {
        return;
    }
    let read_pool = app_state.read_pool.clone();
    let write_pool = write_pool.clone();
    let sender = sender.clone();
    let worktree_path = worktree_path.to_path_buf();
    tokio::spawn(async move {
        worktree::run_setup_commands(read_pool, write_pool, feature_id, worktree_path, sender)
            .await;
    });
}
