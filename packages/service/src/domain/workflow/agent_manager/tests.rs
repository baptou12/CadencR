use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::mpsc;

use crate::domain::workflow::engine::WsSender;

use super::AgentManager;

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    sqlx::query(
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "CREATE TABLE projects (\
            id INTEGER PRIMARY KEY, \
            name TEXT, \
            path TEXT, \
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
    let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);
    AgentManager::new(feature_id, pool.clone(), pool, WsSender::new(tx), turn_state_tx)
}

#[tokio::test]
async fn test_resolve_model_returns_default_when_no_settings() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "opus[1m]");
}

#[tokio::test]
async fn test_resolve_model_uses_global_setting() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'sonnet')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "sonnet");
}

#[tokio::test]
async fn test_resolve_model_project_overrides_global() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'claude-sonnet-4')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'claude-opus-4-6')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    assert_eq!(model, "claude-sonnet-4");
}

#[tokio::test]
async fn test_resolve_model_feature_overrides_project() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name, model_plan) VALUES (1, 'test', 'claude-sonnet-4')")
        .execute(&pool).await.unwrap();
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
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title, model_plan) VALUES (1, 1, 'feat', 'default')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("plan", Some(1)).await;
    // "default" is a regular value, feature level wins
    assert_eq!(model, "default");
}

#[tokio::test]
async fn test_resolve_model_empty_string_falls_through() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name, model_execute) VALUES (1, 'test', 'claude-sonnet-4')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title, model_execute) VALUES (1, 1, 'feat', '')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let model = mgr.resolve_model("execute", Some(1)).await;
    assert_eq!(model, "claude-sonnet-4");
}

#[tokio::test]
async fn test_resolve_model_global_default_is_not_special() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('model_plan', 'default')")
        .execute(&pool).await.unwrap();

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
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    assert_eq!(mgr.resolve_model("plan", Some(1)).await, "plan-model");
    assert_eq!(mgr.resolve_model("execute", Some(1)).await, "exec-model");
    assert_eq!(mgr.resolve_model("review", Some(1)).await, "opus[1m]");
}

#[tokio::test]
async fn test_build_language_instruction_returns_none_when_unset() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    assert!(mgr.build_language_instruction(Some(1)).await.is_none());
}

#[tokio::test]
async fn test_build_language_instruction_returns_instruction_when_set() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('language', 'French')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    let instruction = mgr.build_language_instruction(Some(1)).await;
    assert!(instruction.is_some());
    assert!(instruction.unwrap().contains("French"));
}

#[tokio::test]
async fn test_build_language_instruction_empty_string_returns_none() {
    let pool = setup_test_db().await;
    sqlx::query("INSERT INTO projects (id, name) VALUES (1, 'test')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('language', '')")
        .execute(&pool).await.unwrap();

    let mgr = make_agent_manager(pool, 1);
    assert!(mgr.build_language_instruction(Some(1)).await.is_none());
}
