use axum::extract::ws::Message;

use crate::domain::sessions::models::AgentMessageOrigin;
use crate::domain::sessions::user_messages::{
    canonical_user_message_uuid, PersistUserMessageError, PersistedUserMessage,
};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{
    PromptReceiptState, PromptReceivedPayload, PromptSendPayload, UserMessageDeliveryState,
    UserMessagePayload, WsEnvelope, WsSessionAction,
};
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;

use super::super::WsSender;

pub(super) enum PromptPersistenceOutcome {
    Replay,
    Persisted(PersistedUserMessage),
}

impl PromptPersistenceOutcome {
    pub fn should_dispatch(&self) -> bool {
        matches!(
            self,
            Self::Replay | Self::Persisted(PersistedUserMessage { inserted: true, .. })
        )
    }

    pub fn message_id(&self) -> Option<i64> {
        match self {
            Self::Replay => None,
            Self::Persisted(message) => Some(message.id),
        }
    }

    pub fn inserted(&self) -> bool {
        matches!(
            self,
            Self::Persisted(PersistedUserMessage { inserted: true, .. })
        )
    }
}

pub(super) async fn persist_and_publish_prompt(
    pool: &sqlx::SqlitePool,
    feature_senders: &WsFeatureSenderRegistry,
    sender: &WsSender,
    feature_id: i64,
    session_id: i64,
    payload: &PromptSendPayload,
    content: &str,
) -> Result<PromptPersistenceOutcome, String> {
    if payload.replay {
        return Ok(PromptPersistenceOutcome::Replay);
    }
    let message_uuid = canonical_user_message_uuid(payload.message_uuid.as_deref())
        .map_err(|_| "prompt has an invalid canonical message UUID".to_string())?;
    let message = persist_and_publish_user_message(CanonicalUserMessageRequest {
        pool,
        feature_senders,
        owner: Some(sender),
        feature_id,
        session_id,
        content,
        message_uuid,
        origin: None,
        pending_agent_receipt: payload.track_prompt_receipt,
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(PromptPersistenceOutcome::Persisted(message))
}

/// Persist and publish one canonical user message through the shared live
/// event path. All interactive ingress points use this helper so persistence
/// and WebSocket identity cannot drift into separate implementations.
pub(crate) struct CanonicalUserMessageRequest<'a> {
    pub pool: &'a sqlx::SqlitePool,
    pub feature_senders: &'a WsFeatureSenderRegistry,
    pub owner: Option<&'a WsSender>,
    pub feature_id: i64,
    pub session_id: i64,
    pub content: &'a str,
    pub message_uuid: uuid::Uuid,
    pub origin: Option<AgentMessageOrigin>,
    pub pending_agent_receipt: bool,
}

pub(crate) async fn persist_and_publish_user_message(
    request: CanonicalUserMessageRequest<'_>,
) -> Result<PersistedUserMessage, PersistUserMessageError> {
    let persistence = WsSessionPersistence::with_session_id(
        request.pool.clone(),
        request.feature_id,
        Some(request.session_id),
    );
    let message = persistence
        .persist_user_message(request.content, request.message_uuid)
        .await?;
    publish_user_message(
        request.feature_senders,
        request.owner,
        request.feature_id,
        &message,
        request.origin,
        request.pending_agent_receipt,
    )
    .await;
    Ok(message)
}

/// Publish the one canonical persisted user-message shape to every viewer.
/// The owner receives the same event as passive viewers; there is no separate
/// sender-side block creation path.
pub(crate) async fn publish_user_message(
    feature_senders: &WsFeatureSenderRegistry,
    owner: Option<&WsSender>,
    feature_id: i64,
    message: &PersistedUserMessage,
    origin: Option<AgentMessageOrigin>,
    pending_agent_receipt: bool,
) {
    let env = WsEnvelope::new(
        "session",
        "user_message",
        serde_json::to_value(UserMessagePayload {
            message_id: message.id,
            message_uuid: message.message_uuid.clone(),
            text: message.content.clone(),
            created_at: message.created_at.clone(),
            origin,
            prompt_delivery_state: pending_agent_receipt
                .then_some(UserMessageDeliveryState::PendingAgent),
        })
        .unwrap(),
    );
    let ws_message = Message::Text(String::from(env).into());
    if let Some(owner) = owner {
        feature_senders
            .send_and_mirror(feature_id, owner, ws_message)
            .await;
        return;
    }
    for sender in feature_senders.get_senders(feature_id).await {
        let _ = sender.send(ws_message.clone());
    }
}

/// The `prompt_received` ack envelope — the signal that clears a prompt's
/// "pending" decoration on the frontend. Built here so the live ack
/// (`stream_reader_forward`) and the send-failure ack (`clear_pending_prompt_receipt`)
/// share one wire shape.
pub(super) fn prompt_received_envelope(
    message_uuid: String,
    delivery_state: PromptReceiptState,
) -> WsEnvelope {
    WsEnvelope::session_event(
        WsSessionAction::PromptReceived,
        PromptReceivedPayload {
            message_uuid,
            delivery_state,
        },
    )
    .expect("prompt received payload should serialize")
}

/// Ack a tracked prompt the agent never received because the stream send
/// failed. The backend receipt is already discarded; this only tells the
/// client to stop the spinner (the accompanying `SDK_ERROR` envelope says why).
/// Mirrored like the live ack so the original sender clears even when it is not
/// the turn owner.
pub(super) async fn clear_pending_prompt_receipt(
    feature_senders: &WsFeatureSenderRegistry,
    sender: &WsSender,
    feature_id: i64,
    message_uuid: String,
) {
    let msg = Message::Text(
        String::from(prompt_received_envelope(
            message_uuid,
            PromptReceiptState::DeliveryFailed,
        ))
        .into(),
    );
    feature_senders
        .send_and_mirror(feature_id, sender, msg)
        .await;
}

pub(super) async fn mark_agent_running(
    write_pool: &sqlx::SqlitePool,
    session_status_tx: &crate::domain::session_status::SessionStatusBroadcaster,
    active_turns: &super::super::ActiveTurnRegistry,
    owner: &super::super::SdkSessions,
    db_session_id: i64,
    feature_id: i64,
) {
    // Stamp the turn start on the server and record this connection as the
    // turn's owner. The timestamp is the single source of truth the timer is
    // anchored to on every client; the owner pointer lets a remote device
    // answer a permission/question/plan against this live turn.
    let started_at_ms = super::super::active_turns::now_ms();
    active_turns
        .begin_turn(db_session_id, owner, started_at_ms)
        .await;
    WsSessionPersistence::mark_running_static(write_pool, db_session_id).await;
    session_status_tx.broadcast_running_with_start(db_session_id, feature_id, started_at_ms);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn persisted_user_message() -> PersistedUserMessage {
        PersistedUserMessage {
            id: 42,
            message_uuid: "a48cc11a-8a72-47f7-8577-d5c533d7909c".to_string(),
            content: "hello".to_string(),
            created_at: "2026-07-12 20:00:00".to_string(),
            inserted: true,
        }
    }

    #[tokio::test]
    async fn canonical_user_message_reaches_owner_with_both_identities() {
        let registry = WsFeatureSenderRegistry::new();
        let (owner, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        registry.register(7, owner.clone()).await;

        publish_user_message(
            &registry,
            Some(&owner),
            7,
            &persisted_user_message(),
            None,
            true,
        )
        .await;

        let Message::Text(raw) = receiver.try_recv().unwrap() else {
            panic!("expected text envelope");
        };
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["action"], "user_message");
        assert_eq!(json["payload"]["message_id"], 42);
        assert_eq!(
            json["payload"]["message_uuid"],
            "a48cc11a-8a72-47f7-8577-d5c533d7909c"
        );
        assert_eq!(json["payload"]["prompt_delivery_state"], "pending_agent");
    }

    #[tokio::test]
    async fn repeated_prompt_uuid_has_one_insert_and_one_dispatch_winner() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp/p')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type)
             VALUES (7, 1, 'f', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status)
             VALUES (7, 'session', 'paused') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let registry = WsFeatureSenderRegistry::new();
        let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
        registry.register(7, sender.clone()).await;
        let message_uuid = uuid::Uuid::new_v4().to_string();
        let payload = PromptSendPayload {
            session_id: session_id.to_string(),
            text: "hello".to_string(),
            profile: None,
            claude_profile: None,
            images: Vec::new(),
            attachments: Vec::new(),
            use_worktree: None,
            new_project_branch: None,
            track_prompt_receipt: true,
            message_uuid: Some(message_uuid.clone()),
            replay: false,
        };

        let first =
            persist_and_publish_prompt(&pool, &registry, &sender, 7, session_id, &payload, "hello")
                .await
                .unwrap();
        let retry =
            persist_and_publish_prompt(&pool, &registry, &sender, 7, session_id, &payload, "hello")
                .await
                .unwrap();

        assert!(first.should_dispatch());
        assert!(!retry.should_dispatch());
        assert_eq!(first.message_id(), retry.message_id());
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ? AND message_uuid = ?",
        )
        .bind(session_id)
        .bind(message_uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn legacy_prompt_without_uuid_gets_identity_from_canonical_event() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'p', '/tmp/p')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type)
             VALUES (7, 1, 'f', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let session_id: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status)
             VALUES (7, 'session', 'paused') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let registry = WsFeatureSenderRegistry::new();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        registry.register(7, sender.clone()).await;
        let payload = PromptSendPayload {
            session_id: session_id.to_string(),
            text: "legacy hello".to_string(),
            profile: None,
            claude_profile: None,
            images: Vec::new(),
            attachments: Vec::new(),
            use_worktree: None,
            new_project_branch: None,
            track_prompt_receipt: false,
            message_uuid: None,
            replay: false,
        };

        let outcome = persist_and_publish_prompt(
            &pool,
            &registry,
            &sender,
            7,
            session_id,
            &payload,
            "legacy hello",
        )
        .await
        .unwrap();

        assert!(outcome.should_dispatch());
        let Message::Text(raw) = receiver.try_recv().unwrap() else {
            panic!("expected canonical user-message event");
        };
        let event: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let event_uuid = event["payload"]["message_uuid"].as_str().unwrap();
        assert!(uuid::Uuid::parse_str(event_uuid).is_ok());
        let stored_uuid: String =
            sqlx::query_scalar("SELECT message_uuid FROM agent_messages WHERE id = ?")
                .bind(outcome.message_id().unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_uuid, event_uuid);
    }
}
