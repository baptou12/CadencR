impl WsSessionPersistence {
    /// Main dispatch for normalized runtime events.
    pub async fn persist_runtime_event(&mut self, runtime_event: &RuntimeEvent) {
        let Some(session_id) = self.session_db_id else {
            return;
        };

        if let Some(event) = runtime_event.stream_event() {
            self.persist_stream_event(session_id, event, runtime_event.parent_tool_use_id())
                .await;
            return;
        }

        if let Some(message) = runtime_event.user_message() {
            self.persist_user_tool_results(session_id, message, runtime_event.parent_tool_use_id())
                .await;
            return;
        }

        if let Some(message) = runtime_event.assistant_message() {
            if let Some(ptuid) = runtime_event.parent_tool_use_id() {
                self.persist_assistant_subagent(session_id, message, ptuid)
                    .await;
            } else {
                self.reconcile_tool_call_content(session_id, message).await;
            }
            return;
        }

        if runtime_event.is_compact_boundary() {
            let _ = Self::insert_message(
                &self.write_pool,
                session_id,
                "system",
                "compact_boundary",
                "compact_divider",
                None,
                None,
                None,
                None,
            )
            .await;
        }
    }

    async fn insert_message(
        pool: &SqlitePool,
        session_id: i64,
        role: &str,
        content: &str,
        message_type: &str,
        tool_name: Option<&str>,
        tool_use_id: Option<&str>,
        ptuid: Option<&str>,
        model: Option<&str>,
    ) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
        sqlx::query(INSERT_MESSAGE_SQL)
            .bind(session_id)
            .bind(role)
            .bind(content)
            .bind(message_type)
            .bind(tool_name)
            .bind(tool_use_id)
            .bind(ptuid)
            .bind(model)
            .execute(pool)
            .await
    }

    async fn persist_stream_event(
        &mut self,
        session_id: i64,
        event: &RuntimeStreamEvent,
        ptuid: Option<&str>,
    ) {
        let model = self.current_model.as_deref();

        match event {
            RuntimeStreamEvent::MessageStart { model } => {
                self.current_model = model.clone();
            }
            RuntimeStreamEvent::ContentBlockStart { index, block } => match block {
                RuntimeContentBlock::Text { text } => {
                    let _ = Self::insert_message(
                        &self.write_pool,
                        session_id,
                        "assistant",
                        text,
                        "text",
                        None,
                        None,
                        ptuid,
                        model,
                    )
                    .await;
                }
                RuntimeContentBlock::Thinking { thinking } => {
                    let _ = Self::insert_message(
                        &self.write_pool,
                        session_id,
                        "assistant",
                        thinking,
                        "thinking",
                        None,
                        None,
                        ptuid,
                        model,
                    )
                    .await;
                }
                RuntimeContentBlock::ToolUse { id, name, input } => {
                    let content = serde_json::to_string(input).unwrap_or_default();
                    let result = Self::insert_message(
                        &self.write_pool,
                        session_id,
                        "assistant",
                        &content,
                        "tool_call",
                        Some(name),
                        Some(id),
                        ptuid,
                        model,
                    )
                    .await;

                    if let Ok(r) = result {
                        let row_id = r.last_insert_rowid();
                        self.pending_tool_row_ids.insert(*index, row_id);
                        self.pending_tool_inputs.insert(*index, String::new());
                    }

                    if !self.file_change_marked
                        && (name == "Write" || name == "Edit" || name == "NotebookEdit")
                    {
                        self.mark_has_file_changes(session_id).await;
                    }
                }
                RuntimeContentBlock::Other => {}
            },
            RuntimeStreamEvent::ContentBlockDelta { index, delta } => match delta {
                RuntimeContentDelta::Text { text } => {
                    let _ = Self::insert_message(
                        &self.write_pool,
                        session_id,
                        "assistant",
                        text,
                        "text_delta",
                        None,
                        None,
                        ptuid,
                        model,
                    )
                    .await;
                }
                RuntimeContentDelta::Thinking { thinking } => {
                    let _ = Self::insert_message(
                        &self.write_pool,
                        session_id,
                        "assistant",
                        thinking,
                        "thinking_delta",
                        None,
                        None,
                        ptuid,
                        model,
                    )
                    .await;
                }
                RuntimeContentDelta::InputJson { partial_json } => {
                    if let Some(accumulated) = self.pending_tool_inputs.get_mut(index) {
                        accumulated.push_str(partial_json);
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(accumulated) {
                            if let Some(&row_id) = self.pending_tool_row_ids.get(index) {
                                let content = serde_json::to_string(&parsed).unwrap_or_default();
                                let _ = sqlx::query(
                                    "UPDATE agent_messages SET content = ? WHERE id = ?",
                                )
                                .bind(&content)
                                .bind(row_id)
                                .execute(&self.write_pool)
                                .await;
                            }
                        }
                    }
                }
            },
            RuntimeStreamEvent::ContentBlockStop { index } => {
                if let Some(accumulated) = self.pending_tool_inputs.remove(index) {
                    if !accumulated.is_empty() {
                        if let Some(&row_id) = self.pending_tool_row_ids.get(index) {
                            if let Ok(parsed) =
                                serde_json::from_str::<serde_json::Value>(&accumulated)
                            {
                                let content = serde_json::to_string(&parsed).unwrap_or_default();
                                let _ = sqlx::query(
                                    "UPDATE agent_messages SET content = ? WHERE id = ?",
                                )
                                .bind(&content)
                                .bind(row_id)
                                .execute(&self.write_pool)
                                .await;
                            }
                        }
                    }
                }
                self.pending_tool_row_ids.remove(index);
            }
            RuntimeStreamEvent::Other => {}
        }
    }

    async fn persist_user_tool_results(
        &self,
        session_id: i64,
        message: &RuntimeUserMessage,
        ptuid: Option<&str>,
    ) {
        for item in &message.content {
            if let RuntimeUserContentBlock::ToolResult {
                tool_use_id,
                is_error,
                content,
            } = item
            {
                let content = match content {
                    serde_json::Value::String(text) => text.clone(),
                    other => serde_json::to_string(other).unwrap_or_default(),
                };
                let message_type = if *is_error { "tool_error" } else { "tool_result" };

                let _ = Self::insert_message(
                    &self.write_pool,
                    session_id,
                    "tool",
                    &content,
                    message_type,
                    None,
                    tool_use_id.as_deref(),
                    ptuid,
                    None,
                )
                .await;
            }
        }
    }

    async fn mark_has_file_changes(&mut self, session_id: i64) {
        self.file_change_marked = true;
        let _ = sqlx::query("UPDATE agent_sessions SET has_file_changes = 1 WHERE id = ?")
            .bind(session_id)
            .execute(&self.write_pool)
            .await;
    }
}
