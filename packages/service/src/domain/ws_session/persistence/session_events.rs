impl WsSessionPersistence {
    /// Main dispatch for normalized runtime events.
    pub async fn persist_runtime_event(&mut self, runtime_event: &RuntimeEvent) {
        let Some(session_id) = self.session_db_id else {
            return;
        };

        if let Some(event) = runtime_event.stream_event() {
            self.persist_stream_event(
                session_id,
                runtime_event.session_id(),
                event,
                runtime_event.parent_tool_use_id(),
            )
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
            let content = serialize_compact_metadata(runtime_event.compact_metadata());
            let _ = Self::insert_message(
                &self.write_pool,
                session_id,
                "system",
                &content,
                "compact_divider",
                None,
                None,
                None,
                None,
            )
            .await;
            let _ = sqlx::query("UPDATE agent_sessions SET was_compacted = 1 WHERE id = ?")
                .bind(session_id)
                .execute(&self.write_pool)
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
        runtime_session_id: Option<&str>,
        event: &RuntimeStreamEvent,
        ptuid: Option<&str>,
    ) {
        let runtime_key = runtime_stream_key(runtime_session_id);
        let model = self.current_models.get(&runtime_key).map(String::as_str);

        match event {
            RuntimeStreamEvent::MessageStart { model, .. } => {
                if let Some(model) = model.clone() {
                    self.current_models.insert(runtime_key, model);
                }
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
                        let key = (runtime_key.clone(), *index);
                        self.pending_tool_row_ids.insert(key.clone(), row_id);
                        // Buffer starts empty so that streaming `partial_json`
                        // fragments can be concatenated into a valid object
                        // directly. Seeding the buffer with `serde_json::to_string(input)`
                        // (typically `"{}"`) poisoned the concat path: `"{}" + fragment`
                        // is never valid JSON, and the `replacement_candidate` fallback
                        // only activates when a fragment starts with `{`, leaving the
                        // accumulator stuck at `"{}"` for the whole stream.
                        self.pending_tool_inputs.insert(
                            key,
                            ToolInputBuffer {
                                accumulated: String::new(),
                                replacement_candidate: None,
                            },
                        );
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
                    let key = (runtime_key.clone(), *index);
                    let parsed = self
                        .pending_tool_inputs
                        .get_mut(&key)
                        .and_then(|buffer| buffer.apply_delta(partial_json));

                    if let Some(parsed) = parsed {
                        if let Some(&row_id) = self.pending_tool_row_ids.get(&key) {
                            let content = serde_json::to_string(&parsed).unwrap_or_default();
                            let _ = sqlx::query("UPDATE agent_messages SET content = ? WHERE id = ?")
                                .bind(&content)
                                .bind(row_id)
                                .execute(&self.write_pool)
                                .await;
                        }
                    }
                }
            },
            RuntimeStreamEvent::ContentBlockStop { index } => {
                let key = (runtime_key.clone(), *index);
                if let Some(buffer) = self.pending_tool_inputs.remove(&key) {
                    if !buffer.accumulated.is_empty() {
                        if let Some(&row_id) = self.pending_tool_row_ids.get(&key) {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&buffer.accumulated) {
                                // A trailing `AssistantMessage` may have already
                                // reconciled the row with the real tool input —
                                // writing an empty `{}` back here would clobber it.
                                let is_trivial_object = parsed
                                    .as_object()
                                    .map_or(false, |obj| obj.is_empty());
                                if !is_trivial_object {
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
                }
                self.pending_tool_row_ids.remove(&key);
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

impl ToolInputBuffer {
    fn apply_delta(&mut self, partial_json: &str) -> Option<serde_json::Value> {
        let appended = format!("{}{partial_json}", self.accumulated);
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&appended) {
            self.accumulated = appended;
            self.replacement_candidate = None;
            return Some(parsed);
        }

        if self.replacement_candidate.is_some() || partial_json.trim_start().starts_with('{') {
            let replacement = self.replacement_candidate.get_or_insert_with(String::new);
            replacement.push_str(partial_json);
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(replacement) {
                self.accumulated = replacement.clone();
                self.replacement_candidate = None;
                return Some(parsed);
            }
        }

        None
    }
}

fn runtime_stream_key(runtime_session_id: Option<&str>) -> String {
    runtime_session_id.unwrap_or_default().to_string()
}

/// Serialize a compaction metadata payload into the `content` column of the
/// persisted `compact_divider` row so history reload can surface `trigger` /
/// `pre_tokens`. Returns an empty string when nothing is worth persisting.
fn serialize_compact_metadata(
    metadata: Option<&crate::domain::agents::adapter::RuntimeCompactMetadata>,
) -> String {
    match metadata {
        Some(meta) if meta.trigger.is_some() || meta.pre_tokens.is_some() => {
            serde_json::to_string(meta).unwrap_or_default()
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod session_events_tests {
    use super::*;
    use crate::domain::agents::adapter::{
        RuntimeAssistantMessage, RuntimeCompactMetadata, RuntimeContentBlock, RuntimeContentDelta,
        RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeStreamEvent,
    };
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::{Row, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect test db");

        sqlx::query(
            "CREATE TABLE agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                started_at TEXT,
                ended_at TEXT,
                runtime_provider TEXT,
                runtime_session_id TEXT,
                has_file_changes INTEGER DEFAULT 0,
                model TEXT DEFAULT NULL,
                permission_mode TEXT DEFAULT 'bypassPermissions',
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                context_window INTEGER DEFAULT 200000,
                was_compacted INTEGER DEFAULT 0
            )",
        )
        .execute(&pool)
        .await
        .expect("create sessions");

        sqlx::query(
            "CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'text',
                tool_name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                tool_use_id TEXT,
                parent_tool_use_id TEXT,
                model TEXT DEFAULT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create messages");

        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status)
             VALUES (1, 'execute', 'running')",
        )
        .execute(&pool)
        .await
        .expect("insert session");

        pool
    }

    fn stream_event(
        runtime_session_id: &str,
        parent_tool_use_id: Option<&str>,
        event: RuntimeStreamEvent,
    ) -> RuntimeEvent {
        RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some(runtime_session_id.to_string()),
                usage: None,
                context_window: None,
                raw: serde_json::json!({}),
            },
            RuntimeEventKind::StreamEvent {
                event,
                parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
            },
        )
    }

    #[tokio::test]
    async fn tool_json_deltas_do_not_collide_between_child_sessions() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::MessageStart {
                    model: Some("model-a".to_string()),
                    input_tokens: None,
                },
            ))
            .await;
        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_a".to_string(),
                        name: "Grep".to_string(),
                        input: serde_json::json!({ "status": "pending" }),
                    },
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&stream_event(
                "child_b",
                Some("task_b"),
                RuntimeStreamEvent::MessageStart {
                    model: Some("model-b".to_string()),
                    input_tokens: None,
                },
            ))
            .await;
        persistence
            .persist_runtime_event(&stream_event(
                "child_b",
                Some("task_b"),
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_b".to_string(),
                        name: "Read".to_string(),
                        input: serde_json::json!({ "status": "pending" }),
                    },
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockDelta {
                    index: 0,
                    delta: RuntimeContentDelta::InputJson {
                        partial_json: r#"{"pattern":"foo"}"#.to_string(),
                    },
                },
            ))
            .await;
        persistence
            .persist_runtime_event(&stream_event(
                "child_b",
                Some("task_b"),
                RuntimeStreamEvent::ContentBlockDelta {
                    index: 0,
                    delta: RuntimeContentDelta::InputJson {
                        partial_json: r#"{"file_path":"/tmp/test"}"#.to_string(),
                    },
                },
            ))
            .await;

        let rows = sqlx::query(
            "SELECT tool_use_id, tool_name, content, parent_tool_use_id FROM agent_messages WHERE session_id = 1 AND message_type = 'tool_call' ORDER BY tool_use_id",
        )
        .fetch_all(&pool)
        .await
        .expect("fetch tool rows");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get::<String, _>("tool_use_id"), "tool_a");
        assert_eq!(rows[0].get::<String, _>("tool_name"), "Grep");
        assert_eq!(rows[0].get::<String, _>("parent_tool_use_id"), "task_a");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rows[0].get::<String, _>("content"))
                .expect("valid json"),
            serde_json::json!({ "pattern": "foo" })
        );

        assert_eq!(rows[1].get::<String, _>("tool_use_id"), "tool_b");
        assert_eq!(rows[1].get::<String, _>("tool_name"), "Read");
        assert_eq!(rows[1].get::<String, _>("parent_tool_use_id"), "task_b");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rows[1].get::<String, _>("content"))
                .expect("valid json"),
            serde_json::json!({ "file_path": "/tmp/test" })
        );
    }

    #[tokio::test]
    async fn tool_json_deltas_support_chunked_replacement_snapshots() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_a".to_string(),
                        name: "Task".to_string(),
                        input: serde_json::json!({ "status": "pending" }),
                    },
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockDelta {
                    index: 0,
                    delta: RuntimeContentDelta::InputJson {
                        partial_json: r#"{"nested": "#.to_string(),
                    },
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockDelta {
                    index: 0,
                    delta: RuntimeContentDelta::InputJson {
                        partial_json: r#"{"key":"value"}}"#.to_string(),
                    },
                },
            ))
            .await;

        let row = sqlx::query(
            "SELECT content FROM agent_messages WHERE session_id = 1 AND tool_use_id = 'tool_a'",
        )
        .fetch_one(&pool)
        .await
        .expect("fetch tool row");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&row.get::<String, _>("content"))
                .expect("valid json"),
            serde_json::json!({ "nested": { "key": "value" } })
        );
    }

    fn compact_boundary_event(metadata: Option<RuntimeCompactMetadata>) -> RuntimeEvent {
        RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some("sess".to_string()),
                usage: None,
                context_window: None,
                raw: serde_json::json!({}),
            },
            RuntimeEventKind::CompactBoundary { metadata },
        )
    }

    #[tokio::test]
    async fn compact_boundary_sets_was_compacted_and_stores_metadata() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&compact_boundary_event(Some(RuntimeCompactMetadata {
                trigger: Some("auto".to_string()),
                pre_tokens: Some(90_000),
            })))
            .await;

        let session_row = sqlx::query("SELECT was_compacted FROM agent_sessions WHERE id = 1")
            .fetch_one(&pool)
            .await
            .expect("fetch session row");
        assert_eq!(session_row.get::<i64, _>("was_compacted"), 1);

        let message_row = sqlx::query(
            "SELECT content, message_type FROM agent_messages WHERE session_id = 1",
        )
        .fetch_one(&pool)
        .await
        .expect("fetch message row");
        assert_eq!(message_row.get::<String, _>("message_type"), "compact_divider");
        let content = message_row.get::<String, _>("content");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content).expect("valid json"),
            serde_json::json!({ "trigger": "auto", "pre_tokens": 90_000 })
        );
    }

    #[tokio::test]
    async fn compact_boundary_without_metadata_stores_empty_content() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&compact_boundary_event(None))
            .await;

        let message_row = sqlx::query("SELECT content FROM agent_messages WHERE session_id = 1")
            .fetch_one(&pool)
            .await
            .expect("fetch message row");
        assert_eq!(message_row.get::<String, _>("content"), "");
    }

    fn assistant_event(
        runtime_session_id: &str,
        parent_tool_use_id: Option<&str>,
        message: RuntimeAssistantMessage,
    ) -> RuntimeEvent {
        RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some(runtime_session_id.to_string()),
                usage: None,
                context_window: None,
                raw: serde_json::json!({}),
            },
            RuntimeEventKind::AssistantMessage {
                message,
                parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
            },
        )
    }

    async fn fetch_tool_call_content(pool: &SqlitePool, tool_use_id: &str) -> String {
        sqlx::query("SELECT content FROM agent_messages WHERE tool_use_id = ?")
            .bind(tool_use_id)
            .fetch_one(pool)
            .await
            .expect("fetch tool_call row")
            .get::<String, _>("content")
    }

    /// Anthropic streams `partial_json` as bare fragments that don't necessarily
    /// start with `{`. The accumulator must concatenate them into a valid object
    /// — when seeded with `"{}"` (the buggy default) the concat path was never
    /// valid and the fallback never triggered, leaving the row at `"{}"`.
    #[tokio::test]
    async fn tool_json_deltas_recover_from_anthropic_fragmentation() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&stream_event(
                "ses_1",
                None,
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_edit_1".to_string(),
                        name: "Edit".to_string(),
                        input: serde_json::json!({}),
                    },
                },
            ))
            .await;

        for fragment in [
            r#"{"file_path":"#,
            r#""/foo.ts","#,
            r#""old_string":"a","new_string":"b"}"#,
        ] {
            persistence
                .persist_runtime_event(&stream_event(
                    "ses_1",
                    None,
                    RuntimeStreamEvent::ContentBlockDelta {
                        index: 0,
                        delta: RuntimeContentDelta::InputJson {
                            partial_json: fragment.to_string(),
                        },
                    },
                ))
                .await;
        }

        persistence
            .persist_runtime_event(&stream_event(
                "ses_1",
                None,
                RuntimeStreamEvent::ContentBlockStop { index: 0 },
            ))
            .await;

        let content = fetch_tool_call_content(&pool, "tool_edit_1").await;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content).expect("valid json"),
            serde_json::json!({
                "file_path": "/foo.ts",
                "old_string": "a",
                "new_string": "b",
            })
        );
    }

    /// Even when streaming deltas never assemble a complete input, the trailing
    /// `AssistantMessage` carries the full tool input. A `ContentBlockStop`
    /// arriving after the reconcile must NOT clobber the row with the stale
    /// (empty) buffer.
    #[tokio::test]
    async fn content_block_stop_does_not_clobber_reconciled_content() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&stream_event(
                "ses_1",
                None,
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_edit_2".to_string(),
                        name: "Edit".to_string(),
                        input: serde_json::json!({}),
                    },
                },
            ))
            .await;

        // No deltas advance the accumulator (simulates the failure mode where
        // every fragment is rejected by the buffer).

        persistence
            .persist_runtime_event(&assistant_event(
                "ses_1",
                None,
                RuntimeAssistantMessage {
                    model: Some("claude-sonnet-4".to_string()),
                    content: vec![RuntimeContentBlock::ToolUse {
                        id: "tool_edit_2".to_string(),
                        name: "Edit".to_string(),
                        input: serde_json::json!({
                            "file_path": "/bar.ts",
                            "old_string": "x",
                            "new_string": "y",
                        }),
                    }],
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&stream_event(
                "ses_1",
                None,
                RuntimeStreamEvent::ContentBlockStop { index: 0 },
            ))
            .await;

        let content = fetch_tool_call_content(&pool, "tool_edit_2").await;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content).expect("valid json"),
            serde_json::json!({
                "file_path": "/bar.ts",
                "old_string": "x",
                "new_string": "y",
            })
        );
    }

    /// Sub-agent tool calls go through `persist_assistant_subagent` instead of
    /// `reconcile_tool_call_content`, but they share the same stream-side
    /// `ContentBlockStop` handler — so they must be guarded against the same
    /// clobber race.
    #[tokio::test]
    async fn content_block_stop_does_not_clobber_subagent_reconciled_content() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_sub_1".to_string(),
                        name: "Edit".to_string(),
                        input: serde_json::json!({}),
                    },
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&assistant_event(
                "child_a",
                Some("task_a"),
                RuntimeAssistantMessage {
                    model: Some("claude-sonnet-4".to_string()),
                    content: vec![RuntimeContentBlock::ToolUse {
                        id: "tool_sub_1".to_string(),
                        name: "Edit".to_string(),
                        input: serde_json::json!({
                            "file_path": "/baz.ts",
                            "old_string": "p",
                            "new_string": "q",
                        }),
                    }],
                },
            ))
            .await;

        persistence
            .persist_runtime_event(&stream_event(
                "child_a",
                Some("task_a"),
                RuntimeStreamEvent::ContentBlockStop { index: 0 },
            ))
            .await;

        let content = fetch_tool_call_content(&pool, "tool_sub_1").await;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content).expect("valid json"),
            serde_json::json!({
                "file_path": "/baz.ts",
                "old_string": "p",
                "new_string": "q",
            })
        );
    }
}
