use sqlx::SqlitePool;

/// Commit only while both copies used to prove the rewrite lossless are still
/// current. A live stream may update the tool call between the read and write;
/// in that case the caller stops without advancing its persisted cursor.
pub(super) async fn store_cleaned_if_unchanged(
    pool: &SqlitePool,
    id: i64,
    cleaned: &str,
    expected_content: &str,
    expected_result: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE agent_messages SET content = ?
         WHERE id = ? AND content = ?
           AND message_type = 'tool_call' AND tool_name = 'Bash'
           AND EXISTS (
             SELECT 1 FROM agent_messages r
             WHERE r.session_id = agent_messages.session_id
               AND r.tool_use_id = agent_messages.tool_use_id
               AND r.message_type IN ('tool_result', 'tool_error')
               AND r.content = ?
           )",
    )
    .bind(cleaned)
    .bind(id)
    .bind(expected_content)
    .bind(expected_result)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}
