use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tokio::sync::mpsc;

use crate::domain::workflow::engine::WsSender;

use super::AgentManager;

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "CREATE TABLE projects (\
            id INTEGER PRIMARY KEY, \
            name TEXT, \
            path TEXT, \
            agent_runtime_plan TEXT, agent_runtime_prd TEXT, agent_runtime_execute TEXT, \
            agent_runtime_risk TEXT, agent_runtime_review TEXT, \"agent_runtime_review-fixer\" TEXT, \
            agent_runtime_session TEXT, agent_runtime_qa TEXT, agent_runtime_retro TEXT, \
            model_plan TEXT, model_prd TEXT, model_execute TEXT, \
            model_risk TEXT, model_review TEXT, \"model_review-fixer\" TEXT, \
            model_session TEXT, model_qa TEXT, model_retro TEXT\
        )",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "CREATE TABLE features (\
            id INTEGER PRIMARY KEY, \
            project_id INTEGER, \
            title TEXT, \
            agent_runtime_plan TEXT, agent_runtime_prd TEXT, agent_runtime_execute TEXT, \
            agent_runtime_risk TEXT, agent_runtime_review TEXT, \"agent_runtime_review-fixer\" TEXT, \
            agent_runtime_session TEXT, agent_runtime_qa TEXT, agent_runtime_retro TEXT, \
            model_plan TEXT, model_prd TEXT, model_execute TEXT, \
            model_risk TEXT, model_review TEXT, \"model_review-fixer\" TEXT, \
            model_session TEXT, model_qa TEXT, model_retro TEXT\
        )",
    )
    .execute(&pool)
    .await
    .unwrap();

    pool
}

fn make_agent_manager(pool: SqlitePool, feature_id: i64) -> AgentManager {
    let (tx, _rx) = mpsc::unbounded_channel();
    let (session_status_tx, _) = tokio::sync::broadcast::channel(64);
    let broadcaster = crate::domain::session_status::SessionStatusBroadcaster::new(
        session_status_tx,
        std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
    );
    AgentManager::new(
        feature_id,
        pool.clone(),
        pool,
        WsSender::new(tx),
        broadcaster,
    )
}

#[tokio::test]
async fn test_resolve_model_returns_default_when_no_settings() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    // With no settings, resolve_model falls back to the adapter default
    // (CLI-reported "default" model when the CLI is reachable, else "opus").
    assert!(!model.is_empty());
}

#[tokio::test]
async fn test_resolve_model_uses_global_setting() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'sonnet')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "sonnet");
}

#[tokio::test]
async fn test_resolve_model_project_overrides_global() {
    let pool = setup_test_db().await;
    sqlx::query(
        "INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'claude-sonnet-4')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'claude-opus-4-6')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "claude-sonnet-4");
}

#[tokio::test]
async fn test_resolve_model_feature_overrides_project() {
    let pool = setup_test_db().await;
    sqlx::query(
        "INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'claude-sonnet-4')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title, model_plan) VALUES (1, 1, 'feat', 'claude-haiku-3-5')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "claude-haiku-3-5");
}

#[tokio::test]
async fn test_resolve_model_default_is_not_special() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'sonnet')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO features (id, project_id, title, model_plan) VALUES (1, 1, 'feat', 'default')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    // "default" is a regular value, feature level wins
    assert_eq!(model, "default");
}

#[tokio::test]
async fn test_resolve_model_empty_string_falls_through() {
    let pool = setup_test_db().await;
    sqlx::query(
        "INSERT INTO projects (id, name, model_execute) VALUES (1, 'test', 'claude-sonnet-4')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO features (id, project_id, title, model_execute) VALUES (1, 1, 'feat', '')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("execute", Some(1)).await;
    assert_eq!(model, "claude-sonnet-4");
}

#[tokio::test]
async fn test_resolve_model_global_default_is_not_special() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'default')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    // "default" is a regular value from global settings, not a magic keyword
    assert_eq!(model, "default");
}

#[tokio::test]
async fn test_resolve_model_different_agent_types() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name, model_plan, model_execute) VALUES (1, 'test', 'plan-model', 'exec-model')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    assert_eq!(mgr.resolve_model("plan", Some(1)).await, "plan-model");
    assert_eq!(mgr.resolve_model("execute", Some(1)).await, "exec-model");
    // "review" has no override — adapter default (CLI-reported or fallback).
    let review_default = mgr.resolve_model("review", Some(1)).await;
    assert!(!review_default.is_empty());
    assert_ne!(review_default, "plan-model");
    assert_ne!(review_default, "exec-model");
}

