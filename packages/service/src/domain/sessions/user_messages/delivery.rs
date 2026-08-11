pub async fn update_delivery_state(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    message_uuid: &str,
    state: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE agent_messages SET delivery_state = ?
         WHERE session_id = ? AND message_uuid = ?
           AND (? = 'received_agent' OR delivery_state IS NULL OR delivery_state = 'pending_agent')",
    )
    .bind(state)
    .bind(session_id)
    .bind(message_uuid)
    .bind(state)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn resolve_pending_delivery_states(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    state: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE agent_messages SET delivery_state = ?
         WHERE session_id = ? AND delivery_state = 'pending_agent'",
    )
    .bind(state)
    .bind(session_id)
    .execute(pool)
    .await?
    .rows_affected())
}
