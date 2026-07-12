use sqlx::SqliteConnection;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedUserMessage {
    pub id: i64,
    pub message_uuid: String,
    pub content: String,
    pub created_at: String,
    pub inserted: bool,
}

pub struct NewUserMessage<'a> {
    pub session_id: i64,
    pub content: &'a str,
    pub message_uuid: Uuid,
    pub created_at: Option<&'a str>,
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
         (session_id, role, content, message_type, message_uuid, created_at)
         VALUES (?, 'user', ?, 'user_message', ?, COALESCE(?, datetime('now')))
         ON CONFLICT(session_id, message_uuid) WHERE message_uuid IS NOT NULL DO NOTHING
         RETURNING id, message_uuid, content, created_at",
    )
    .bind(message.session_id)
    .bind(message.content)
    .bind(&message_uuid)
    .bind(message.created_at)
    .fetch_optional(&mut *connection)
    .await?;

    if let Some(row) = inserted {
        return Ok(row.into_persisted(true));
    }

    let existing = sqlx::query_as::<_, CanonicalUserMessageRow>(
        "SELECT id, message_uuid, content, created_at
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
}

impl CanonicalUserMessageRow {
    fn into_persisted(self, inserted: bool) -> PersistedUserMessage {
        PersistedUserMessage {
            id: self.id,
            message_uuid: self.message_uuid,
            content: self.content,
            created_at: self.created_at,
            inserted,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::migrate::{run_migrations, MigrationContext};

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
                created_at: None,
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
                created_at: None,
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
                created_at: None,
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
                created_at: None,
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
