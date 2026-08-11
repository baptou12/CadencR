impl WsSessionPersistence {
    async fn persist_content_block_start(
        &mut self,
        session_id: i64,
        stream_scope: &RuntimeStreamScope,
        index: u64,
        block: &RuntimeContentBlock,
        ptuid: Option<&str>,
        model: Option<&str>,
    ) -> Option<PersistedMessageRef> {
        match block {
            RuntimeContentBlock::Text { text } => {
                self.insert_mergeable_block(
                    session_id,
                    stream_scope,
                    index,
                    MergeableMessageType::Text,
                    text,
                    ptuid,
                    model,
                )
                .await
            }
            RuntimeContentBlock::Thinking { thinking } => {
                self.insert_mergeable_block(
                    session_id,
                    stream_scope,
                    index,
                    MergeableMessageType::Thinking,
                    thinking,
                    ptuid,
                    model,
                )
                .await
            }
            RuntimeContentBlock::ToolUse { id, name, input } => {
                self.insert_tool_call_block(
                    session_id,
                    stream_scope,
                    index,
                    id,
                    name,
                    input,
                    ptuid,
                    model,
                )
                .await
            }
            RuntimeContentBlock::Other => None,
        }
    }

    async fn persist_content_block_delta(
        &mut self,
        session_id: i64,
        stream_scope: &RuntimeStreamScope,
        index: u64,
        delta: &RuntimeContentDelta,
        ptuid: Option<&str>,
    ) -> Option<PersistedMessageRef> {
        match delta {
            RuntimeContentDelta::Text { text } => {
                self.append_mergeable_delta(
                    session_id,
                    stream_scope,
                    index,
                    MergeableMessageType::Text,
                    text,
                    ptuid,
                )
                .await
            }
            RuntimeContentDelta::Thinking { thinking } => {
                self.append_mergeable_delta(
                    session_id,
                    stream_scope,
                    index,
                    MergeableMessageType::Thinking,
                    thinking,
                    ptuid,
                )
                .await
            }
            RuntimeContentDelta::InputJson { partial_json } => {
                self.persist_tool_input_delta(stream_scope, index, partial_json)
                    .await
            }
        }
    }

    async fn insert_mergeable_block(
        &mut self,
        session_id: i64,
        stream_scope: &RuntimeStreamScope,
        index: u64,
        message_type: MergeableMessageType,
        content: &str,
        ptuid: Option<&str>,
        model: Option<&str>,
    ) -> Option<PersistedMessageRef> {
        let result = Self::insert_message(
            &self.write_pool,
            session_id,
            "assistant",
            content,
            message_type.db_value(),
            None,
            None,
            ptuid,
            model,
        )
        .await;
        match result {
            Ok(row) => {
                let row_id = row.last_insert_rowid();
                // Record that this runtime session streamed text/thinking this
                // cycle, so the full-assistant-message fallback knows the text
                // is already persisted and must not write it again.
                self.streamed_assistant_content.insert(stream_scope.clone());
                self.pending_mergeable_blocks.insert(
                    (stream_scope.clone(), index),
                    PendingMergeableBlock {
                        row_id,
                        message_type,
                    },
                );
                Some(PersistedMessageRef { id: row_id })
            }
            Err(e) => {
                error!(error = %e, session_id, "failed to persist text/thinking block");
                None
            }
        }
    }

    async fn append_mergeable_delta(
        &mut self,
        session_id: i64,
        stream_scope: &RuntimeStreamScope,
        index: u64,
        message_type: MergeableMessageType,
        delta: &str,
        ptuid: Option<&str>,
    ) -> Option<PersistedMessageRef> {
        let key = (stream_scope.clone(), index);
        if let Some(pending) = self.pending_mergeable_blocks.get(&key).copied() {
            if pending.message_type == message_type {
                let result =
                    sqlx::query("UPDATE agent_messages SET content = content || ? WHERE id = ?")
                        .bind(delta)
                        .bind(pending.row_id)
                        .execute(&self.write_pool)
                        .await;
                if let Err(e) = result {
                    error!(
                        error = %e,
                        row_id = pending.row_id,
                        "failed to append text/thinking delta"
                    );
                    return None;
                }
                return Some(PersistedMessageRef { id: pending.row_id });
            }
        }

        let current_model = self.current_models.get(stream_scope).cloned();
        self.insert_mergeable_block(
            session_id,
            stream_scope,
            index,
            message_type,
            delta,
            ptuid,
            current_model.as_deref(),
        )
        .await
    }

    async fn insert_tool_call_block(
        &mut self,
        session_id: i64,
        stream_scope: &RuntimeStreamScope,
        index: u64,
        id: &str,
        name: &str,
        input: &serde_json::Value,
        ptuid: Option<&str>,
        model: Option<&str>,
    ) -> Option<PersistedMessageRef> {
        let content = serde_json::to_string(input).unwrap_or_default();
        let row_id = match crate::domain::features::repository::persist_tool_call_message(
            &self.write_pool,
            crate::domain::features::repository::ToolCallMessage {
                session_id,
                tool_use_id: id,
                tool_name: name,
                content: &content,
                parent_tool_use_id: ptuid,
                model,
            },
        )
        .await
        {
            Ok(id) => id,
            Err(e) => {
                error!(error = %e, session_id, tool_use_id = %id, "failed to persist tool_call");
                return None;
            }
        };

        let key = (stream_scope.clone(), index);
        self.pending_tool_row_ids.insert(key.clone(), row_id);
        self.pending_tool_inputs
            .insert(key, RuntimeToolInputBuffer::new(name, input));

        if !self.file_change_marked && is_file_change_tool_name(name) {
            self.mark_has_file_changes(session_id).await;
        }

        Some(PersistedMessageRef { id: row_id })
    }

    async fn persist_tool_input_delta(
        &mut self,
        stream_scope: &RuntimeStreamScope,
        index: u64,
        partial_json: &str,
    ) -> Option<PersistedMessageRef> {
        let key = (stream_scope.clone(), index);
        let parsed = self
            .pending_tool_inputs
            .get_mut(&key)
            .and_then(|buffer| buffer.apply_delta(partial_json));

        let row_id = self.pending_tool_row_ids.get(&key).copied()?;
        if let Some(parsed) = parsed {
            let content = serde_json::to_string(&parsed).unwrap_or_default();
            let result = sqlx::query("UPDATE agent_messages SET content = ? WHERE id = ?")
                .bind(&content)
                .bind(row_id)
                .execute(&self.write_pool)
                .await;
            if let Err(e) = result {
                error!(error = %e, row_id, "failed to update tool_call input JSON");
                return None;
            }
        }
        Some(PersistedMessageRef { id: row_id })
    }

    async fn persist_content_block_stop(&mut self, stream_scope: &RuntimeStreamScope, index: u64) {
        let key = (stream_scope.clone(), index);
        self.pending_mergeable_blocks.remove(&key);
        if let Some(buffer) = self.pending_tool_inputs.remove(&key) {
            self.flush_tool_input_buffer(&key, buffer).await;
        }
        self.pending_tool_row_ids.remove(&key);
    }

    async fn flush_tool_input_buffer(
        &self,
        key: &(RuntimeStreamScope, u64),
        buffer: RuntimeToolInputBuffer,
    ) {
        if buffer.accumulated().is_empty() {
            return;
        }
        let Some(&row_id) = self.pending_tool_row_ids.get(key) else {
            return;
        };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(buffer.accumulated()) else {
            return;
        };
        let is_trivial_object = parsed.as_object().map_or(false, |obj| obj.is_empty());
        if is_trivial_object {
            return;
        }
        let content = serde_json::to_string(&parsed).unwrap_or_default();
        let result = sqlx::query("UPDATE agent_messages SET content = ? WHERE id = ?")
            .bind(&content)
            .bind(row_id)
            .execute(&self.write_pool)
            .await;
        if let Err(e) = result {
            error!(error = %e, row_id, "failed to flush final tool_call input JSON");
        }
    }
}
