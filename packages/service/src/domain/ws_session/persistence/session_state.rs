impl WsSessionPersistence {
    pub async fn mark_paused_static(pool: &SqlitePool, session_id: i64) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) =
            sqlx::query("UPDATE agent_sessions SET status = 'paused', ended_at = ? WHERE id = ?")
                .bind(&now)
                .bind(session_id)
                .execute(pool)
                .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session paused");
        }
    }

    pub async fn mark_running_static(pool: &SqlitePool, session_id: i64) {
        if let Err(e) = sqlx::query(
            "UPDATE agent_sessions SET status = 'running', ended_at = NULL WHERE id = ?",
        )
        .bind(session_id)
        .execute(pool)
        .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session running");
        }
    }

    pub async fn mark_completed_static(pool: &SqlitePool, session_id: i64) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) = sqlx::query(
            "UPDATE agent_sessions SET status = 'completed', ended_at = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(session_id)
        .execute(pool)
        .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session completed");
        }
    }

    pub async fn mark_error_static(pool: &SqlitePool, session_id: i64) {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(e) =
            sqlx::query("UPDATE agent_sessions SET status = 'error', ended_at = ? WHERE id = ?")
                .bind(&now)
                .bind(session_id)
                .execute(pool)
                .await
        {
            error!(error = %e, session_db_id = session_id, "failed to mark session error");
        }
    }

    pub async fn update_model_static(pool: &SqlitePool, session_id: i64, model: &str) {
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(model)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to update model");
        }
    }

    pub async fn update_permission_mode_static(pool: &SqlitePool, session_id: i64, mode: &str) {
        if let Err(e) = sqlx::query("UPDATE agent_sessions SET permission_mode = ? WHERE id = ?")
            .bind(mode)
            .bind(session_id)
            .execute(pool)
            .await
        {
            error!(error = %e, session_db_id = session_id, "failed to update permission_mode");
        }
    }

    pub async fn update_token_usage(
        pool: &SqlitePool,
        session_id: i64,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        let _ = sqlx::query(
            "UPDATE agent_sessions SET input_tokens = ?, output_tokens = ? WHERE id = ?",
        )
        .bind(input_tokens as i64)
        .bind(output_tokens as i64)
        .bind(session_id)
        .execute(pool)
        .await;
    }

    /// Write `context_window` to the session row. Pass `None` to clear the
    /// value (unknown — until the provider reports one). The DB column is
    /// nullable; callers that try to show a bar must treat NULL as "no data".
    pub async fn update_context_window(
        pool: &SqlitePool,
        session_id: i64,
        context_window: Option<u64>,
    ) {
        let bound = context_window.and_then(|cw| i64::try_from(cw).ok());
        let _ = sqlx::query("UPDATE agent_sessions SET context_window = ? WHERE id = ?")
            .bind(bound)
            .bind(session_id)
            .execute(pool)
            .await;
    }

    pub fn broadcast_turn_state(
        tx: &tokio::sync::broadcast::Sender<crate::app_state::TurnStateEvent>,
        feature_id: i64,
        turn: &str,
    ) {
        let _ = tx.send(crate::app_state::TurnStateEvent {
            feature_id,
            turn: turn.to_string(),
        });
    }

    #[cfg(test)]
    pub async fn mark_completed(&self) {
        let Some(session_id) = self.session_db_id else {
            return;
        };
        Self::mark_completed_static(&self.write_pool, session_id).await;
    }
}

#[cfg(test)]
mod session_state_tests {
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
                runtime_provider TEXT,
                runtime_session_id TEXT,

                model TEXT,
                permission_mode TEXT,
                has_file_changes INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                context_window INTEGER,
                started_at TEXT,
                ended_at TEXT,
                pending_plan_approval TEXT,
                plan_approval_result TEXT
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
            r#"CREATE TABLE session_runtime_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                runtime_session_id TEXT NOT NULL,
                created_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_mark_paused_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::mark_paused_static(&pool, id).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.0, "paused");
    }

    #[tokio::test]
    async fn test_mark_running_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::mark_paused_static(&pool, id).await;
        WsSessionPersistence::mark_running_static(&pool, id).await;

        let row: (String, Option<String>) =
            sqlx::query_as("SELECT status, ended_at FROM agent_sessions WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, "running");
        assert!(row.1.is_none());
    }

    #[tokio::test]
    async fn test_mark_completed_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::mark_completed_static(&pool, id).await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.0, "completed");
    }

    #[tokio::test]
    async fn test_update_model_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p
            .find_or_create_session(Some("sonnet"), None)
            .await
            .unwrap();

        WsSessionPersistence::update_model_static(&pool, id, "opus").await;

        let row: (String,) = sqlx::query_as("SELECT model FROM agent_sessions WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.0, "opus");
    }

    #[tokio::test]
    async fn test_update_permission_mode_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, Some("plan")).await.unwrap();

        WsSessionPersistence::update_permission_mode_static(&pool, id, "acceptEdits").await;

        let row: (String,) =
            sqlx::query_as("SELECT permission_mode FROM agent_sessions WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, "acceptEdits");
    }

    #[tokio::test]
    async fn test_update_token_usage() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::update_token_usage(&pool, id, 1500, 300).await;

        let row: (i64, i64) =
            sqlx::query_as("SELECT input_tokens, output_tokens FROM agent_sessions WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, 1500);
        assert_eq!(row.1, 300);
    }

    #[tokio::test]
    async fn test_mark_completed_instance_delegates_to_static() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        p.find_or_create_session(None, None).await;

        p.mark_completed().await;

        let row: (String,) = sqlx::query_as("SELECT status FROM agent_sessions WHERE id = ?")
            .bind(p.session_db_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.0, "completed");
    }

    #[tokio::test]
    async fn test_broadcast_turn_state_sends_event() {
        let (tx, mut rx) = tokio::sync::broadcast::channel(16);
        WsSessionPersistence::broadcast_turn_state(&tx, 42, "askUser");

        let event = rx.recv().await.unwrap();
        assert_eq!(event.feature_id, 42);
        assert_eq!(event.turn, "askUser");
    }

    #[tokio::test]
    async fn test_broadcast_turn_state_none() {
        let (tx, mut rx) = tokio::sync::broadcast::channel(16);
        WsSessionPersistence::broadcast_turn_state(&tx, 7, "none");

        let event = rx.recv().await.unwrap();
        assert_eq!(event.feature_id, 7);
        assert_eq!(event.turn, "none");
    }

    #[tokio::test]
    async fn test_broadcast_turn_state_no_receivers_does_not_panic() {
        let (tx, _) = tokio::sync::broadcast::channel(16);
        WsSessionPersistence::broadcast_turn_state(&tx, 1, "claude");
    }

    #[tokio::test]
    async fn test_update_context_window_stores_known_value() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::update_context_window(&pool, id, Some(1_000_000)).await;

        let row: (Option<i64>,) =
            sqlx::query_as("SELECT context_window FROM agent_sessions WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, Some(1_000_000));
    }

    #[tokio::test]
    async fn test_update_context_window_clears_to_null() {
        let pool = setup_test_db().await;
        let mut p = WsSessionPersistence::new(pool.clone(), 1);
        let id = p.find_or_create_session(None, None).await.unwrap();

        WsSessionPersistence::update_context_window(&pool, id, Some(200_000)).await;
        WsSessionPersistence::update_context_window(&pool, id, None).await;

        let row: (Option<i64>,) =
            sqlx::query_as("SELECT context_window FROM agent_sessions WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, None);
    }
}
