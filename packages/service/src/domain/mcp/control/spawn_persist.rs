use super::spawn_resolve::SpawnRuntimeSelection;
use super::spawn_session::SpawnSessionRequest;
use super::trimmed_optional;
use crate::app_state::AppState;
use crate::error::AppError;

pub(super) async fn insert_spawned_session(
    state: &AppState,
    feature_id: i64,
    body: &SpawnSessionRequest,
    runtime: &SpawnRuntimeSelection,
    codex_permission_mode: Option<&str>,
) -> Result<i64, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    Ok(sqlx::query_scalar(
        "INSERT INTO agent_sessions
         (feature_id, agent_type, status, runtime_provider, model, permission_mode, codex_permission_mode, started_at)
         VALUES (?, 'session', 'paused', ?, ?, ?, COALESCE(?, 'default'), ?)
         RETURNING id",
    )
    .bind(feature_id)
    .bind(runtime.provider.as_deref())
    .bind(runtime.model.as_deref())
    .bind(trimmed_optional(body.permission_mode.as_deref()))
    .bind(codex_permission_mode)
    .bind(now)
    .fetch_one(&state.write_pool)
    .await?)
}

pub(super) async fn insert_initial_message(
    state: &AppState,
    source: &super::scope::SessionScope,
    session_id: i64,
    body: &SpawnSessionRequest,
) -> Result<Option<i64>, AppError> {
    let Some(message) = trimmed_optional(body.initial_message.as_deref()) else {
        return Ok(None);
    };
    let mut tx = state.write_pool.begin().await?;
    let message_id: i64 = sqlx::query_scalar(
        "INSERT INTO agent_messages (session_id, role, content, message_type)
         VALUES (?, 'user', ?, 'user_message')
         RETURNING id",
    )
    .bind(session_id)
    .bind(&message)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO agent_message_origins
         (message_id, origin_kind, source_session_id, source_feature_id, source_project_id, note)
         VALUES (?, 'session_generated', ?, ?, ?, ?)",
    )
    .bind(message_id)
    .bind(source.session_id)
    .bind(source.feature_id)
    .bind(source.project_id)
    .bind(body.source_note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(message_id))
}

pub(super) async fn insert_spawn_link(
    state: &AppState,
    source_session_id: i64,
    target_session_id: i64,
    note: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO agent_session_links (source_session_id, target_session_id, link_type, note)
         VALUES (?, ?, 'spawned', ?)",
    )
    .bind(source_session_id)
    .bind(target_session_id)
    .bind(note)
    .execute(&state.write_pool)
    .await?;
    Ok(())
}
