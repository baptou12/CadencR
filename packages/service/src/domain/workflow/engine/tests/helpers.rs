use axum::extract::ws::Message;
use sqlx::SqlitePool;
use tokio::sync::mpsc;

use crate::domain::features::models::WorkflowType;
use crate::domain::workflow::engine::{WorkflowEngine, WsSender};

/// Create in-memory SQLite pool for tests.
pub async fn test_pool() -> SqlitePool {
    SqlitePool::connect("sqlite::memory:").await.unwrap()
}

/// Create a WorkflowEngine with in-memory pools and a dummy WsSender.
pub async fn test_engine() -> (WorkflowEngine, mpsc::UnboundedReceiver<Message>) {
    let pool = test_pool().await;
    let (tx, rx) = mpsc::unbounded_channel();
    let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);
    let engine = WorkflowEngine::new(
        1,
        WorkflowType::FeatureBuild,
        pool.clone(),
        pool,
        tx,
        2,
        turn_state_tx,
    )
    .await
    .expect("test engine creation failed");
    (engine, rx)
}

/// Create a WorkflowEngine with full schema tables for integration tests.
pub async fn test_engine_with_schema() -> (WorkflowEngine, mpsc::UnboundedReceiver<Message>) {
    let pool = test_pool().await;
    sqlx::query(
        r#"CREATE TABLE features (
            id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT,
            status TEXT DEFAULT 'draft', type TEXT DEFAULT 'feature'
        )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE agent_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feature_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL DEFAULT 'session',
            status TEXT NOT NULL DEFAULT 'idle',
            claude_session_id TEXT,
            model TEXT, permission_mode TEXT,
            has_file_changes INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            context_window INTEGER NOT NULL DEFAULT 200000,
            started_at TEXT, ended_at TEXT,
            pending_questions TEXT
        )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE workflow_queue (
            id INTEGER PRIMARY KEY,
            feature_id INTEGER NOT NULL,
            workflow_type TEXT NOT NULL DEFAULT 'feature_build',
            item_type TEXT NOT NULL,
            phase_id INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            order_index INTEGER NOT NULL,
            group_index INTEGER,
            config JSON,
            agent_session_id INTEGER,
            result JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME, ended_at DATETIME, pid INTEGER,
            max_retries INTEGER NOT NULL DEFAULT 1,
            retry_count INTEGER NOT NULL DEFAULT 0,
            iteration_count INTEGER NOT NULL DEFAULT 0,
            iteration_history TEXT
        )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE phases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL,
            step_number INTEGER,
            title TEXT,
            status TEXT DEFAULT 'pending',
            complexity TEXT,
            commit_message TEXT,
            description TEXT,
            agent_count INTEGER DEFAULT 1
        )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE workflow_dependencies (
            item_id INTEGER NOT NULL,
            depends_on_id INTEGER NOT NULL,
            PRIMARY KEY (item_id, depends_on_id)
        )"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let (tx, rx) = mpsc::unbounded_channel();
    let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);
    let engine = WorkflowEngine::new(
        1,
        WorkflowType::FeatureBuild,
        pool.clone(),
        pool,
        tx,
        2,
        turn_state_tx,
    )
    .await
    .expect("test engine creation failed");
    (engine, rx)
}

/// Construct a QueueItem for testing.
pub fn make_queue_item(
    id: i64,
    item_type: &str,
    status: &str,
    order: i64,
    group: Option<i64>,
) -> crate::domain::features::models::QueueItem {
    crate::domain::features::models::QueueItem {
        id,
        feature_id: 1,
        workflow_type: "feature_build".to_string(),
        item_type: item_type.to_string(),
        phase_id: Some(id * 10),
        status: status.to_string(),
        order_index: order,
        group_index: group,
        config: None,
        agent_session_id: None,
        result: None,
        created_at: None,
        started_at: None,
        ended_at: None,
        pid: None,
        max_retries: 1,
        retry_count: 0,
        iteration_count: 0,
        iteration_history: None,
        phase_title: None,
    }
}

/// Helper to create a WsSender for unit tests.
pub fn test_ws_sender() -> (WsSender, mpsc::UnboundedReceiver<Message>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (WsSender::new(tx), rx)
}
