use super::super::scope::SessionScope;
use crate::app_state::AppState;
use crate::domain::sessions::models::AgentMessageOrigin;
use crate::domain::sessions::user_messages::{
    persist_user_message, NewUserMessage, PersistedUserMessage,
};
use crate::error::AppError;

pub(super) struct ImmediateMessageRequest<'a> {
    pub state: &'a AppState,
    pub source: &'a SessionScope,
    pub target: &'a SessionScope,
    pub message: &'a str,
    pub message_uuid: uuid::Uuid,
    pub source_note: Option<&'a str>,
    pub link_to_current_session: bool,
    pub await_reply: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ImmediateDispatchClaim {
    Claimed { token: String },
    InProgress,
    Dispatched,
}

pub(super) async fn persist_immediate_message(
    request: ImmediateMessageRequest<'_>,
) -> Result<(PersistedUserMessage, AgentMessageOrigin), AppError> {
    let mut tx = request.state.write_pool.begin().await?;
    let persisted = persist_user_message(
        &mut tx,
        NewUserMessage {
            session_id: request.target.session_id,
            content: request.message,
            message_uuid: request.message_uuid,
            created_at: None,
        },
    )
    .await?;
    if persisted.inserted {
        persist_immediate_side_effects(&mut tx, &request, persisted.id).await?;
    }
    tx.commit().await?;
    let origin = crate::domain::sessions::repository::get_message_origin(
        &request.state.write_pool,
        persisted.id,
    )
    .await?
    .ok_or_else(|| {
        AppError::Internal(format!(
            "message {} is missing canonical provenance",
            persisted.id
        ))
    })?;
    validate_immediate_origin(&request, &persisted, &origin)?;
    Ok((persisted, origin))
}

fn validate_immediate_origin(
    request: &ImmediateMessageRequest<'_>,
    message: &PersistedUserMessage,
    origin: &AgentMessageOrigin,
) -> Result<(), AppError> {
    if crate::domain::sessions::repository::origin_matches_session_generated(
        origin,
        request.source.session_id,
        request.source.feature_id,
        request.source.project_id,
        request.source_note,
    ) {
        return Ok(());
    }
    Err(AppError::Conflict(format!(
        "message UUID {} already has different provenance in session {}",
        message.message_uuid, request.target.session_id
    )))
}

