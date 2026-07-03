use sqlx::SqlitePool;

pub struct ToolCallMessage<'a> {
    pub session_id: i64,
    pub tool_use_id: &'a str,
    pub tool_name: &'a str,
    pub content: &'a str,
    pub parent_tool_use_id: Option<&'a str>,
    pub model: Option<&'a str>,
}

/// Insert a tool-call row, or update the existing row with matching
/// `(session_id, tool_use_id)` metadata when a provider callback won the race.
pub async fn persist_tool_call_message(
    pool: &SqlitePool,
    message: ToolCallMessage<'_>,
) -> Result<i64, sqlx::Error> {
    let inserted_id: Option<i64> = sqlx::query_scalar(
        "INSERT INTO agent_messages
         (session_id, role, content, message_type, tool_name, tool_use_id,
          parent_tool_use_id, model)
         SELECT ?, 'assistant', ?, 'tool_call', ?, ?, ?, ?
         WHERE NOT EXISTS (
             SELECT 1 FROM agent_messages
             WHERE session_id = ? AND message_type = 'tool_call' AND tool_use_id = ?
         )
         RETURNING id",
    )
    .bind(message.session_id)
    .bind(message.content)
    .bind(message.tool_name)
    .bind(message.tool_use_id)
    .bind(message.parent_tool_use_id)
    .bind(message.model)
    .bind(message.session_id)
    .bind(message.tool_use_id)
    .fetch_optional(pool)
    .await?;

    match inserted_id {
        Some(id) => Ok(id),
        None => update_tool_call_message(pool, message).await,
    }
}

async fn update_tool_call_message(
    pool: &SqlitePool,
    message: ToolCallMessage<'_>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "UPDATE agent_messages
         SET content = CASE
                 WHEN json_extract(
                          CASE WHEN json_valid(content) THEN content ELSE '{}' END,
                          '$.plan'
                      ) IS NOT NULL
                  AND json_extract(
                          CASE WHEN json_valid(?) THEN ? ELSE '{}' END,
                          '$.plan'
                      ) IS NULL
                 THEN content
                 ELSE ?
             END,
             tool_name = COALESCE(tool_name, ?),
             parent_tool_use_id = COALESCE(parent_tool_use_id, ?),
             model = COALESCE(model, ?)
         WHERE session_id = ? AND message_type = 'tool_call' AND tool_use_id = ?
         RETURNING id",
    )
    .bind(message.content)
    .bind(message.content)
    .bind(message.content)
    .bind(message.tool_name)
    .bind(message.parent_tool_use_id)
    .bind(message.model)
    .bind(message.session_id)
    .bind(message.tool_use_id)
    .fetch_one(pool)
    .await
}
