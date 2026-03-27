//! Database persistence for WebSocket sessions.
//!
//! Mirrors the logic in `SessionPersistence.ts` (Effect service) but implemented
//! in Rust using sqlx. All writes are best-effort — errors are logged but never
//! propagate to the caller so the WebSocket stream is not interrupted.

use std::collections::HashMap;
use sqlx::SqlitePool;
use tracing::{debug, error};

use claude_agent_sdk_rs::{AssistantMessageBody, SdkMessage, ContentBlock, ContentDelta, StreamEventData};

const INSERT_MESSAGE_SQL: &str =
    "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

/// A row from the `agent_sessions` table with the fields needed by the WS handler.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SessionRow {
    pub id: i64,
    pub feature_id: i64,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub claude_session_id: Option<String>,
    pub status: String,
    pub pending_plan_approval: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub context_window: Option<i64>,
}

pub struct WsSessionPersistence {
    write_pool: SqlitePool,
    session_db_id: Option<i64>,
    feature_id: i64,
    current_model: Option<String>,
    /// block_index -> partial JSON being accumulated
    pending_tool_inputs: HashMap<u32, String>,
    /// block_index -> agent_messages.id for the tool_call row
    pending_tool_row_ids: HashMap<u32, i64>,
    file_change_marked: bool,
}

impl WsSessionPersistence {
    pub fn new(write_pool: SqlitePool, feature_id: i64) -> Self {
        Self::with_session_id(write_pool, feature_id, None)
    }

    /// Create a persistence instance with an already-known session DB id,
    /// avoiding the need to call `find_or_create_session` just to set it.
    pub fn with_session_id(write_pool: SqlitePool, feature_id: i64, session_db_id: Option<i64>) -> Self {
        Self {
            write_pool,
            session_db_id,
            feature_id,
            current_model: None,
            pending_tool_inputs: HashMap::new(),
            pending_tool_row_ids: HashMap::new(),
            file_change_marked: false,
        }
    }

    /// Ensure an agent_sessions row exists for this feature.
    /// Reuses an existing row if one is found, otherwise creates a new one.
    /// This keeps all messages for a feature in a single session across app restarts.
    pub async fn find_or_create_session(&mut self, model: Option<&str>, permission_mode: Option<&str>) -> Option<i64> {
        // Try to reuse the most recent session for this feature
        let existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM agent_sessions WHERE feature_id = ? AND agent_type = 'session' ORDER BY id DESC LIMIT 1"
        )
        .bind(self.feature_id)
        .fetch_optional(&self.write_pool)
        .await
        .ok()?;

        if let Some((id,)) = existing {
            // Reuse existing session — update status back to running
            if let Err(e) = sqlx::query(
                "UPDATE agent_sessions SET status = 'paused', permission_mode = COALESCE(?, permission_mode) WHERE id = ?"
            )
            .bind(permission_mode)
            .bind(id)
            .execute(&self.write_pool)
            .await
            {
                error!(error = %e, session_db_id = id, "failed to update existing agent_sessions row");
            }

            self.session_db_id = Some(id);
            debug!(session_db_id = id, feature_id = self.feature_id, "reusing existing agent_sessions row");
            return Some(id);
        }

