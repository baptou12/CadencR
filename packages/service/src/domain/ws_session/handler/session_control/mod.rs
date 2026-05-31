//! `session.*` control-plane handlers, split by responsibility:
//! - `permission`: `session.permission.respond`
//! - `provider` / `model`: `session.provider.set` / `session.model.set`
//! - `mode` / `effort`: permission/access mode and thinking-effort changes
//! - `lifecycle` / `power`: interrupt/destroy/delete/clear and
//!   suspend/resume/retry_worktree_setup

mod effort;
mod lifecycle;
mod mode;
mod model;
mod permission;
mod power;
mod provider;

pub(super) use effort::handle_effort_set;
pub(super) use lifecycle::{handle_clear, handle_delete, handle_destroy, handle_interrupt};
pub(super) use mode::{handle_codex_permission_mode_set, handle_mode_set};
pub(super) use model::handle_model_set;
pub(super) use permission::handle_permission_respond;
pub(super) use power::{handle_resume, handle_retry_worktree_setup, handle_suspend};
pub(super) use provider::handle_provider_set;

/// Whether the session already has any persisted agent messages. Used to lock
/// provider/model changes once a conversation has started.
pub(super) async fn session_has_messages(
    pool: &sqlx::SqlitePool,
    session_id: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM agent_messages WHERE session_id = ?)")
        .bind(session_id)
        .fetch_one(pool)
        .await
        .map(|exists| exists != 0)
}
