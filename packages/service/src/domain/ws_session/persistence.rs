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
        Self {
            write_pool,
            session_db_id: None,
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

    pub async fn update_status(&self, status: &str) {
        let Some(session_id) = self.session_db_id else { return };
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE agent_sessions SET status = ?, ended_at = ? WHERE id = ?")
            .bind(status)
            .bind(&now)
            .bind(session_id)
            .execute(&self.write_pool)
            .await;
    }

    /// Store the Claude CLI session ID so future app restarts can --resume.
    pub async fn persist_claude_session_id(&self, claude_session_id: &str) {
        let Some(session_id) = self.session_db_id else { return };
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?")
            .bind(claude_session_id)
            .bind(session_id)
            .execute(&self.write_pool)
            .await
        {
            error!(error = %e, "failed to persist claude_session_id");
        }
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

    pub async fn mark_completed(&self) {
        self.update_status("completed").await;
    }

    pub async fn mark_error(&self) {
        self.update_status("error").await;
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
}
