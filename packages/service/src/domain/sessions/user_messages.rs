use sqlx::SqliteConnection;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedUserMessage {
    pub id: i64,
    pub message_uuid: String,
    pub content: String,
    pub created_at: String,
    pub delivery_state: Option<String>,
    pub inserted: bool,
}

pub struct NewUserMessage<'a> {
    pub session_id: i64,
    pub content: &'a str,
    pub message_uuid: Uuid,
    pub delivery_state: Option<&'a str>,
}

pub fn canonical_user_message_uuid(value: Option<&str>) -> Result<Uuid, uuid::Error> {
    value
        .map(Uuid::parse_str)
        .transpose()
        .map(|uuid| uuid.unwrap_or_else(Uuid::new_v4))
}

#[derive(Debug)]
pub enum PersistUserMessageError {
    Database(sqlx::Error),
    MissingSessionId,
    IdentityConflict {
        session_id: i64,
        message_uuid: String,
    },
}

impl std::fmt::Display for PersistUserMessageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(f, "failed to persist user message: {error}"),
            Self::MissingSessionId => write!(f, "cannot persist user message without a session id"),
            Self::IdentityConflict {
                session_id,
                message_uuid,
            } => write!(
                f,
                "message UUID {message_uuid} already exists with different content in session {session_id}"
            ),
        }
    }
}

impl std::error::Error for PersistUserMessageError {}

impl From<sqlx::Error> for PersistUserMessageError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

impl From<PersistUserMessageError> for AppError {
    fn from(error: PersistUserMessageError) -> Self {
        match error {
            PersistUserMessageError::Database(error) => AppError::DatabaseError(error.to_string()),
            PersistUserMessageError::MissingSessionId => {
                AppError::Internal("cannot persist user message without a session id".to_string())
            }
            PersistUserMessageError::IdentityConflict {
                session_id,
                message_uuid,
            } => AppError::Conflict(format!(
                "message UUID {message_uuid} already has different content in session {session_id}"
            )),
        }
    }
}

/// Insert one canonical user message or return the existing identical row.
///
/// The unique `(session_id, message_uuid)` index is the final concurrency
/// barrier: two transport deliveries can race this function, but only one can
/// report `inserted = true`. Reusing an identity with different content is a
/// hard conflict rather than silently changing or re-dispatching the message.
pub async fn persist_user_message(
    connection: &mut SqliteConnection,
    message: NewUserMessage<'_>,
) -> Result<PersistedUserMessage, PersistUserMessageError> {
    let message_uuid = message.message_uuid.to_string();
    let inserted = sqlx::query_as::<_, CanonicalUserMessageRow>(
        "INSERT INTO agent_messages
         (session_id, role, content, message_type, message_uuid, delivery_state, created_at)
         VALUES (?, 'user', ?, 'user_message', ?, ?, datetime('now'))
         ON CONFLICT(session_id, message_uuid) WHERE message_uuid IS NOT NULL DO NOTHING
         RETURNING id, message_uuid, content, created_at, delivery_state",
    )
    .bind(message.session_id)
    .bind(message.content)
    .bind(&message_uuid)
    .bind(message.delivery_state)
    .fetch_optional(&mut *connection)
    .await?;

    if let Some(row) = inserted {
        return Ok(row.into_persisted(true));
    }

    let existing = sqlx::query_as::<_, CanonicalUserMessageRow>(
        "SELECT id, message_uuid, content, created_at, delivery_state
         FROM agent_messages
         WHERE session_id = ? AND message_uuid = ?",
    )
    .bind(message.session_id)
    .bind(&message_uuid)
    .fetch_one(&mut *connection)
    .await?;
    if existing.content != message.content {
        return Err(PersistUserMessageError::IdentityConflict {
            session_id: message.session_id,
            message_uuid,
        });
    }
    Ok(existing.into_persisted(false))
}

#[derive(sqlx::FromRow)]
struct CanonicalUserMessageRow {
    id: i64,
    message_uuid: String,
    content: String,
    created_at: String,
    delivery_state: Option<String>,
}

