//! `branch.rewind` — roll a session's conversation **and** code back to the
//! state before a chosen user message, in place. The chosen message's text is
//! returned as a draft (NOT sent) so the user can edit and re-send.

use tracing::{info, warn};

use super::super::super::persistence::WsSessionPersistence;
use super::super::super::protocol::WsEnvelope;
use super::super::helpers::send_error;
use super::super::types::{SdkSessions, WsSender};
use super::{
    current_runtime_session_id, load_inputs, parse_payload, reply_and_broadcast, report_abort,
    stop_live_turn, truncate_context, BranchInputs,
};
use crate::app_state::AppState;
use crate::domain::checkpoints;
use crate::domain::session_status::AgentStatus;

/// Handle `session.branch.rewind`.
pub(crate) async fn handle_rewind(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let Some((payload, db_session_id)) = parse_payload(&envelope, sender) else {
        return;
    };
    let inputs = match load_inputs(&app_state.read_pool, db_session_id, payload.message_id).await {
        Ok(inputs) => inputs,
        Err(abort) => return report_abort(sender, &envelope.id, abort),
    };

    // Code rewind is available only when a pre-turn checkpoint exists. A DB
    // failure must NOT be read as "no checkpoint" — that would quietly skip the
    // code restore. Surface it instead.
    let checkpoint =
        match checkpoints::get_commit_sha(&app_state.read_pool, inputs.message_id).await {
            Ok(sha) => sha,
            Err(error) => return send_error(sender, &envelope.id, "DB_ERROR", &error.to_string()),
        };

    // Confirm gate: a checkpoint restore discards everything in the worktree
    // since the snapshot. If the worktree is dirty and the user hasn't confirmed,
    // ask first — never discard silently.
    if checkpoint.is_some() && !payload.confirm_discard && worktree_dirty(&inputs).await {
        let reply = WsEnvelope::reply(
            &envelope.id,
            "session",
            "branch.needs_confirm",
            serde_json::json!({
                "sessionId": db_session_id.to_string(),
                "messageId": inputs.message_id,
                "kind": "rewind",
                "reason": "Rewinding will discard uncommitted changes since this message.",
            }),
        );
        let _ = sender.send(axum::extract::ws::Message::Text(String::from(reply).into()));
        return;
    }

    // Stop any live turn before mutating (interrupt + close, reset to Pending).
    stop_live_turn(sdk_sessions, app_state, db_session_id).await;
    let source_runtime_session_id =
        current_runtime_session_id(&app_state.read_pool, db_session_id).await;

    // (context) Branch the provider transcript FIRST. If the provider can't
    // branch or surgery fails, abort here — none of the destructive steps (code
    // restore, message deletion, runtime-id swap) have run, so nothing is left
    // half-rewound. The live turn was already interrupted above, which is an
    // expected consequence of initiating a rewind.
    let new_runtime_session_id = match truncate_context(&inputs, source_runtime_session_id).await {
        Ok(outcome) => outcome.into_session_id(),
        Err(abort) => return report_abort(sender, &envelope.id, abort),
    };

    // (db) Drop the cut message and everything after it, then point the session
    // at the new (or unchanged) provider session — all in one transaction.
    if let Err(error) = apply_db_rewind(
        &app_state.write_pool,
        db_session_id,
        inputs.message_id,
        new_runtime_session_id.as_deref(),
    )
    .await
    {
        send_error(sender, &envelope.id, "DB_ERROR", &error.to_string());
        return;
    }

    // (code) Restore the worktree to the checkpoint. Best-effort, *after* the
    // conversation rewind (the primary effect): a restore failure is surfaced to
    // the user but never undoes the conversation rewind.
    let (code_restored, code_restore_error) =
        restore_code(&inputs, checkpoint.as_deref()).await.to_wire();

    // (draft) Restore the cut message's text into the composer (unsent). The
    // composer restores from `feature_settings.draft_prompt` (the same store
    // fork writes), so persist there for it to survive a reload; also mirror it
    // to `agent_sessions.draft_prompt` for the session-scoped readers.
    if let Err(error) = crate::domain::workflow::worktree::set_setting(
        &app_state.write_pool,
        inputs.feature_id,
        "draft_prompt",
        &inputs.message_text,
    )
    .await
    {
        warn!(db_session_id, error = %error, "failed to persist rewind draft to feature settings");
    }
    if let Err(error) = crate::domain::sessions::repository::save_draft(
        &app_state.write_pool,
        db_session_id,
        Some(&inputs.message_text),
    )
    .await
    {
        warn!(db_session_id, error = %error, "failed to persist rewind draft");
    }

    WsSessionPersistence::broadcast_session_status(
        &app_state.session_status_tx,
        db_session_id,
        inputs.feature_id,
        AgentStatus::Idle,
        None,
    );

    info!(
        db_session_id,
        message_id = inputs.message_id,
        code_restored,
        truncated = new_runtime_session_id.is_some(),
        "rewind complete"
    );

    reply_and_broadcast(
        app_state,
        sender,
        &envelope.id,
        inputs.feature_id,
        "branch.rewound",
        serde_json::json!({
            "sessionId": db_session_id.to_string(),
            "messageId": inputs.message_id,
            "draftText": inputs.message_text,
            "codeRestored": code_restored,
            "codeRestoreError": code_restore_error,
        }),
    )
    .await;
}

/// Result of attempting the worktree code restore during a rewind.
enum CodeRestoreOutcome {
    /// No pre-turn checkpoint existed for this message — nothing to restore.
    NoCheckpoint,
    /// The worktree was rolled back to the checkpoint.
    Restored,
    /// A checkpoint existed but `git restore` failed; the message is surfaced.
    Failed(String),
}

