impl WsSessionPersistence {
    async fn reconcile_tool_call_content(
        &self,
        session_id: i64,
        message: &RuntimeAssistantMessage,
    ) {
        for block in &message.content {
            let RuntimeContentBlock::ToolUse { id, name, input } = block else {
                continue;
            };

            let content = serde_json::to_string(input).unwrap_or_default();
            let result = sqlx::query(
                "UPDATE agent_messages
                 SET content = ?, tool_name = COALESCE(tool_name, ?)
                 WHERE session_id = ? AND message_type = 'tool_call' AND tool_use_id = ?",
            )
            .bind(&content)
            .bind(name)
            .bind(session_id)
            .bind(id)
            .execute(&self.write_pool)
            .await;

            if matches!(result, Ok(ref updated) if updated.rows_affected() > 0) {
                continue;
            }

            let _ = Self::insert_message(
                &self.write_pool,
                session_id,
                "assistant",
                &content,
                "tool_call",
                Some(name),
                Some(id),
                None,
                message.model.as_deref(),
            )
            .await;
        }
    }
}

#[cfg(test)]
mod session_tool_reconciliation_tests {
    use super::*;
    use crate::domain::agents::adapter::{
        RuntimeAssistantMessage, RuntimeContentBlock, RuntimeEvent, RuntimeEventKind,
        RuntimeEventMetadata, RuntimeStreamEvent,
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
             VALUES (1, 'session', 'running')",
        )
        .execute(&pool)
        .await
        .expect("insert session");

        pool
    }

    fn assistant_event(message: RuntimeAssistantMessage) -> RuntimeEvent {
        RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some("ses_1".to_string()),
                usage: None,
                context_window: None,
                raw: serde_json::json!({}),
            },
            RuntimeEventKind::AssistantMessage {
                message,
                parent_tool_use_id: None,
            },
        )
    }

    #[tokio::test]
    async fn persists_enriched_tool_call_content_from_assistant_fallback() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        let initial = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some("ses_1".to_string()),
                usage: None,
                context_window: None,
                raw: serde_json::json!({}),
            },
            RuntimeEventKind::StreamEvent {
                event: RuntimeStreamEvent::ContentBlockStart {
                    index: 0,
                    block: RuntimeContentBlock::ToolUse {
                        id: "tool_1".to_string(),
                        name: "Bash".to_string(),
                        input: serde_json::json!({ "status": "pending" }),
                    },
                },
                parent_tool_use_id: None,
            },
        );
        persistence.persist_runtime_event(&initial).await;

        persistence
            .persist_runtime_event(&assistant_event(RuntimeAssistantMessage {
                model: Some("openai/gpt-5.4".to_string()),
                content: vec![RuntimeContentBlock::ToolUse {
                    id: "tool_1".to_string(),
                    name: "Bash".to_string(),
                    input: serde_json::json!({
                        "command": "pnpm lint",
                        "status": "completed",
                        "output": "ok\n",
                    }),
                }],
            }))
            .await;

        let row = sqlx::query(
            "SELECT content FROM agent_messages WHERE session_id = 1 AND tool_use_id = 'tool_1'",
        )
        .fetch_one(&pool)
        .await
        .expect("fetch tool_call");
        let content: String = row.get("content");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content).expect("valid json"),
            serde_json::json!({
                "command": "pnpm lint",
                "status": "completed",
                "output": "ok\n",
            })
        );
    }

    #[tokio::test]
    async fn inserts_tool_call_when_only_assistant_fallback_exists() {
        let pool = setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));

        persistence
            .persist_runtime_event(&assistant_event(RuntimeAssistantMessage {
                model: Some("openai/gpt-5.4".to_string()),
                content: vec![RuntimeContentBlock::ToolUse {
                    id: "tool_2".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({
                        "file_path": "packages/service/src/main.rs",
                        "status": "completed",
                    }),
                }],
            }))
            .await;

        let row = sqlx::query(
            "SELECT tool_name, content FROM agent_messages WHERE session_id = 1 AND tool_use_id = 'tool_2'",
        )
        .fetch_one(&pool)
        .await
        .expect("fetch inserted tool_call");

        let tool_name: String = row.get("tool_name");
        let content: String = row.get("content");
        assert_eq!(tool_name, "Read");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content).expect("valid json"),
            serde_json::json!({
                "file_path": "packages/service/src/main.rs",
                "status": "completed",
            })
        );
    }
}
