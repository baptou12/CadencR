//! Worktree provisioning entry points.
//!
//! `ensure_worktree` is the single dispatch entry the WS handlers call.
//! It picks one of three modes (`Skip` / `Reuse` / `New`) based on
//! `feature_settings`, then delegates to the matching helper. Each mode
//! is a tiny submodule:
//!
//! - [`branch`] — branch-name construction.
//! - [`db`] — `feature_settings` + project lookups shared across modes.
//! - [`new_branch`] — `WorktreeMode::New` helpers (`ensure_new_branch_name`,
//!   `add_new_worktree`).
//! - [`reuse`] — `WorktreeMode::Reuse` (`attach_to_existing_branch`,
//!   `WorktreeAttached`).
//! - [`setup`] — `run_setup_commands`: streams the project's setup script
//!   into the freshly-created worktree.
//! - [`envelope`] — tiny `WsEnvelope` send helper.

mod branch;
mod db;
mod envelope;
mod new_branch;
mod replay;
mod reuse;
mod setup;

pub use db::{get_project_directory, get_project_id_for_feature, get_setting, set_setting};
pub use replay::replay_persisted_state;
pub use reuse::attach_to_existing_branch;
pub use setup::run_setup_commands;

use std::path::PathBuf;

use sqlx::SqlitePool;

use crate::domain::workflow::ws_sender::WsSender;
use crate::shared::worktree_paths::compute_worktree_path;

use db::{lookup_project, read_base_branch};
use envelope::send_envelope;

/// User-selected worktree provisioning mode for a feature. Read from
/// `feature_settings` (legacy `skip_worktree=true` is mapped to `Skip`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorktreeMode {
    New,
    Reuse(String),
    Skip,
}

/// Idempotent worktree creation orchestrator. Reads `worktree_mode` from
/// feature settings and dispatches to the matching helper. Legacy
/// `skip_worktree=true` is mapped to `WorktreeMode::Skip`.
pub async fn ensure_worktree(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    ws_sender: &WsSender,
) -> Result<PathBuf, String> {
    let mode = read_worktree_mode(read_pool, feature_id).await;

    if matches!(mode, WorktreeMode::Skip) {
        return ensure_skip(read_pool, feature_id, project_id, ws_sender).await;
    }

    if let Some(existing) = replay_persisted_state(read_pool, feature_id, ws_sender).await {
        return Ok(existing);
    }

    match mode {
        WorktreeMode::Skip => unreachable!("handled above"),
        WorktreeMode::Reuse(branch) => {
            ensure_reuse(
                read_pool, write_pool, feature_id, project_id, &branch, ws_sender,
            )
            .await
        }
        WorktreeMode::New => {
            ensure_new(read_pool, write_pool, feature_id, project_id, ws_sender).await
        }
    }
}

/// Read the user-selected worktree mode from feature settings, falling back
/// to legacy `skip_worktree=true` for older rows.
pub async fn read_worktree_mode(read_pool: &SqlitePool, feature_id: i64) -> WorktreeMode {
    if get_setting(read_pool, feature_id, "skip_worktree")
        .await
        .as_deref()
        == Some("true")
    {
        return WorktreeMode::Skip;
    }
    let mode = get_setting(read_pool, feature_id, "worktree_mode").await;
    match mode.as_deref() {
        Some("skip") => WorktreeMode::Skip,
        Some("reuse") => match get_setting(read_pool, feature_id, "worktree_reuse_branch").await {
            Some(b) if !b.trim().is_empty() => WorktreeMode::Reuse(b),
            // Misconfigured reuse without a branch — fall back to New so we
            // don't hang the feature on a NotFound. The handler validates
            // this at create time; this is just defense in depth.
            _ => WorktreeMode::New,
        },
        _ => WorktreeMode::New,
    }
}

/// `worktree_mode == "skip"` path: return the project dir as the worktree.
async fn ensure_skip(
    read_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    ws_sender: &WsSender,
) -> Result<PathBuf, String> {
    let project_dir = get_project_directory(read_pool, project_id).await?;
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.ready",
        serde_json::json!({ "feature_id": feature_id }),
    );
    Ok(PathBuf::from(project_dir))
}

/// `worktree_mode == "new"` path: build a fresh worktree on a brand-new
/// branch derived from the feature title. When `worktree_base_branch` is set,
/// the new branch forks from that ref; otherwise it forks from the project's
/// current HEAD (today's behavior).
async fn ensure_new(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    ws_sender: &WsSender,
) -> Result<PathBuf, String> {
    let (project_dir, project_name) = lookup_project(read_pool, project_id).await?;
    let branch =
        new_branch::ensure_new_branch_name(read_pool, write_pool, feature_id, project_id).await?;
    let path_str = compute_worktree_path(&project_name, &branch).await?;
    let base_branch = read_base_branch(read_pool, feature_id).await;

    send_envelope(
        ws_sender,
        "workflow",
        "worktree.creating",
        serde_json::json!({
            "feature_id": feature_id,
            "branch": branch,
            "path": path_str,
        }),
    );

    new_branch::add_new_worktree(&project_dir, &branch, &path_str, base_branch.as_deref()).await?;
    notify_provider_worktree_created(&project_dir, &path_str).await?;
    persist_and_announce(write_pool, feature_id, &path_str, &branch, ws_sender).await?;
    Ok(PathBuf::from(path_str))
}

