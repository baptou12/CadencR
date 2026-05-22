use sqlx::SqlitePool;

pub(super) async fn create_pre_agent_message_index_schema(pool: &SqlitePool) {
    sqlx::raw_sql(
        r#"CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL);
        CREATE TABLE agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
            role TEXT NOT NULL DEFAULT 'assistant',
            content TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            tool_name TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            tool_use_id TEXT,
            parent_tool_use_id TEXT,
            model TEXT DEFAULT NULL
        );
        CREATE INDEX idx_agent_messages_session ON agent_messages(session_id);
        INSERT INTO agent_sessions (id, feature_id) VALUES (1, 1);
        INSERT INTO agent_messages
            (session_id, role, content, message_type, tool_name, tool_use_id)
        VALUES
            (1, 'assistant', '{}', 'tool_call', 'TaskCreate', 'create-1'),
            (1, 'assistant', '{"id":"task-1"}', 'tool_result', NULL, 'create-1');"#,
    )
    .execute(pool)
    .await
    .unwrap();
}
