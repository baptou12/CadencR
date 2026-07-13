#[path = "message_queue_persistence.rs"]
mod persistence;

pub(crate) use self::persistence::enqueue_message;
use self::persistence::{
    claim_next_message, mark_delivered, mark_error, queued_message_uuid, QueuedMessage,
};
use super::scope::{resolve_session_scope, SessionScope};
use crate::app_state::AppState;
use crate::domain::mcp::control::send_message::publish_generated_user_message;
use crate::domain::sessions::models::AgentMessageOrigin;
use crate::domain::sessions::user_messages::{
    persist_user_message, NewUserMessage, PersistedUserMessage,
};
use crate::domain::ws_session::handler::session_prompt::dispatch_control_prompt_with_message_uuid;
use crate::error::AppError;
use futures::{stream, StreamExt};
use std::sync::OnceLock;
use tokio::sync::Notify;

static QUEUE_WORKER_NOTIFY: OnceLock<Notify> = OnceLock::new();

fn worker_notify() -> &'static Notify {
    QUEUE_WORKER_NOTIFY.get_or_init(Notify::new)
}

pub(super) fn notify_worker() {
    worker_notify().notify_one();
}

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = interval.tick() => {}
                _ = worker_notify().notified() => {}
            }
            if let Err(error) = drain_idle_queues_once(&state).await {
                tracing::error!(error = %error, "queued message background drain failed");
            }
        }
    });
}

async fn drain_idle_queues_once(state: &AppState) -> Result<(), AppError> {
    let targets: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT DISTINCT q.target_session_id, s.feature_id
         FROM agent_session_message_queue q
         JOIN agent_sessions s ON s.id = q.target_session_id
         WHERE q.status = 'pending'
           AND s.status NOT IN (
             'running', 'awaiting_permission', 'awaiting_question',
             'waiting_for_permission', 'waiting_for_question'
           )",
    )
    .fetch_all(&state.read_pool)
    .await?;
    stream::iter(targets)
        .for_each_concurrent(4, |(session_id, feature_id)| async move {
            if let Err(error) = drain_next_queued_message(state, feature_id, session_id).await {
                tracing::error!(session_id, error = %error, "queued message delivery failed");
            }
        })
        .await;
    Ok(())
}

pub(crate) async fn drain_next_queued_message(
    state: &AppState,
    target_feature_id: i64,
    target_session_id: i64,
) -> Result<bool, AppError> {
    let mut last_error = None;
    loop {
        let Some(message) = claim_next_message(&state.write_pool, target_session_id).await? else {
            return match last_error {
                Some(error) => Err(error),
                None => Ok(false),
            };
        };
        match deliver_message(state, target_feature_id, target_session_id, &message).await {
            Ok(()) => {
                mark_delivered(&state.write_pool, message.id, &message.claim_token).await?;
                return Ok(true);
            }
            Err(error) => {
                mark_error(
                    &state.write_pool,
                    message.id,
                    &message.claim_token,
                    &error.to_string(),
                )
                .await?;
                last_error = match surface_delivery_failure(
                    state,
                    target_feature_id,
                    target_session_id,
                    &message,
                    &error,
                )
                .await
                {
                    Ok(()) => Some(error),
                    Err(notification_error) => Some(AppError::Internal(format!(
                        "{error}; additionally failed to notify the requesting session: {notification_error}"
                    ))),
                };
            }
        }
    }
}

async fn surface_delivery_failure(
    state: &AppState,
    target_feature_id: i64,
    target_session_id: i64,
    message: &QueuedMessage,
    error: &AppError,
) -> Result<(), AppError> {
    let Some(source_session_id) = message.source_session_id else {
        return Ok(());
    };
    let source = resolve_session_scope(&state.write_pool, source_session_id).await?;
    let target = resolve_session_scope(&state.write_pool, target_session_id).await?;
    let notification_uuid = uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_URL,
        format!(
            "cadencr:queued-message-delivery-error:{}:{}",
            message.id, message.attempt_count
        )
        .as_bytes(),
    );
    let content = format!(
        "<cadencr-delivery-error target-session=\"{target_session_id}\" target-feature=\"{target_feature_id}\" queue-id=\"{}\">\nQueued message delivery failed: {error}\n</cadencr-delivery-error>",
        message.id
    );
    let (persisted, origin) = persist_generated_user_message(
        state,
        source.session_id,
        &target,
        &content,
        "queued project_send_session_message delivery failure",
        notification_uuid,
    )
    .await?;
    publish_generated_user_message(state, source.feature_id, &persisted, origin).await?;
    dispatch_control_prompt_with_message_uuid(
        state,
        source.feature_id,
        source.session_id,
        &content,
        true,
        Some(notification_uuid),
    )
    .await
}

async fn deliver_message(
    state: &AppState,
    target_feature_id: i64,
    target_session_id: i64,
    message: &QueuedMessage,
) -> Result<(), AppError> {
    let dispatch_message_uuid = if let Some(source_session_id) = message.source_session_id {
        let source = resolve_session_scope(&state.write_pool, source_session_id).await?;
        let message_uuid = queued_message_uuid(message)?;
        let (persisted, origin) = persist_generated_user_message(
            state,
            target_session_id,
            &source,
            &message.content,
            "delivered from queued project_send_session_message",
            message_uuid,
        )
        .await?;
        publish_generated_user_message(state, target_feature_id, &persisted, origin).await?;
        Some(message_uuid)
    } else {
        // Automatic reply/gate delivery is persisted before it is queued; the
        // queue row is transport-only and must still dispatch on drain.
        None
    };
    dispatch_control_prompt_with_message_uuid(
        state,
        target_feature_id,
        target_session_id,
        &message.content,
        // The user message was already persisted/broadcast above.
        true,
        dispatch_message_uuid,
    )
    .await
}