#[tokio::test]
async fn test_resolve_model_uses_provider_default_after_provider_override() {
    let pool = setup_test_db().await;
    sqlx::query(
        "INSERT INTO projects (id, name, agent_runtime_plan, model_plan) VALUES (1, 'test', 'claude_code', 'opus')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO features (id, project_id, title, agent_runtime_plan) VALUES (1, 1, 'feat', 'opencode')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "default/default");
}

#[tokio::test]
async fn test_resolve_provider_returns_default_when_no_settings() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let provider = mgr.resolve_provider("plan", Some(1)).await;
    assert_eq!(provider, "claude_code");
}

#[tokio::test]
async fn test_resolve_provider_uses_global_setting() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('agent_runtime_plan', 'opencode')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let provider = mgr.resolve_provider("plan", Some(1)).await;
    assert_eq!(provider, "opencode");
}

#[tokio::test]
async fn test_resolve_provider_project_overrides_global() {
    let pool = setup_test_db().await;
    sqlx::query(
        "INSERT INTO projects (id, name, agent_runtime_plan) VALUES (1, 'test', 'codex_cli')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('agent_runtime_plan', 'opencode')")
        .execute(&pool)
        .await
        .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let provider = mgr.resolve_provider("plan", Some(1)).await;
    assert_eq!(provider, "codex_cli");
}

#[tokio::test]
async fn test_resolve_provider_feature_overrides_project() {
    let pool = setup_test_db().await;
    sqlx::query(
        "INSERT INTO projects (id, name, agent_runtime_plan) VALUES (1, 'test', 'codex_cli')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO features (id, project_id, title, agent_runtime_plan) VALUES (1, 1, 'feat', 'opencode')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let mgr = make_agent_manager(pool, 1);
    let provider = mgr.resolve_provider("plan", Some(1)).await;
    assert_eq!(provider, "opencode");
}

#[tokio::test]
async fn test_set_permission_mode_persists_active_session_mode() {
    let pool = setup_test_db().await;
    sqlx::query(
        "CREATE TABLE agent_sessions (\
            id INTEGER PRIMARY KEY AUTOINCREMENT, \
            feature_id INTEGER NOT NULL, \
            agent_type TEXT NOT NULL, \
            status TEXT NOT NULL, \
            runtime_provider TEXT, \
            permission_mode TEXT\
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();

    let session_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_provider, permission_mode) \
         VALUES (1, 'session', 'running', 'claude_code', 'acceptEdits') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let mgr = make_agent_manager(pool.clone(), 1);
    let slot = crate::domain::workflow::engine::AgentSlot::Session(session_id);
    mgr.active_items.insert(slot.clone(), session_id);

    let changed_session_id = mgr.set_permission_mode(slot, "plan").await.unwrap();

    assert_eq!(changed_session_id, session_id);
    let stored_mode: String =
        sqlx::query_scalar("SELECT permission_mode FROM agent_sessions WHERE id = ?")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_mode, "plan");
}

#[tokio::test]
async fn test_set_permission_mode_rejects_unsupported_provider_mode() {
    let pool = setup_test_db().await;
    sqlx::query(
        "CREATE TABLE agent_sessions (\
            id INTEGER PRIMARY KEY AUTOINCREMENT, \
            feature_id INTEGER NOT NULL, \
            agent_type TEXT NOT NULL, \
            status TEXT NOT NULL, \
            runtime_provider TEXT, \
            permission_mode TEXT\
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool)
        .await
        .unwrap();

    let session_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_provider, permission_mode) \
         VALUES (1, 'session', 'running', 'codex_cli', 'default') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let mgr = make_agent_manager(pool.clone(), 1);
    let slot = crate::domain::workflow::engine::AgentSlot::Session(session_id);
    mgr.active_items.insert(slot.clone(), session_id);

    let error = mgr.set_permission_mode(slot, "auto").await.unwrap_err();

    assert!(error.contains("does not support permission mode auto"));
    let stored_mode: String =
        sqlx::query_scalar("SELECT permission_mode FROM agent_sessions WHERE id = ?")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_mode, "default");
}