impl CodeRestoreOutcome {
    /// `(code_restored, code_restore_error)` for the WS reply: a missing
    /// checkpoint and a failed restore are distinct (the UI labels them
    /// differently) rather than both collapsing to a bare `false`.
    fn to_wire(&self) -> (bool, Option<String>) {
        match self {
            CodeRestoreOutcome::Restored => (true, None),
            CodeRestoreOutcome::NoCheckpoint => (false, None),
            CodeRestoreOutcome::Failed(reason) => (false, Some(reason.clone())),
        }
    }
}

async fn worktree_dirty(inputs: &BranchInputs) -> bool {
    match checkpoints::is_dirty(&inputs.cwd).await {
        Ok(dirty) => dirty,
        Err(error) => {
            // Couldn't probe the worktree — fail safe toward the confirm prompt
            // rather than silently discarding changes we couldn't verify.
            warn!(
                inputs.db_session_id,
                error = %error,
                "could not check worktree status; requiring confirmation before discarding"
            );
            true
        }
    }
}

/// Restore the worktree to the checkpoint. A restore failure is surfaced
/// (logged + reported) but does not abort the conversation rewind — the user
/// still gets their context rolled back.
async fn restore_code(inputs: &BranchInputs, checkpoint: Option<&str>) -> CodeRestoreOutcome {
    let Some(sha) = checkpoint else {
        return CodeRestoreOutcome::NoCheckpoint;
    };
    match checkpoints::restore(&inputs.cwd, sha).await {
        Ok(()) => CodeRestoreOutcome::Restored,
        Err(error) => {
            warn!(
                inputs.db_session_id,
                error = %error,
                "checkpoint restore failed; conversation rewound without code rollback"
            );
            CodeRestoreOutcome::Failed(error.to_string())
        }
    }
}

/// Delete the cut message and everything after it, then swap the provider
/// session id. Checkpoints are removed explicitly (the FK also cascades).
async fn apply_db_rewind(
    pool: &sqlx::SqlitePool,
    db_session_id: i64,
    message_id: i64,
    new_runtime_session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    // One transaction so a failure partway through can never leave the
    // conversation half-deleted or pointing at a stale runtime session id.
    let mut tx = pool.begin().await?;
    sqlx::query(
        "DELETE FROM turn_checkpoints WHERE message_id IN \
         (SELECT id FROM agent_messages WHERE session_id = ? AND id >= ?)",
    )
    .bind(db_session_id)
    .bind(message_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM agent_messages WHERE session_id = ? AND id >= ?")
        .bind(db_session_id)
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE agent_sessions SET runtime_session_id = ? WHERE id = ?")
        .bind(new_runtime_session_id)
        .bind(db_session_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    async fn pool_with_messages() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY, runtime_session_id TEXT);
             CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
                role TEXT, content TEXT, message_type TEXT);
             CREATE TABLE turn_checkpoints (message_id INTEGER PRIMARY KEY, commit_sha TEXT);
             INSERT INTO agent_sessions (id, runtime_session_id) VALUES (1, 'old-sid');
             INSERT INTO agent_messages (id, session_id, role, content, message_type) VALUES
                (1, 1, 'user', 'q1', 'user_message'),
                (2, 1, 'assistant', 'a1', 'text'),
                (3, 1, 'user', 'q2', 'user_message'),
                (4, 1, 'assistant', 'a2', 'text'),
                (5, 1, 'user', 'q3', 'user_message');
             INSERT INTO turn_checkpoints (message_id, commit_sha) VALUES
                (1, 'c1'), (3, 'c3'), (5, 'c5');",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[test]
    fn code_restore_outcome_distinguishes_missing_from_failed() {
        assert_eq!(CodeRestoreOutcome::Restored.to_wire(), (true, None));
        // A missing checkpoint and a failed restore both report `false` but only
        // the failure carries an error the UI can show.
        assert_eq!(CodeRestoreOutcome::NoCheckpoint.to_wire(), (false, None));
        assert_eq!(
            CodeRestoreOutcome::Failed("git boom".into()).to_wire(),
            (false, Some("git boom".to_string())),
        );
    }

    #[tokio::test]
    async fn apply_db_rewind_deletes_from_cut_and_swaps_runtime_id() {
        let pool = pool_with_messages().await;

        apply_db_rewind(&pool, 1, 3, Some("new-sid")).await.unwrap();

        let remaining: Vec<i64> = sqlx::query_scalar("SELECT id FROM agent_messages ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(remaining, vec![1, 2], "messages >= cut are deleted");

        let checkpoints: Vec<i64> =
            sqlx::query_scalar("SELECT message_id FROM turn_checkpoints ORDER BY message_id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoints,
            vec![1],
            "checkpoints for deleted messages are gone"
        );

        let sid: Option<String> =
            sqlx::query_scalar("SELECT runtime_session_id FROM agent_sessions WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sid.as_deref(), Some("new-sid"));
    }

    #[tokio::test]
    async fn apply_db_rewind_can_clear_runtime_id_for_fresh_start() {
        let pool = pool_with_messages().await;
        apply_db_rewind(&pool, 1, 1, None).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            count, 0,
            "rewinding to the first message clears the session"
        );
        let sid: Option<String> =
            sqlx::query_scalar("SELECT runtime_session_id FROM agent_sessions WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(sid.is_none(), "fresh start nulls the runtime session id");
    }
}
