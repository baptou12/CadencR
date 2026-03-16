//! Database persistence for WebSocket sessions.
//!
//! Mirrors the logic in `SessionPersistence.ts` (Effect service) but implemented
//! in Rust using sqlx. All writes are best-effort — errors are logged but never
//! propagate to the caller so the WebSocket stream is not interrupted.

use std::collections::HashMap;
use sqlx::SqlitePool;
use tracing::{debug, error};

use claude_agent_sdk_rs::{SdkMessage, ContentBlock, ContentDelta, StreamEventData};

const INSERT_MESSAGE_SQL: &str =
    "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

/// A row from the `agent_sessions` table with the fields needed by the WS handler.
#[derive(Debug, Clone)]
pub struct SessionRow {
    pub id: i64,
    pub feature_id: i64,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub claude_session_id: Option<String>,
    pub status: String,
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
                "UPDATE agent_sessions SET status = 'running', model = COALESCE(?, model), permission_mode = COALESCE(?, permission_mode) WHERE id = ?"
            )
            .bind(model)
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
            "INSERT INTO agent_sessions (feature_id, agent_type, status, model, permission_mode, started_at) VALUES (?, 'session', 'running', ?, ?, ?)"
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
        if let Err(e) = sqlx::query(INSERT_MESSAGE_SQL)
            .bind(session_id)
            .bind("user")
            .bind(text)
            .bind("user_message")
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(None::<String>)
            .execute(&self.write_pool)
            .await
        {
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
            SdkMessage::System(sys_msg) => {
                use claude_agent_sdk_rs::SystemMessage;
                match sys_msg {
                    SystemMessage::CompactBoundary { .. } => {
                        let _ = sqlx::query(INSERT_MESSAGE_SQL)
                            .bind(session_id)
                            .bind("system")
                            .bind("compact_boundary")
                            .bind("compact_divider")
                            .bind(None::<String>)
                            .bind(None::<String>)
                            .bind(None::<String>)
                            .bind(None::<String>)
                            .execute(&self.write_pool)
                            .await;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
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
                        let _ = sqlx::query(INSERT_MESSAGE_SQL)
                            .bind(session_id).bind("assistant").bind(text)
                            .bind("text").bind(None::<String>).bind(None::<String>)
                            .bind(ptuid).bind(model)
                            .execute(&self.write_pool).await;
                    }
                    ContentBlock::Thinking { thinking, .. } => {
                        let _ = sqlx::query(INSERT_MESSAGE_SQL)
                            .bind(session_id).bind("assistant").bind(thinking)
                            .bind("thinking").bind(None::<String>).bind(None::<String>)
                            .bind(ptuid).bind(model)
                            .execute(&self.write_pool).await;
                    }
                    ContentBlock::ToolUse { id, name, input } => {
                        let content = serde_json::to_string(input).unwrap_or_default();
                        let result = sqlx::query(INSERT_MESSAGE_SQL)
                            .bind(session_id).bind("assistant").bind(&content)
                            .bind("tool_call").bind(name).bind(id)
                            .bind(ptuid).bind(model)
                            .execute(&self.write_pool).await;

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
                        let _ = sqlx::query(INSERT_MESSAGE_SQL)
                            .bind(session_id).bind("assistant").bind(text)
                            .bind("text_delta").bind(None::<String>).bind(None::<String>)
                            .bind(ptuid).bind(model)
                            .execute(&self.write_pool).await;
                    }
                    ContentDelta::ThinkingDelta { thinking } => {
                        let _ = sqlx::query(INSERT_MESSAGE_SQL)
                            .bind(session_id).bind("assistant").bind(thinking)
                            .bind("thinking_delta").bind(None::<String>).bind(None::<String>)
                            .bind(ptuid).bind(model)
                            .execute(&self.write_pool).await;
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

            let _ = sqlx::query(INSERT_MESSAGE_SQL)
                .bind(session_id)
                .bind("tool")
                .bind(&content)
                .bind(msg_type)
                .bind(None::<String>)
                .bind(tool_use_id)
                .bind(ptuid)
                .bind(None::<String>)
                .execute(&self.write_pool)
                .await;
        }
    }

    async fn mark_has_file_changes(&mut self, session_id: i64) {
        self.file_change_marked = true;
        let _ = sqlx::query("UPDATE agent_sessions SET has_file_changes = 1 WHERE id = ?")
            .bind(session_id)
            .execute(&self.write_pool)
            .await;
    }

    /// Read a session row from the DB by its primary key.
    pub async fn get_session_row(pool: &SqlitePool, session_id: i64) -> Option<SessionRow> {
        let row: Option<(i64, i64, Option<String>, Option<String>, Option<String>, String)> =
            sqlx::query_as(
                "SELECT id, feature_id, model, permission_mode, claude_session_id, status FROM agent_sessions WHERE id = ?"
            )
            .bind(session_id)
            .fetch_optional(pool)
            .await
            .ok()?;
        row.map(|(id, feature_id, model, permission_mode, claude_session_id, status)| SessionRow {
            id,
            feature_id,
            model,
            permission_mode,
            claude_session_id,
            status,
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
        let _ = sqlx::query(INSERT_MESSAGE_SQL)
            .bind(session_id)
            .bind("system")
            .bind("clear_divider")
            .bind("clear_divider")
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(None::<String>)
            .bind(None::<String>)
            .execute(pool)
            .await;

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

    /// Mark all running sessions as paused on startup (stale session cleanup).
    pub async fn cleanup_stale_sessions(pool: &SqlitePool) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) = sqlx::query(
            "UPDATE agent_sessions SET status = 'paused', ended_at = ? WHERE status = 'running' AND agent_type = 'session'"
        )
        .bind(&now)
        .execute(pool)
        .await
        {
            error!(error = %e, "failed to clean up stale sessions on startup");
        }
    }

    /// Store the Claude CLI session ID so future app restarts can --resume.
    pub async fn persist_claude_session_id(&self, claude_session_id: &str) {
        let Some(session_id) = self.session_db_id else { return };
        Self::persist_claude_session_id_static(&self.write_pool, session_id, claude_session_id).await;
    }

    pub async fn mark_completed(&self) {
        let Some(session_id) = self.session_db_id else { return };
        Self::mark_completed_static(&self.write_pool, session_id).await;
    }

    /// Look up the most recent claude_session_id for a feature across both
    /// `agent_sessions` and the `session_claude_ids` archive table.
    /// (The Electron stop-session flow NULLs claude_session_id and archives it
    /// to session_claude_ids, so we check both sources in a single query.)
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
                started_at TEXT,
                ended_at TEXT
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
        assert_eq!(row.0, "running");
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

        // Verify model was updated
        let row: (String, String) = sqlx::query_as(
            "SELECT model, permission_mode FROM agent_sessions WHERE id = ?",
        )
        .bind(id2)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "opus");
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
        assert_eq!(row.status, "running");
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

        // Create two sessions — one running, one paused
        let mut p1 = WsSessionPersistence::new(pool.clone(), 1);
        p1.find_or_create_session(None, None).await; // status = running

        let mut p2 = WsSessionPersistence::new(pool.clone(), 2);
        let id2 = p2.find_or_create_session(None, None).await.unwrap();
        WsSessionPersistence::mark_paused_static(&pool, id2).await;

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
    async fn test_mark_completed_instance_delegates_to_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        p.find_or_create_session(None, None).await;

        p.mark_completed().await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(p.session_db_id.unwrap()).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "completed");
    }
}