        // No existing session — create a new one
        let now = chrono::Utc::now().to_rfc3339();
        let result = sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, model, permission_mode, started_at) VALUES (?, 'session', 'paused', ?, ?, ?)"
        )
        .bind(self.feature_id)
        .bind(model)
        .bind(permission_mode)
        .bind(&now)
        .execute(&self.write_pool)
        .await;

        match result {
            Ok(r) => {
                let id = r.last_insert_rowid();
                self.session_db_id = Some(id);
                debug!(session_db_id = id, feature_id = self.feature_id, "created agent_sessions row");
                Some(id)
            }
            Err(e) => {
                error!(error = %e, "failed to create agent_sessions row");
                None
            }
        }
    }

    /// Persist a user message.
    pub async fn persist_user_message(&self, text: &str) {
        let Some(session_id) = self.session_db_id else { return };
        if let Err(e) = Self::insert_message(&self.write_pool, session_id, "user", text, "user_message", None, None, None, None).await {
            error!(error = %e, "failed to persist user message");
        }
    }

    /// Main dispatch for SDK messages — mirrors SessionPersistence.persistStreamEvent.
    pub async fn persist_sdk_message(&mut self, sdk_msg: &SdkMessage) {
        let Some(session_id) = self.session_db_id else { return };

        match sdk_msg {
            SdkMessage::StreamEvent { event, parent_tool_use_id, .. } => {
                let ptuid = parent_tool_use_id.as_deref();
                self.persist_stream_event(session_id, event, ptuid).await;
            }
            SdkMessage::User { message, parent_tool_use_id, .. } => {
                // Extract tool_result items from user messages
                self.persist_user_tool_results(session_id, message, parent_tool_use_id.as_deref()).await;
            }
            SdkMessage::Assistant { message, parent_tool_use_id, .. } => {
                if let Some(ptuid) = parent_tool_use_id.as_deref() {
                    self.persist_assistant_subagent(session_id, message, ptuid).await;
                }
            }
            SdkMessage::System(sys_msg) => {
                use claude_agent_sdk_rs::SystemMessage;
                match sys_msg {
                    SystemMessage::CompactBoundary { .. } => {
                        let _ = Self::insert_message(&self.write_pool, session_id, "system", "compact_boundary", "compact_divider", None, None, None, None).await;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// Insert a single row into agent_messages.
    async fn insert_message(
        pool: &SqlitePool, session_id: i64, role: &str, content: &str,
        message_type: &str, tool_name: Option<&str>, tool_use_id: Option<&str>,
        ptuid: Option<&str>, model: Option<&str>,
    ) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
        sqlx::query(INSERT_MESSAGE_SQL)
            .bind(session_id).bind(role).bind(content)
            .bind(message_type).bind(tool_name).bind(tool_use_id)
            .bind(ptuid).bind(model)
            .execute(pool).await
    }

    async fn persist_stream_event(&mut self, session_id: i64, event: &StreamEventData, ptuid: Option<&str>) {
        let model = self.current_model.as_deref();

        match event {
            StreamEventData::MessageStart { message } => {
                self.current_model = Some(message.model.clone());
            }
            StreamEventData::ContentBlockStart { index, content_block } => {
                match content_block {
                    ContentBlock::Text { text } => {
                        let _ = Self::insert_message(&self.write_pool, session_id, "assistant", text, "text", None, None, ptuid, model).await;
                    }
                    ContentBlock::Thinking { thinking, .. } => {
                        let _ = Self::insert_message(&self.write_pool, session_id, "assistant", thinking, "thinking", None, None, ptuid, model).await;
                    }
                    ContentBlock::ToolUse { id, name, input } => {
                        let content = serde_json::to_string(input).unwrap_or_default();
                        let result = Self::insert_message(&self.write_pool, session_id, "assistant", &content, "tool_call", Some(name), Some(id), ptuid, model).await;

                        if let Ok(r) = result {
                            let row_id = r.last_insert_rowid();
                            self.pending_tool_row_ids.insert(*index, row_id);
                            self.pending_tool_inputs.insert(*index, String::new());
                        }

                        // Track file-modifying tools
                        if !self.file_change_marked && (name == "Write" || name == "Edit" || name == "NotebookEdit") {
                            self.mark_has_file_changes(session_id).await;
                        }
                    }
                    _ => {}
                }
            }
            StreamEventData::ContentBlockDelta { index, delta } => {
                match delta {
                    ContentDelta::TextDelta { text } => {
                        let _ = Self::insert_message(&self.write_pool, session_id, "assistant", text, "text_delta", None, None, ptuid, model).await;
                    }
                    ContentDelta::ThinkingDelta { thinking } => {
                        let _ = Self::insert_message(&self.write_pool, session_id, "assistant", thinking, "thinking_delta", None, None, ptuid, model).await;
                    }
                    ContentDelta::InputJsonDelta { partial_json } => {
                        if let Some(accumulated) = self.pending_tool_inputs.get_mut(index) {
                            accumulated.push_str(partial_json);
                            // Try to parse; if valid, update the row
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(accumulated) {
                                if let Some(&row_id) = self.pending_tool_row_ids.get(index) {
                                    let content = serde_json::to_string(&parsed).unwrap_or_default();
                                    let _ = sqlx::query("UPDATE agent_messages SET content = ? WHERE id = ?")
                                        .bind(&content)
                                        .bind(row_id)
                                        .execute(&self.write_pool).await;
                                }
                            }
                        }
                    }
                }
            }
            StreamEventData::ContentBlockStop { index } => {
                // Finalize any pending tool input
                if let Some(accumulated) = self.pending_tool_inputs.remove(index) {
                    if !accumulated.is_empty() {
                        if let Some(&row_id) = self.pending_tool_row_ids.get(index) {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&accumulated) {
                                let content = serde_json::to_string(&parsed).unwrap_or_default();
                                let _ = sqlx::query("UPDATE agent_messages SET content = ? WHERE id = ?")
                                    .bind(&content)
                                    .bind(row_id)
                                    .execute(&self.write_pool).await;
                            }
                        }
                    }
                }
                self.pending_tool_row_ids.remove(index);
            }
            _ => {} // message_delta, message_stop — skip
        }
    }

    /// Extract tool_result entries from a User message's content array and persist them.
    async fn persist_user_tool_results(&self, session_id: i64, message: &serde_json::Value, ptuid: Option<&str>) {
        let content_arr = match message.get("content").and_then(|c| c.as_array()) {
            Some(arr) => arr,
            None => return,
        };

        for item in content_arr {
            let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if item_type != "tool_result" { continue; }

            let tool_use_id = item.get("tool_use_id").and_then(|v| v.as_str());
            let is_error = item.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
            let content = match item.get("content") {
                Some(c) if c.is_string() => c.as_str().unwrap_or("").to_string(),
                Some(c) => serde_json::to_string(c).unwrap_or_default(),
                None => String::new(),
            };
            let msg_type = if is_error { "tool_error" } else { "tool_result" };

            let _ = Self::insert_message(&self.write_pool, session_id, "tool", &content, msg_type, None, tool_use_id, ptuid, None).await;
        }
    }

    async fn mark_has_file_changes(&mut self, session_id: i64) {
        self.file_change_marked = true;
        let _ = sqlx::query("UPDATE agent_sessions SET has_file_changes = 1 WHERE id = ?")
            .bind(session_id)
            .execute(&self.write_pool)
            .await;
    }

    /// Persist sub-agent content from an `assistant` message.
    ///
    /// Stream events for sub-agent tool_calls lack `parent_tool_use_id`, so we
    /// UPDATE existing rows to add the parent link. Text/thinking are inserted fresh.
    async fn persist_assistant_subagent(&self, session_id: i64, message: &AssistantMessageBody, ptuid: &str) {
        let model = Some(message.model.as_str());
        for cb in &message.content {
            match cb {
                ContentBlock::ToolUse { id, name, input } => {
                    let content = serde_json::to_string(input).unwrap_or_default();
                    let result = sqlx::query(
                        "UPDATE agent_messages SET parent_tool_use_id = ?, content = ? \
                         WHERE session_id = ? AND tool_use_id = ? AND message_type = 'tool_call' \
                         AND parent_tool_use_id IS NULL"
                    )
                        .bind(ptuid).bind(&content)
                        .bind(session_id).bind(id)
                        .execute(&self.write_pool).await;

                    match result {
                        Ok(r) if r.rows_affected() == 0 => {
                            let _ = Self::insert_message(&self.write_pool, session_id, "assistant", &content, "tool_call", Some(name), Some(id), Some(ptuid), model).await;
                        }
                        Err(e) => {
                            error!(error = %e, session_id, tool_use_id = %id, "failed to update sub-agent tool_call parent");
                        }
                        _ => {}
                    }
                }
                ContentBlock::Text { text } => {
                    let _ = Self::insert_message(&self.write_pool, session_id, "assistant", text, "text", None, None, Some(ptuid), model).await;
                }
                ContentBlock::Thinking { thinking, .. } => {
                    let _ = Self::insert_message(&self.write_pool, session_id, "assistant", thinking, "thinking", None, None, Some(ptuid), model).await;
                }
                _ => {}
            }
        }
    }

    /// Read a session row from the DB by its primary key.
    pub async fn get_session_row(pool: &SqlitePool, session_id: i64) -> Option<SessionRow> {
        let row: Option<(i64, i64, Option<String>, Option<String>, Option<String>, String, Option<String>, Option<i64>, Option<i64>, Option<i64>)> =
            sqlx::query_as(
                "SELECT id, feature_id, model, permission_mode, claude_session_id, status, pending_plan_approval, input_tokens, output_tokens, context_window FROM agent_sessions WHERE id = ?"
            )
            .bind(session_id)
            .fetch_optional(pool)
            .await
            .ok()?;
        row.map(|(id, feature_id, model, permission_mode, claude_session_id, status, pending_plan_approval, input_tokens, output_tokens, context_window)| SessionRow {
            id,
            feature_id,
            model,
            permission_mode,
            claude_session_id,
            status,
            pending_plan_approval,
            input_tokens,
            output_tokens,
            context_window,
        })
    }

    /// Mark a session as paused with ended_at = now.
    pub async fn mark_paused_static(pool: &SqlitePool, session_id: i64) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET status = 'paused', ended_at = ? WHERE id = ?")
            .bind(&now)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session paused");
        }
    }

    /// Mark a session as running with ended_at = NULL.
    pub async fn mark_running_static(pool: &SqlitePool, session_id: i64) {
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET status = 'running', ended_at = NULL WHERE id = ?")
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session running");
        }
    }

    /// Mark a session as completed.
    pub async fn mark_completed_static(pool: &SqlitePool, session_id: i64) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET status = 'completed', ended_at = ? WHERE id = ?")
            .bind(&now)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session completed");
        }
    }

    /// Update the model on a session row.
    pub async fn update_model_static(pool: &SqlitePool, session_id: i64, model: &str) {
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(model)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to update model");
        }
    }

    /// Update the permission_mode on a session row.
    pub async fn update_permission_mode_static(pool: &SqlitePool, session_id: i64, mode: &str) {
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET permission_mode = ? WHERE id = ?")
            .bind(mode)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to update permission_mode");
        }
    }

    /// Archive the current `claude_session_id` to `session_claude_ids`, insert a
    /// `clear_divider` message, and NULL out the column. Matches tRPC `clearSession`.
    ///
    /// If `known_cli_sid` is provided, it is used directly and the DB read is skipped.
    pub async fn archive_and_clear(pool: &SqlitePool, session_id: i64, known_cli_sid: Option<&str>) {
        // Use the provided value or read from DB
        let cli_sid = match known_cli_sid {
            Some(sid) => Some(sid.to_string()),
            None => {
                sqlx::query_as::<_, (Option<String>,)>(
                    "SELECT claude_session_id FROM agent_sessions WHERE id = ?"
                )
                .bind(session_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten()
                .and_then(|(sid,)| sid)
            }
        };

        if let Some(ref cli_sid) = cli_sid {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                "INSERT INTO session_claude_ids (session_id, claude_session_id, created_at) VALUES (?, ?, ?)"
            )
            .bind(session_id)
            .bind(cli_sid)
            .bind(&now)
            .execute(pool)
            .await;
        }

        // Insert clear_divider message
        let _ = Self::insert_message(pool, session_id, "system", "clear_divider", "clear_divider", None, None, None, None).await;

        // NULL out claude_session_id
        let _ = sqlx::query("UPDATE agent_sessions SET claude_session_id = NULL WHERE id = ?")
            .bind(session_id)
            .execute(pool)
            .await;
    }

    /// Persist the claude_session_id given a pool and session_id (static version).
    pub async fn persist_claude_session_id_static(pool: &SqlitePool, session_id: i64, claude_session_id: &str) {
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?")
            .bind(claude_session_id)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, "failed to persist claude_session_id (static)");
        }
    }

    /// Update token usage counters on a session row (best-effort).
    pub async fn update_token_usage(pool: &SqlitePool, session_id: i64, input_tokens: u64, output_tokens: u64) {
        let _ = sqlx::query("UPDATE agent_sessions SET input_tokens = ?, output_tokens = ? WHERE id = ?")
            .bind(input_tokens as i64)
            .bind(output_tokens as i64)
            .bind(session_id)
            .execute(pool)
            .await;
    }

    /// Update the context window size for a session (best-effort).
    pub async fn update_context_window(pool: &SqlitePool, session_id: i64, context_window: u64) {
        let _ = sqlx::query("UPDATE agent_sessions SET context_window = ? WHERE id = ?")
            .bind(context_window as i64)
            .bind(session_id)
            .execute(pool)
            .await;
    }

    /// Broadcast a turn-state change for a feature to all connected clients.
    ///
    /// Turn state is determined at the call site (not queried from DB) because
    /// the Rust WS handlers track pending state in-memory, not in the DB.
    /// Valid values: "claude", "askUser", "none".
    pub fn broadcast_turn_state(
        tx: &tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
        feature_id: i64,
        turn: &str,
    ) {
        let _ = tx.send(crate::app_state::TurnStateEvent {
            feature_id,
            turn: turn.to_string(),
        });
    }

    /// Hard-delete a session and all its messages from the database.
    ///
    /// Returns `Ok(feature_id)` on success (for turn-state broadcast),
    /// or `Err(reason)` if the session doesn't exist or is still running.
    pub async fn delete_session_static(pool: &SqlitePool, session_id: i64) -> Result<(i64, Option<String>), String> {
        // Look up feature_id, status, and agent_type
        let row: Option<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT feature_id, status, agent_type FROM agent_sessions WHERE id = ?",
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

        let (feature_id, status, agent_type) = match row {
            Some(r) => r,
            None => return Err("session not found".to_string()),
        };

        if status == "running" {
            return Err("cannot delete a running session".to_string());
        }

        // Delete in dependency order
        let _ = sqlx::query("UPDATE workflow_queue SET agent_session_id = NULL WHERE agent_session_id = ?")
            .bind(session_id).execute(pool).await;
        let _ = sqlx::query("DELETE FROM session_claude_ids WHERE session_id = ?")
            .bind(session_id).execute(pool).await;
        let _ = sqlx::query("DELETE FROM agent_messages WHERE session_id = ?")
            .bind(session_id).execute(pool).await;
        let _ = sqlx::query("DELETE FROM agent_sessions WHERE id = ?")
            .bind(session_id).execute(pool).await;

        Ok((feature_id, agent_type))
    }

    /// Mark all running sessions as paused on startup (stale session cleanup).
    pub async fn cleanup_stale_sessions(pool: &SqlitePool) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) = sqlx::query(
            "UPDATE agent_sessions SET status = 'paused', ended_at = ? WHERE status = 'running'"
        )
        .bind(&now)
        .execute(pool)
        .await
        {
            error!(error = %e, "failed to clean up stale sessions on startup");
        }
    }

    /// Store the Claude CLI session ID so future app restarts can --resume.
    #[allow(dead_code)]
    pub async fn persist_claude_session_id(&self, claude_session_id: &str) {
        let Some(session_id) = self.session_db_id else { return };
        Self::persist_claude_session_id_static(&self.write_pool, session_id, claude_session_id).await;
    }

    #[allow(dead_code)]
    pub async fn mark_completed(&self) {
        let Some(session_id) = self.session_db_id else { return };
        Self::mark_completed_static(&self.write_pool, session_id).await;
    }

    /// Look up the most recent claude_session_id for a feature across both
    /// `agent_sessions` and the `session_claude_ids` archive table.
    /// (The Electron stop-session flow NULLs claude_session_id and archives it
    /// to session_claude_ids, so we check both sources in a single query.)
    #[allow(dead_code)]
    pub async fn get_latest_claude_session_id(pool: &SqlitePool, feature_id: i64) -> Option<String> {
        let row: Option<(String,)> = sqlx::query_as(
            r#"SELECT claude_session_id FROM (
                SELECT claude_session_id, id AS sort_key FROM agent_sessions
                    WHERE feature_id = ? AND claude_session_id IS NOT NULL
                UNION ALL
                SELECT sci.claude_session_id, sci.id AS sort_key FROM session_claude_ids sci
                    JOIN agent_sessions s ON sci.session_id = s.id
                    WHERE s.feature_id = ?
            ) ORDER BY sort_key DESC LIMIT 1"#
        )
        .bind(feature_id)
        .bind(feature_id)
        .fetch_optional(pool)
        .await
        .ok()?;

        row.map(|(sid,)| sid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            r#"CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL DEFAULT 'session',
                status TEXT NOT NULL DEFAULT 'idle',
                claude_session_id TEXT,
                model TEXT,
                permission_mode TEXT,
                has_file_changes INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                context_window INTEGER NOT NULL DEFAULT 200000,
                started_at TEXT,
                ended_at TEXT,
                pending_plan_approval TEXT,
                plan_approval_result TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT,
                content TEXT NOT NULL DEFAULT '',
                message_type TEXT NOT NULL DEFAULT 'text',
                tool_name TEXT,
                tool_use_id TEXT,
                parent_tool_use_id TEXT,
                model TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE session_claude_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                claude_session_id TEXT NOT NULL,
                created_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_find_or_create_session_creates_new() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);

        let id = p.find_or_create_session(Some("opus"), Some("plan")).await;
        assert!(id.is_some());
        assert_eq!(p.session_db_id, id);

        // Verify row exists
        let row: (String, String, String) = sqlx::query_as(
            "SELECT status, model, permission_mode FROM agent_sessions WHERE id = ?",
        )
        .bind(id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "paused");
        assert_eq!(row.1, "opus");
        assert_eq!(row.2, "plan");
    }

    #[tokio::test]
    async fn test_find_or_create_session_reuses_existing() {
        let pool = setup_test_db().await;

        // Create initial session
        let mut p1 = WsSessionPersistence::new(pool.clone(), 1);
        let id1 = p1.find_or_create_session(Some("sonnet"), None).await.unwrap();

        // Second call with same feature_id should reuse
        let mut p2 = WsSessionPersistence::new(pool.clone(), 1);
        let id2 = p2.find_or_create_session(Some("opus"), Some("plan")).await.unwrap();

        assert_eq!(id1, id2);

        // Model should NOT be overwritten — preserves the original "sonnet"
        let row: (String, String) = sqlx::query_as(
            "SELECT model, permission_mode FROM agent_sessions WHERE id = ?",
        )
        .bind(id2)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "sonnet");
        assert_eq!(row.1, "plan");
    }

    #[tokio::test]
    async fn test_find_or_create_session_different_features_get_separate_rows() {
        let pool = setup_test_db().await;

        let mut p1 = WsSessionPersistence::new(pool.clone(), 1);
        let id1 = p1.find_or_create_session(None, None).await.unwrap();

        let mut p2 = WsSessionPersistence::new(pool.clone(), 2);
        let id2 = p2.find_or_create_session(None, None).await.unwrap();

        assert_ne!(id1, id2);
    }

    #[tokio::test]
    async fn test_persist_and_get_claude_session_id() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        p.find_or_create_session(None, None).await;

        p.persist_claude_session_id("cli-sess-abc").await;

        let found = WsSessionPersistence::get_latest_claude_session_id(&pool, 1).await;
        assert_eq!(found, Some("cli-sess-abc".to_string()));
    }

    #[tokio::test]
    async fn test_get_latest_claude_session_id_returns_none_when_missing() {
        let pool = setup_test_db().await;
        let found = WsSessionPersistence::get_latest_claude_session_id(&pool, 999).await;
        assert_eq!(found, None);
    }

    #[tokio::test]
    async fn test_get_latest_claude_session_id_falls_back_to_archive() {
        let pool = setup_test_db().await;

        // Create a session with NULL claude_session_id (simulating post-stop state)
        let session_id: (i64,) = sqlx::query_as(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'session', 'completed') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Archive the session ID (as the Electron stop flow does)
        sqlx::query(
            "INSERT INTO session_claude_ids (session_id, claude_session_id) VALUES (?, ?)",
        )
        .bind(session_id.0)
        .bind("archived-cli-sess")
        .execute(&pool)
        .await
        .unwrap();

        let found = WsSessionPersistence::get_latest_claude_session_id(&pool, 1).await;
        assert_eq!(found, Some("archived-cli-sess".to_string()));
    }

    #[tokio::test]
    async fn test_persist_user_message_uses_user_message_type() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        p.find_or_create_session(None, None).await;

        p.persist_user_message("Hello world").await;

        let row: (String, String, String) = sqlx::query_as(
            "SELECT role, content, message_type FROM agent_messages WHERE session_id = ?",
        )
        .bind(p.session_db_id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "user");
        assert_eq!(row.1, "Hello world");
        assert_eq!(row.2, "user_message");
    }

    #[tokio::test]
    async fn test_get_session_row() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 42);
        let id = p.find_or_create_session(Some("opus"), Some("plan")).await.unwrap();

        let row = WsSessionPersistence::get_session_row(&pool, id).await.unwrap();
        assert_eq!(row.id, id);
        assert_eq!(row.feature_id, 42);
        assert_eq!(row.model.as_deref(), Some("opus"));
        assert_eq!(row.permission_mode.as_deref(), Some("plan"));
        assert_eq!(row.status, "paused");
    }

    #[tokio::test]
    async fn test_get_session_row_missing() {
        let pool = setup_test_db().await;
        assert!(WsSessionPersistence::get_session_row(&pool, 999).await.is_none());
    }

    #[tokio::test]
    async fn test_mark_paused_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::mark_paused_static(&pool, id).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "paused");
    }

    #[tokio::test]
    async fn test_mark_running_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::mark_paused_static(&pool, id).await;
        WsSessionPersistence::mark_running_static(&pool, id).await;

        let row: (String, Option<String>) = sqlx::query_as("SELECT status, ended_at FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "running");
        assert!(row.1.is_none());
    }

    #[tokio::test]
    async fn test_update_model_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(Some("sonnet"), None).await.unwrap();

        WsSessionPersistence::update_model_static(&pool, id, "opus").await;

        let row: (String,) = sqlx::query_as("SELECT model FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "opus");
    }

    #[tokio::test]
    async fn test_update_permission_mode_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, Some("plan")).await.unwrap();

        WsSessionPersistence::update_permission_mode_static(&pool, id, "acceptEdits").await;

        let row: (String,) = sqlx::query_as("SELECT permission_mode FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "acceptEdits");
    }

    #[tokio::test]
    async fn test_archive_and_clear() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        // Set a claude_session_id
        WsSessionPersistence::persist_claude_session_id_static(&pool, id, "cli-sess-123").await;

        // Archive and clear
        WsSessionPersistence::archive_and_clear(&pool, id, None).await;

        // claude_session_id should be NULL
        let row: (Option<String>,) = sqlx::query_as("SELECT claude_session_id FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.0.is_none());

        // Should be archived in session_claude_ids
        let archived: (String,) = sqlx::query_as("SELECT claude_session_id FROM session_claude_ids WHERE session_id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(archived.0, "cli-sess-123");

        // Should have a clear_divider message
        let msg: (String, String) = sqlx::query_as(
            "SELECT role, message_type FROM agent_messages WHERE session_id = ? AND message_type = 'clear_divider'"
        )
        .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(msg.0, "system");
        assert_eq!(msg.1, "clear_divider");
    }

    #[tokio::test]
    async fn test_cleanup_stale_sessions() {
        let pool = setup_test_db().await;

        // Create two sessions — one marked running (simulating active work), one paused
        let mut p1 = WsSessionPersistence::new(pool.clone(), 1);
        let id1 = p1.find_or_create_session(None, None).await.unwrap(); // status = paused
        WsSessionPersistence::mark_running_static(&pool, id1).await; // simulate active SDK query

        let mut p2 = WsSessionPersistence::new(pool.clone(), 2);
        p2.find_or_create_session(None, None).await; // status = paused

        WsSessionPersistence::cleanup_stale_sessions(&pool).await;

        // Both should now be paused (running one got cleaned up)
        let rows: Vec<(String,)> = sqlx::query_as("SELECT status FROM agent_sessions ORDER BY id")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(rows[0].0, "paused");
        assert_eq!(rows[1].0, "paused");
    }

    #[tokio::test]
    async fn test_with_session_id_persists_user_message_without_find_or_create() {
        let pool = setup_test_db().await;

        // Manually create a session row
        let id: (i64,) = sqlx::query_as(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'session', 'running') RETURNING id"
        ).fetch_one(&pool).await.unwrap();

        // Use with_session_id to skip find_or_create
        let p = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(id.0));
        p.persist_user_message("hello from with_session_id").await;

        let row: (String,) = sqlx::query_as(
            "SELECT content FROM agent_messages WHERE session_id = ?"
        ).bind(id.0).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "hello from with_session_id");
    }

    #[tokio::test]
    async fn test_archive_and_clear_with_known_cli_sid_skips_db_read() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        // Don't persist cli_sid to DB — pass it directly as known_cli_sid
        WsSessionPersistence::archive_and_clear(&pool, id, Some("directly-passed-sid")).await;

        // Should be archived even though it was never on the row
        let archived: (String,) = sqlx::query_as(
            "SELECT claude_session_id FROM session_claude_ids WHERE session_id = ?"
        ).bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(archived.0, "directly-passed-sid");

        // Row's claude_session_id should be NULL
        let row: (Option<String>,) = sqlx::query_as(
            "SELECT claude_session_id FROM agent_sessions WHERE id = ?"
        ).bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.0.is_none());
    }

    #[tokio::test]
    async fn test_persist_claude_session_id_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::persist_claude_session_id_static(&pool, id, "static-sid-123").await;

        let row: (Option<String>,) = sqlx::query_as(
            "SELECT claude_session_id FROM agent_sessions WHERE id = ?"
        ).bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0.as_deref(), Some("static-sid-123"));
    }

    #[tokio::test]
    async fn test_resume_flow_persist_restart_resume() {
        let pool = setup_test_db().await;

        // Step 1: Create session and persist a claude_session_id (simulates stream_reader capture)
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(Some("sonnet"), None).await.unwrap();
        WsSessionPersistence::persist_claude_session_id_static(&pool, id, "cli-sess-resume-test").await;

        // Step 2: Simulate app crash — session is still 'running'
        // On restart, cleanup_stale_sessions marks it paused
        WsSessionPersistence::cleanup_stale_sessions(&pool).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "paused");

        // Step 3: On reconnect, find_or_create reuses the session
        let mut p2 = WsSessionPersistence::new(pool.clone(), 1);
        let id2 = p2.find_or_create_session(Some("opus"), None).await.unwrap();
        assert_eq!(id, id2, "should reuse the same session row");

        // Step 4: get_latest_claude_session_id should find the persisted ID
        let found = WsSessionPersistence::get_latest_claude_session_id(&pool, 1).await;
        assert_eq!(found, Some("cli-sess-resume-test".to_string()));
    }

    #[tokio::test]
    async fn test_resume_after_clear_uses_archived_id() {
        let pool = setup_test_db().await;

        // Create session, persist claude_session_id
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();
        WsSessionPersistence::persist_claude_session_id_static(&pool, id, "pre-clear-sid").await;

        // Clear the session (archives the ID)
        WsSessionPersistence::archive_and_clear(&pool, id, None).await;

        // claude_session_id is now NULL on the row
        let row: (Option<String>,) = sqlx::query_as("SELECT claude_session_id FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.0.is_none());

        // But get_latest_claude_session_id should still find it via the archive table
        let found = WsSessionPersistence::get_latest_claude_session_id(&pool, 1).await;
        assert_eq!(found, Some("pre-clear-sid".to_string()));
    }

    #[tokio::test]
    async fn test_mark_completed_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::mark_completed_static(&pool, id).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "completed");
    }

    #[tokio::test]
    async fn test_update_token_usage() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::update_token_usage(&pool, id, 1500, 300).await;

        let row: (i64, i64) = sqlx::query_as(
            "SELECT input_tokens, output_tokens FROM agent_sessions WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, 1500);
        assert_eq!(row.1, 300);
    }

    #[tokio::test]
    async fn test_mark_completed_instance_delegates_to_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        p.find_or_create_session(None, None).await;

        p.mark_completed().await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(p.session_db_id.unwrap()).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "completed");
    }

    #[tokio::test]
    async fn test_delete_session_removes_all_rows() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();
        p.persist_user_message("hello").await;
        WsSessionPersistence::mark_paused_static(&pool, id).await;

        let result = WsSessionPersistence::delete_session_static(&pool, id).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().0, 1); // feature_id

        // Verify all rows are gone
        let session: Option<(i64,)> = sqlx::query_as("SELECT id FROM agent_sessions WHERE id = ?")
            .bind(id).fetch_optional(&pool).await.unwrap();
        assert!(session.is_none());

        let msgs: Vec<(i64,)> = sqlx::query_as("SELECT id FROM agent_messages WHERE session_id = ?")
            .bind(id).fetch_all(&pool).await.unwrap();
        assert!(msgs.is_empty());
    }

    #[tokio::test]
    async fn test_delete_session_rejects_running() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();
        // Simulate an active session by marking it running
        WsSessionPersistence::mark_running_static(&pool, id).await;

        let result = WsSessionPersistence::delete_session_static(&pool, id).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("running"));
    }

    #[tokio::test]
    async fn test_delete_session_not_found() {
        let pool = setup_test_db().await;
        let result = WsSessionPersistence::delete_session_static(&pool, 999).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn test_delete_session_returns_agent_type() {
        let pool = setup_test_db().await;
        // Insert a plan-type session directly
        sqlx::query("INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (1, 'plan', 'paused')")
            .execute(&pool).await.unwrap();
        let id: (i64,) = sqlx::query_as("SELECT id FROM agent_sessions WHERE feature_id = 1 AND agent_type = 'plan'")
            .fetch_one(&pool).await.unwrap();

        let result = WsSessionPersistence::delete_session_static(&pool, id.0).await;
        assert!(result.is_ok());
        let (feature_id, agent_type) = result.unwrap();
        assert_eq!(feature_id, 1);
        assert_eq!(agent_type.as_deref(), Some("plan"));
    }

    #[tokio::test]
    async fn test_broadcast_turn_state_sends_event() {
        let (tx, mut rx) = tokio::sync::broadcast::channel(16);
        WsSessionPersistence::broadcast_turn_state(&tx, 42, "askUser");

        let event = rx.recv().await.unwrap();
        assert_eq!(event.feature_id, 42);
        assert_eq!(event.turn, "askUser");
    }

    #[tokio::test]
    async fn test_broadcast_turn_state_none() {
        let (tx, mut rx) = tokio::sync::broadcast::channel(16);
        WsSessionPersistence::broadcast_turn_state(&tx, 7, "none");

        let event = rx.recv().await.unwrap();
        assert_eq!(event.feature_id, 7);
        assert_eq!(event.turn, "none");
    }

    #[tokio::test]
    async fn test_broadcast_turn_state_no_receivers_does_not_panic() {
        let (tx, _) = tokio::sync::broadcast::channel(16);
        // Should not panic even with no active receivers
        WsSessionPersistence::broadcast_turn_state(&tx, 1, "claude");
    }

    #[tokio::test]
    async fn test_get_session_row_includes_pending_plan_approval() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 10);
        let id = p.find_or_create_session(Some("opus"), Some("plan")).await.unwrap();

        // Initially null
        let row = WsSessionPersistence::get_session_row(&pool, id).await.unwrap();
        assert!(row.pending_plan_approval.is_none());

        // Set pending_plan_approval
        sqlx::query("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
            .bind(r#"{"plan":"test"}"#)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let row = WsSessionPersistence::get_session_row(&pool, id).await.unwrap();
        assert_eq!(row.pending_plan_approval.as_deref(), Some(r#"{"plan":"test"}"#));
    }

    #[tokio::test]
    async fn test_plan_approval_result_roundtrip() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 10);
        let id = p.find_or_create_session(Some("opus"), Some("plan")).await.unwrap();

        // Set pending_plan_approval and plan_approval_result
        sqlx::query("UPDATE agent_sessions SET pending_plan_approval = ?, plan_approval_result = ? WHERE id = ?")
            .bind(r#"{"plan":"test"}"#)
            .bind(r#"{"approved":true}"#)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        // Clear both
        sqlx::query("UPDATE agent_sessions SET pending_plan_approval = NULL, plan_approval_result = NULL WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let row = WsSessionPersistence::get_session_row(&pool, id).await.unwrap();
        assert!(row.pending_plan_approval.is_none());
    }

    #[tokio::test]
    async fn test_enter_plan_mode_persists_permission_mode() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 10);
        let id = p.find_or_create_session(Some("opus"), Some("acceptEdits")).await.unwrap();

        // Simulate EnterPlanMode updating the permission_mode
        sqlx::query("UPDATE agent_sessions SET permission_mode = 'plan' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let row = WsSessionPersistence::get_session_row(&pool, id).await.unwrap();
        assert_eq!(row.permission_mode.as_deref(), Some("plan"));
    }

    #[tokio::test]
    async fn test_exit_plan_mode_approval_switches_to_accept_edits() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 10);
        let id = p.find_or_create_session(Some("opus"), Some("plan")).await.unwrap();

        // Simulate ExitPlanMode approval switching mode
        sqlx::query("UPDATE agent_sessions SET permission_mode = 'acceptEdits', pending_plan_approval = NULL WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let row = WsSessionPersistence::get_session_row(&pool, id).await.unwrap();
        assert_eq!(row.permission_mode.as_deref(), Some("acceptEdits"));
        assert!(row.pending_plan_approval.is_none());
    }

    // ---- Sub-agent assistant message persistence tests ----

    fn make_assistant_message(content: Vec<ContentBlock>) -> AssistantMessageBody {
        AssistantMessageBody {
            id: "msg-test".to_string(),
            content,
            model: "claude-sonnet-4-20250514".to_string(),
            stop_reason: Some("end_turn".to_string()),
            usage: None,
            msg_type: None,
        }
    }

    #[tokio::test]
    async fn test_assistant_subagent_updates_tool_call_parent() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let sid = p.find_or_create_session(None, None).await.unwrap();

        // Simulate stream_event tool_call (no parent_tool_use_id)
        let _ = WsSessionPersistence::insert_message(&pool, sid, "assistant", "{\"command\":\"ls\"}", "tool_call", Some("Bash"), Some("toolu_child1"), None, None).await;

        // Simulate assistant message arriving with parent
        let msg = make_assistant_message(vec![
            ContentBlock::ToolUse {
                id: "toolu_child1".to_string(),
                name: "Bash".to_string(),
                input: serde_json::json!({"command": "ls -la"}),
            },
        ]);
        p.persist_assistant_subagent(sid, &msg, "toolu_parent").await;

        // The existing row should now have parent_tool_use_id set
        let row: (Option<String>, String) = sqlx::query_as(
            "SELECT parent_tool_use_id, content FROM agent_messages WHERE tool_use_id = 'toolu_child1'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0.as_deref(), Some("toolu_parent"));
        // Content should be updated from the assistant message
        assert!(row.1.contains("ls -la"));

        // Should not have created a duplicate
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_messages WHERE tool_use_id = 'toolu_child1'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 1);
    }

    #[tokio::test]
    async fn test_assistant_subagent_inserts_when_no_existing_row() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let sid = p.find_or_create_session(None, None).await.unwrap();

        // No prior stream_event row — assistant message should insert
        let msg = make_assistant_message(vec![
            ContentBlock::ToolUse {
                id: "toolu_new".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({"file_path": "/tmp/test"}),
            },
        ]);
        p.persist_assistant_subagent(sid, &msg, "toolu_parent").await;

        let row: (String, String, Option<String>) = sqlx::query_as(
            "SELECT tool_name, content, parent_tool_use_id FROM agent_messages WHERE tool_use_id = 'toolu_new'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "Read");
        assert!(row.1.contains("/tmp/test"));
        assert_eq!(row.2.as_deref(), Some("toolu_parent"));
    }

    #[tokio::test]
    async fn test_assistant_subagent_persists_text_and_thinking() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let sid = p.find_or_create_session(None, None).await.unwrap();

        let msg = make_assistant_message(vec![
            ContentBlock::Thinking {
                thinking: "Let me analyze...".to_string(),
                signature: None,
            },
            ContentBlock::Text {
                text: "Here are my findings.".to_string(),
            },
        ]);
        p.persist_assistant_subagent(sid, &msg, "toolu_parent").await;

        let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT message_type, content, parent_tool_use_id FROM agent_messages WHERE session_id = ? ORDER BY id"
        ).bind(sid).fetch_all(&pool).await.unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "thinking");
        assert_eq!(rows[0].1, "Let me analyze...");
        assert_eq!(rows[0].2.as_deref(), Some("toolu_parent"));
        assert_eq!(rows[1].0, "text");
        assert_eq!(rows[1].1, "Here are my findings.");
        assert_eq!(rows[1].2.as_deref(), Some("toolu_parent"));
    }

    #[tokio::test]
    async fn test_assistant_without_parent_is_skipped() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let sid = p.find_or_create_session(None, None).await.unwrap();

        let sdk_msg = SdkMessage::Assistant {
            uuid: "u1".to_string(),
            session_id: "s1".to_string(),
            message: make_assistant_message(vec![
                ContentBlock::Text { text: "top-level response".to_string() },
            ]),
            parent_tool_use_id: None,
            error: None,
        };
        p.persist_sdk_message(&sdk_msg).await;

        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ?"
        ).bind(sid).fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 0, "top-level assistant messages should not be persisted via this path");
    }

    #[tokio::test]
    async fn test_assistant_subagent_dispatched_via_persist_sdk_message() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let _sid = p.find_or_create_session(None, None).await.unwrap();

        let sdk_msg = SdkMessage::Assistant {
            uuid: "u1".to_string(),
            session_id: "s1".to_string(),
            message: make_assistant_message(vec![
                ContentBlock::ToolUse {
                    id: "toolu_via_sdk".to_string(),
                    name: "Grep".to_string(),
                    input: serde_json::json!({"pattern": "foo"}),
                },
            ]),
            parent_tool_use_id: Some("toolu_agent".to_string()),
            error: None,
        };
        p.persist_sdk_message(&sdk_msg).await;

        let row: (String, Option<String>) = sqlx::query_as(
            "SELECT tool_name, parent_tool_use_id FROM agent_messages WHERE tool_use_id = 'toolu_via_sdk'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "Grep");
        assert_eq!(row.1.as_deref(), Some("toolu_agent"));
    }
}