/// `worktree_mode == "reuse"` path: attach to `branch`, sharing an existing
/// worktree if one is already checked out, otherwise creating a fresh
/// worktree on the same branch.
async fn ensure_reuse(
    read_pool: &SqlitePool,
    write_pool: &SqlitePool,
    feature_id: i64,
    project_id: i64,
    branch: &str,
    ws_sender: &WsSender,
) -> Result<PathBuf, String> {
    let (project_dir, project_name) = lookup_project(read_pool, project_id).await?;
    // Mirror the `New` envelope sequence so the frontend's worktree state
    // machine has a consistent shape regardless of mode.
    send_envelope(
        ws_sender,
        "workflow",
        "worktree.creating",
        serde_json::json!({
            "feature_id": feature_id,
            "branch": branch,
            "path": serde_json::Value::Null,
        }),
    );

    let attached =
        attach_to_existing_branch(branch, std::path::Path::new(&project_dir), &project_name)
            .await?;

    persist_and_announce(
        write_pool,
        feature_id,
        &attached.worktree_path,
        &attached.branch,
        ws_sender,
    )
    .await?;

    if attached.was_already_attached {
        // Shared worktree — the donor feature already ran its setup
        // commands. Skip ours and jump straight to ready.
        let _ = set_setting(write_pool, feature_id, "worktree_setup_step", "ready").await;
        send_envelope(
            ws_sender,
            "workflow",
            "worktree.ready",
            serde_json::json!({ "feature_id": feature_id }),
        );
    } else {
        notify_provider_worktree_created(&project_dir, &attached.worktree_path).await?;
    }
    // Else: the ws-session prompt path spawns `run_setup_commands` exactly as
    // it does for the `New` path.

    Ok(PathBuf::from(attached.worktree_path))
}

async fn notify_provider_worktree_created(project_dir: &str, path_str: &str) -> Result<(), String> {
    crate::domain::agents::providers::notify_worktree_created_for_all_providers(
        std::path::Path::new(project_dir),
        std::path::Path::new(path_str),
    )
    .await
    .map_err(|e| e.to_string())
}

/// Persist worktree path + branch to `feature_settings` and emit
/// `worktree.created` + `feature.updated` envelopes. Used by both the
/// `New` and `Reuse` paths.
async fn persist_and_announce(
    write_pool: &SqlitePool,
    feature_id: i64,
    path_str: &str,
    branch: &str,
    ws_sender: &WsSender,
) -> Result<(), String> {
    set_setting(write_pool, feature_id, "worktree_path", path_str).await?;
    set_setting(write_pool, feature_id, "worktree_branch", branch).await?;
    set_setting(write_pool, feature_id, "worktree_setup_step", "created").await?;

    send_envelope(
        ws_sender,
        "workflow",
        "worktree.created",
        serde_json::json!({
            "feature_id": feature_id,
            "path": path_str,
            "branch": branch,
        }),
    );

    send_envelope(
        ws_sender,
        "feature",
        "updated",
        serde_json::json!({
            "feature_id": feature_id,
            "changed": ["settings"],
        }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, \
             PRIMARY KEY (feature_id, key))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn read_worktree_mode_defaults_to_new() {
        let pool = make_pool().await;
        assert_eq!(read_worktree_mode(&pool, 1).await, WorktreeMode::New);
    }

    #[tokio::test]
    async fn read_worktree_mode_legacy_skip_true_maps_to_skip() {
        let pool = make_pool().await;
        set_setting(&pool, 1, "skip_worktree", "true")
            .await
            .unwrap();
        assert_eq!(read_worktree_mode(&pool, 1).await, WorktreeMode::Skip);
    }

    #[tokio::test]
    async fn read_worktree_mode_explicit_skip_value() {
        let pool = make_pool().await;
        set_setting(&pool, 1, "worktree_mode", "skip")
            .await
            .unwrap();
        assert_eq!(read_worktree_mode(&pool, 1).await, WorktreeMode::Skip);
    }

    #[tokio::test]
    async fn read_worktree_mode_reuse_requires_branch_else_falls_back() {
        let pool = make_pool().await;
        set_setting(&pool, 1, "worktree_mode", "reuse")
            .await
            .unwrap();
        // No reuse_branch → falls back to New (defense in depth).
        assert_eq!(read_worktree_mode(&pool, 1).await, WorktreeMode::New);

        set_setting(&pool, 1, "worktree_reuse_branch", "feat/x")
            .await
            .unwrap();
        assert_eq!(
            read_worktree_mode(&pool, 1).await,
            WorktreeMode::Reuse("feat/x".into())
        );
    }
}