async fn persist_immediate_side_effects(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    request: &ImmediateMessageRequest<'_>,
    message_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO agent_message_dispatches (message_id, status)
         VALUES (?, 'pending')",
    )
    .bind(message_id)
    .execute(&mut **tx)
    .await?;
    if request.await_reply {
        super::super::reply_wait::insert_pending(
            tx,
            request.source.session_id,
            request.target.session_id,
            message_id,
            "message",
        )
        .await?;
    }
    sqlx::query(
        "INSERT INTO agent_message_origins
         (message_id, origin_kind, source_session_id, source_feature_id, source_project_id, note)
         VALUES (?, 'session_generated', ?, ?, ?, ?)",
    )
    .bind(message_id)
    .bind(request.source.session_id)
    .bind(request.source.feature_id)
    .bind(request.source.project_id)
    .bind(request.source_note)
    .execute(&mut **tx)
    .await?;
    if request.link_to_current_session {
        execute_message_link(
            &mut **tx,
            request.source.session_id,
            request.target.session_id,
            request.source_note,
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn claim_immediate_dispatch(
    pool: &sqlx::SqlitePool,
    message_id: i64,
) -> Result<ImmediateDispatchClaim, AppError> {
    let token = uuid::Uuid::new_v4().to_string();
    let claimed: Option<String> = sqlx::query_scalar(
        "UPDATE agent_message_dispatches
         SET status = 'dispatching', attempt_count = attempt_count + 1,
             claim_token = ?, claimed_at = datetime('now'), error = NULL,
             updated_at = datetime('now')
         WHERE message_id = ? AND status IN ('pending', 'error')
         RETURNING claim_token",
    )
    .bind(&token)
    .bind(message_id)
    .fetch_optional(pool)
    .await?;
    if claimed.is_some() {
        return Ok(ImmediateDispatchClaim::Claimed { token });
    }

    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM agent_message_dispatches WHERE message_id = ?")
            .bind(message_id)
            .fetch_optional(pool)
            .await?;
    match status.as_deref() {
        Some("dispatching") => Ok(ImmediateDispatchClaim::InProgress),
        Some("dispatched") => Ok(ImmediateDispatchClaim::Dispatched),
        Some(other) => Err(AppError::Internal(format!(
            "message {message_id} has an unclaimable dispatch status '{other}'"
        ))),
        None => Err(AppError::Internal(format!(
            "message {message_id} has no dispatch lifecycle"
        ))),
    }
}

pub(super) async fn mark_immediate_dispatch_succeeded(
    pool: &sqlx::SqlitePool,
    message_id: i64,
    claim_token: &str,
) -> Result<(), AppError> {
    update_claimed_dispatch(pool, message_id, claim_token, "dispatched", None).await
}

pub(super) async fn mark_immediate_dispatch_failed(
    pool: &sqlx::SqlitePool,
    message_id: i64,
    claim_token: &str,
    error: &str,
) -> Result<(), AppError> {
    update_claimed_dispatch(pool, message_id, claim_token, "error", Some(error)).await
}

async fn update_claimed_dispatch(
    pool: &sqlx::SqlitePool,
    message_id: i64,
    claim_token: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    let result = sqlx::query(
        "UPDATE agent_message_dispatches
         SET status = ?, error = ?,
             dispatched_at = CASE WHEN ? = 'dispatched' THEN datetime('now') ELSE NULL END,
             updated_at = datetime('now')
         WHERE message_id = ? AND status = 'dispatching' AND claim_token = ?",
    )
    .bind(status)
    .bind(error)
    .bind(status)
    .bind(message_id)
    .bind(claim_token)
    .execute(pool)
    .await?;
    if result.rows_affected() != 1 {
        return Err(AppError::Internal(format!(
            "dispatch claim for message {message_id} is no longer current"
        )));
    }
    Ok(())
}

async fn execute_message_link<'e, E>(
    executor: E,
    source_session_id: i64,
    target_session_id: i64,
    note: Option<&str>,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query(
        "INSERT INTO agent_session_links (source_session_id, target_session_id, link_type, note)
         VALUES (?, ?, 'messaged', ?)",
    )
    .bind(source_session_id)
    .bind(target_session_id)
    .bind(note)
    .execute(executor)
    .await?;
    Ok(())
}

pub(super) async fn insert_message_link(
    state: &AppState,
    source_session_id: i64,
    target_session_id: i64,
    note: Option<&str>,
) -> Result<(), AppError> {
    execute_message_link(
        &state.write_pool,
        source_session_id,
        target_session_id,
        note,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::migrate::{run_migrations, MigrationContext};

    #[tokio::test]
    async fn retry_reuses_one_message_origin_and_link() {
        let (pool, state, source, target) = setup().await;
        let message_uuid = uuid::Uuid::new_v4();

        let persist = || ImmediateMessageRequest {
            state: &state,
            source: &source,
            target: &target,
            message: "same delegated prompt",
            message_uuid,
            source_note: Some("transport retry"),
            link_to_current_session: true,
            await_reply: false,
        };
        let (first, _) = persist_immediate_message(persist()).await.unwrap();
        let (retry, retry_origin) = persist_immediate_message(persist()).await.unwrap();
        let mismatched = persist_immediate_message(ImmediateMessageRequest {
            source_note: Some("different provenance"),
            ..persist()
        })
        .await;

        assert!(first.inserted);
        assert!(!retry.inserted);
        assert_eq!(first.id, retry.id);
        assert_eq!(retry_origin.note.as_deref(), Some("transport retry"));
        assert!(matches!(mismatched, Err(AppError::Conflict(_))));
        let counts: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM agent_messages),
                (SELECT COUNT(*) FROM agent_message_origins),
                (SELECT COUNT(*) FROM agent_session_links),
                (SELECT COUNT(*) FROM agent_message_dispatches)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(counts, (1, 1, 1, 1));
    }

    #[tokio::test]
    async fn failed_dispatch_can_be_claimed_once_by_an_idempotent_retry() {
        let (pool, state, source, target) = setup().await;
        let message = persist_immediate_message(ImmediateMessageRequest {
            state: &state,
            source: &source,
            target: &target,
            message: "retry me",
            message_uuid: uuid::Uuid::new_v4(),
            source_note: None,
            link_to_current_session: false,
            await_reply: false,
        })
        .await
        .unwrap()
        .0;

        let first = claim_immediate_dispatch(&pool, message.id).await.unwrap();
        let ImmediateDispatchClaim::Claimed { token: first_token } = first else {
            panic!("first attempt should own the dispatch claim");
        };
        sqlx::query(
            "UPDATE agent_message_dispatches SET claimed_at = '2000-01-01 00:00:00'
             WHERE message_id = ?",
        )
        .bind(message.id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            claim_immediate_dispatch(&pool, message.id).await.unwrap(),
            ImmediateDispatchClaim::InProgress
        );
        mark_immediate_dispatch_failed(&pool, message.id, &first_token, "temporary failure")
            .await
            .unwrap();

        let retry = claim_immediate_dispatch(&pool, message.id).await.unwrap();
        let ImmediateDispatchClaim::Claimed { token: retry_token } = retry else {
            panic!("failed attempt should be retryable");
        };
        assert_ne!(first_token, retry_token);
        mark_immediate_dispatch_succeeded(&pool, message.id, &retry_token)
            .await
            .unwrap();
        assert_eq!(
            claim_immediate_dispatch(&pool, message.id).await.unwrap(),
            ImmediateDispatchClaim::Dispatched
        );
        let lifecycle: (String, i64, Option<String>) = sqlx::query_as(
            "SELECT status, attempt_count, error
             FROM agent_message_dispatches WHERE message_id = ?",
        )
        .bind(message.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(lifecycle, ("dispatched".to_string(), 2, None));
    }

    async fn setup() -> (sqlx::SqlitePool, AppState, SessionScope, SessionScope) {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (7, 'p', '/tmp/p')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type)
             VALUES (42, 7, 'source', 'active', 'ws-session'),
                    (43, 7, 'target', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_sessions (id, feature_id, agent_type, status)
             VALUES (777, 42, 'session', 'running'), (888, 43, 'session', 'paused')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let state = AppState::with_pool(pool.clone());
        let source = scope(777, 42, "running");
        let target = scope(888, 43, "paused");
        (pool, state, source, target)
    }

    fn scope(session_id: i64, feature_id: i64, status: &str) -> SessionScope {
        SessionScope {
            session_id,
            feature_id,
            feature_title: String::new(),
            project_id: 7,
            status: status.to_string(),
        }
    }
}