async fn persist_generated_user_message(
    state: &AppState,
    target_session_id: i64,
    source: &SessionScope,
    content: &str,
    note: &str,
    message_uuid: uuid::Uuid,
) -> Result<(PersistedUserMessage, AgentMessageOrigin), AppError> {
    let mut tx = state.write_pool.begin().await?;
    let persisted = persist_user_message(
        &mut tx,
        NewUserMessage {
            session_id: target_session_id,
            content,
            message_uuid,
            delivery_state: Some("pending_agent"),
        },
    )
    .await?;
    if persisted.inserted {
        sqlx::query(
            "INSERT INTO agent_message_origins
             (message_id, origin_kind, source_session_id, source_feature_id, source_project_id, note)
             VALUES (?, 'session_generated', ?, ?, ?, ?)",
        )
        .bind(persisted.id)
        .bind(source.session_id)
        .bind(source.feature_id)
        .bind(source.project_id)
        .bind(note)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    let origin =
        crate::domain::sessions::repository::get_message_origin(&state.write_pool, persisted.id)
            .await?
            .ok_or_else(|| {
                AppError::Internal(format!(
                    "message {} is missing canonical provenance",
                    persisted.id
                ))
            })?;
    validate_generated_origin(&persisted, &origin, source, note)?;
    Ok((persisted, origin))
}

fn validate_generated_origin(
    message: &PersistedUserMessage,
    origin: &AgentMessageOrigin,
    source: &SessionScope,
    note: &str,
) -> Result<(), AppError> {
    if crate::domain::sessions::repository::origin_matches_session_generated(
        origin,
        source.session_id,
        source.feature_id,
        source.project_id,
        Some(note),
    ) {
        return Ok(());
    }
    Err(AppError::Conflict(format!(
        "message UUID {} already has different queued provenance on message row {}",
        message.message_uuid, message.id
    )))
}

pub(super) async fn persist_and_broadcast_generated_user_message(
    state: &AppState,
    source: &SessionScope,
    target_session_id: i64,
    target_feature_id: i64,
    content: &str,
    note: &str,
) -> Result<PersistedUserMessage, AppError> {
    let (message, origin) = persist_generated_user_message(
        state,
        target_session_id,
        source,
        content,
        note,
        uuid::Uuid::new_v4(),
    )
    .await?;
    publish_generated_user_message(state, target_feature_id, &message, origin).await?;
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::drain_next_queued_message;
    use super::persistence::{enqueue_message, seed_queue_fixture};
    use crate::app_state::AppState;
    use crate::shared::migrate::{run_migrations, MigrationContext};

    #[tokio::test]
    async fn failed_queue_delivery_persists_origin_and_marks_error() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext {
            pool: &pool,
            db_path: None,
            app_version: None,
        })
        .await
        .unwrap();
        seed_queue_fixture(&pool).await;
        let state = AppState::with_pool(pool.clone());

        let error = drain_next_queued_message(&state, 43, 888)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("runtime adapter unavailable"));
        let status: String =
            sqlx::query_scalar("SELECT status FROM agent_session_message_queue WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "error");
        let origin: (String, i64, i64, i64) = sqlx::query_as(
            "SELECT origin_kind, source_session_id, source_feature_id, source_project_id
             FROM agent_message_origins
             JOIN agent_messages ON agent_messages.id = agent_message_origins.message_id
             WHERE agent_messages.session_id = 888",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(origin, ("session_generated".into(), 777, 42, 7));
        let notification: String = sqlx::query_scalar(
            "SELECT content FROM agent_messages
             WHERE session_id = 777 AND content LIKE '<cadencr-delivery-error%'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(notification.contains("queue-id=\"1\""));
    }

    #[tokio::test]
    async fn retried_queue_row_dispatches_when_its_user_message_already_exists() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        seed_queue_fixture(&pool).await;
        sqlx::query("DELETE FROM agent_session_message_queue")
            .execute(&pool)
            .await
            .unwrap();
        let state = AppState::with_pool(pool.clone());
        let source = super::resolve_session_scope(&pool, 777).await.unwrap();
        let message_uuid = uuid::Uuid::new_v4();
        super::persist_generated_user_message(
            &state,
            888,
            &source,
            "already persisted",
            "delivered from queued project_send_session_message",
            message_uuid,
        )
        .await
        .unwrap();
        enqueue_message(&pool, 888, Some(777), "already persisted", message_uuid)
            .await
            .unwrap();

        let error = drain_next_queued_message(&state, 43, 888)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("runtime adapter unavailable"));

        let status: String = sqlx::query_scalar("SELECT status FROM agent_sessions WHERE id = 888")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status, "paused",
            "the missing-provider dispatch path proves the retry was attempted"
        );
        let message_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_messages
             WHERE session_id = 888 AND message_uuid = ?",
        )
        .bind(message_uuid.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(message_count, 1);
    }

    #[tokio::test]
    async fn one_failed_delivery_does_not_strand_later_pending_rows() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        seed_queue_fixture(&pool).await;
        enqueue_message(
            &pool,
            888,
            Some(777),
            "second queued item",
            uuid::Uuid::new_v4(),
        )
        .await
        .unwrap();
        let state = AppState::with_pool(pool.clone());

        drain_next_queued_message(&state, 43, 888)
            .await
            .unwrap_err();

        let statuses: Vec<String> =
            sqlx::query_scalar("SELECT status FROM agent_session_message_queue ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(statuses, vec!["error", "error"]);
    }
}