impl CanonicalUserMessageRow {
    fn into_persisted(self, inserted: bool) -> PersistedUserMessage {
        PersistedUserMessage {
            id: self.id,
            message_uuid: self.message_uuid,
            content: self.content,
            created_at: self.created_at,
            delivery_state: self.delivery_state,
            inserted,
        }
    }
}

pub async fn update_delivery_state(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    message_uuid: &str,
    state: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE agent_messages SET delivery_state = ?
         WHERE session_id = ? AND message_uuid = ?
           AND (? = 'received_agent' OR delivery_state IS NULL OR delivery_state = 'pending_agent')",
    )
    .bind(state)
    .bind(session_id)
    .bind(message_uuid)
    .bind(state)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn resolve_pending_delivery_states(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    state: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE agent_messages SET delivery_state = ?
         WHERE session_id = ? AND delivery_state = 'pending_agent'",
    )
    .bind(state)
    .bind(session_id)
    .execute(pool)
    .await?
    .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::migrate::{run_migrations, MigrationContext};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn setup() -> (sqlx::SqlitePool, i64) {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp/p')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type)
             VALUES (1, 1, 'f', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status)
             VALUES (1, 'session', 'paused') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        (pool, session_id)
    }

    #[tokio::test]
    async fn duplicate_identity_returns_one_row_and_one_insert_winner() {
        let (pool, session_id) = setup().await;
        let message_uuid = Uuid::new_v4();
        let mut connection = pool.acquire().await.unwrap();

        let first = persist_user_message(
            &mut connection,
            NewUserMessage {
                session_id,
                content: "hello",
                message_uuid,
                delivery_state: None,
            },
        )
        .await
        .unwrap();
        let retry = persist_user_message(
            &mut connection,
            NewUserMessage {
                session_id,
                content: "hello",
                message_uuid,
                delivery_state: None,
            },
        )
        .await
        .unwrap();

        assert!(first.inserted);
        assert!(!retry.inserted);
        assert_eq!(first.id, retry.id);
        drop(connection);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn concurrent_identity_race_has_exactly_one_insert_winner() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let options =
            SqliteConnectOptions::from_str(&format!("sqlite:{}", tmp.path().to_str().unwrap()))
                .unwrap()
                .create_if_missing(true)
                .busy_timeout(std::time::Duration::from_secs(2));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .unwrap();
        run_migrations(&MigrationContext::pool_only(&pool))
            .await
            .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp/p')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'f')")
            .execute(&pool)
            .await
            .unwrap();
        let session_id: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status)
             VALUES (1, 'session', 'paused') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let message_uuid = Uuid::new_v4();
        let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));

        let attempt = |pool: sqlx::SqlitePool, barrier: std::sync::Arc<tokio::sync::Barrier>| {
            tokio::spawn(async move {
                let mut connection = pool.acquire().await.unwrap();
                barrier.wait().await;
                persist_user_message(
                    &mut connection,
                    NewUserMessage {
                        session_id,
                        content: "same logical send",
                        message_uuid,
                        delivery_state: Some("pending_agent"),
                    },
                )
                .await
                .unwrap()
            })
        };
        let (left, right) = tokio::join!(
            attempt(pool.clone(), barrier.clone()),
            attempt(pool.clone(), barrier)
        );
        let outcomes = [left.unwrap(), right.unwrap()];

        assert_eq!(
            outcomes.iter().filter(|message| message.inserted).count(),
            1
        );
        assert_eq!(outcomes[0].id, outcomes[1].id);
    }

    #[tokio::test]
    async fn duplicate_identity_with_different_content_is_rejected() {
        let (pool, session_id) = setup().await;
        let message_uuid = Uuid::new_v4();
        let mut connection = pool.acquire().await.unwrap();
        persist_user_message(
            &mut connection,
            NewUserMessage {
                session_id,
                content: "first",
                message_uuid,
                delivery_state: None,
            },
        )
        .await
        .unwrap();

        let error = persist_user_message(
            &mut connection,
            NewUserMessage {
                session_id,
                content: "different",
                message_uuid,
                delivery_state: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            PersistUserMessageError::IdentityConflict { .. }
        ));
    }
}
