//! Delivering queued prompts: one per finished turn, or on demand.

use crate::app_state::AppState;
use crate::domain::ws_session::handler::session_prompt::dispatch_control_prompt;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::error::AppError;

use super::store::{self, QueuedPrompt};

/// Deliver the oldest pending prompt right after a turn finished; true when
/// one was sent. The caller (the stream reader's post-result hook) has already
/// checked that no permission or question waits on the user; the finished
/// turn's owner is still registered at that point, which is what routes the
/// prompt into it. A failed delivery is recorded on the prompt's row, which
/// the queue shows; only the log can carry a failure to read the queue.
pub async fn drain_next_after_turn(state: &AppState, session_id: i64) -> bool {
    match deliver_oldest(state, session_id).await {
        Ok(delivered) => delivered,
        Err(error) => {
            tracing::error!(session_id, %error, "failed to deliver queued user prompt");
            false
        }
    }
}

/// Deliver the oldest pending prompt if the session is free to take it: no
/// turn in flight and no permission or question waiting on the user. Called
/// right after an enqueue, so a prompt queued just as the turn ended is not
/// stranded until the next one.
pub async fn drain_next_if_idle(state: &AppState, session_id: i64) -> Result<bool, AppError> {
    if !session_is_idle(state, session_id).await {
        return Ok(false);
    }
    deliver_oldest(state, session_id).await
}

async fn deliver_oldest(state: &AppState, session_id: i64) -> Result<bool, AppError> {
    // Every finished turn lands here; an empty queue must not cost a write.
    if !store::has_pending(&state.read_pool, session_id).await? {
        return Ok(false);
    }
    let Some(prompt) = store::claim(&state.write_pool, session_id, None).await? else {
        return Ok(false);
    };
    deliver(state, prompt).await?;
    Ok(true)
}

/// Send one queued prompt now. While the agent works this steers the running
/// turn exactly like typing it and pressing Enter; otherwise it starts a turn.
pub async fn send_now(state: &AppState, session_id: i64, id: i64) -> Result<(), AppError> {
    let prompt = store::claim(&state.write_pool, session_id, Some(id))
        .await?
        .ok_or_else(store::not_editable)?;
    deliver(state, prompt).await
}

async fn session_is_idle(state: &AppState, session_id: i64) -> bool {
    if state
        .active_turns
        .owner_sessions(session_id)
        .await
        .is_some()
    {
        return false;
    }
    WsSessionPersistence::get_session_row(&state.read_pool, session_id)
        .await
        .is_some_and(|row| !row.has_pending_user_input())
}

async fn deliver(state: &AppState, prompt: QueuedPrompt) -> Result<(), AppError> {
    let result = deliver_claimed(state, &prompt).await;
    match &result {
        Ok(()) => store::mark_delivered(&state.write_pool, prompt.id).await?,
        Err(error) => store::mark_error(&state.write_pool, prompt.id, &error.to_string()).await?,
    }
    super::notify_changed(state, prompt.session_id);
    result
}

async fn deliver_claimed(state: &AppState, prompt: &QueuedPrompt) -> Result<(), AppError> {
    let feature_id: i64 = sqlx::query_scalar("SELECT feature_id FROM agent_sessions WHERE id = ?")
        .bind(prompt.session_id)
        .fetch_optional(&state.read_pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Session not found".to_string()))?;
    // `replay = false`: persisted and mirrored to every client as the user's
    // own message, like a scheduled prompt.
    dispatch_control_prompt(state, feature_id, prompt.session_id, &prompt.content, false).await
}
