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

    /// Create the agent_sessions row on first prompt. Returns the DB id.
    pub async fn create_session(&mut self, model: Option<&str>, permission_mode: Option<&str>) -> Option<i64> {
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
            .bind("text")
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

    pub async fn mark_completed(&self) {
        self.update_status("completed").await;
    }

    pub async fn mark_error(&self) {
        self.update_status("error").await;
    }
}
