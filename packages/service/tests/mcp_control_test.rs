use axum::{body::Body, http::Request, http::StatusCode};
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::control_router;
use cadencr_service::domain::settings_store::global_write_content;
use cadencr_service::shared::migrate::{run_migrations, MigrationContext};
use serde_json::json;
use tower::ServiceExt;

static SETTINGS_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn project_spawn_session_creates_feature_session_provenance_and_link() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;

    let app = control_router().with_state(AppState::with_pool(pool.clone()));
    let response = app.oneshot(spawn_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let response_body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let feature_id = response_body["featureId"].as_i64().unwrap();
    let session_id = response_body["sessionId"].as_i64().unwrap();
    let message_id = response_body["messageId"].as_i64().unwrap();

    let feature: (i64, String) =
        sqlx::query_as("SELECT project_id, title FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(feature, (7, "Investigate flaky login test".into()));
    let session: (i64, String, String, String, String) = sqlx::query_as(
        "SELECT feature_id, status, runtime_provider, model, codex_permission_mode FROM agent_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        session,
        (
            feature_id,
            "paused".into(),
            "missing_provider".into(),
            "missing-model".into(),
            "auto_review".into()
        )
    );
    let worktree_base: String = sqlx::query_scalar(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_base_branch'",
    )
    .bind(feature_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(worktree_base, "main");
    let origin: (String, i64, i64, i64, String) = sqlx::query_as(
        "SELECT origin_kind, source_session_id, source_feature_id, source_project_id, note FROM agent_message_origins WHERE message_id = ?",
    )
    .bind(message_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        origin,
        (
            "session_generated".into(),
            777,
            42,
            7,
            "delegated by project MCP".into()
        )
    );
    let link: (i64, i64, String) = sqlx::query_as(
        "SELECT source_session_id, target_session_id, link_type FROM agent_session_links WHERE target_session_id = ?",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(link, (777, session_id, "spawned".into()));

    let audit: (String, i64, i64, i64, i64, String) = sqlx::query_as(
        "SELECT tool_name, source_session_id, source_feature_id, source_project_id, target_session_id, status
         FROM mcp_tool_audit_log
         WHERE tool_name = 'project_spawn_session'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        audit,
        (
            "project_spawn_session".into(),
            777,
            42,
            7,
            session_id,
            "ok".into()
        )
    );
}

#[tokio::test]
async fn project_spawn_session_can_skip_session_link() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(spawn_request_with_link(false)).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let link_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_session_links")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(link_count, 0);
}

#[tokio::test]
async fn project_spawn_session_rejects_when_disabled_by_setting() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    global_write_content(r#"{"project_mcp_allow_spawn":"false"}"#)
        .await
        .unwrap();
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(spawn_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let spawned_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM features WHERE title = 'Investigate flaky login test'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(spawned_count, 0);
}

#[tokio::test]
async fn project_spawn_session_rejects_when_root_spawn_budget_is_exhausted() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    seed_spawn_chain(&pool, 777, 5).await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(spawn_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let spawned_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM features WHERE title = 'Investigate flaky login test'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(spawned_count, 0);
}

#[tokio::test]
async fn project_spawn_session_audits_when_root_spawn_budget_is_exhausted() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    seed_spawn_chain(&pool, 777, 5).await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(spawn_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let audit: (String, i64, i64, i64, String, String) = sqlx::query_as(
        "SELECT tool_name, source_session_id, source_feature_id, source_project_id, status, error
         FROM mcp_tool_audit_log
         WHERE tool_name = 'project_spawn_session'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "project_spawn_session");
    assert_eq!(audit.1, 777);
    assert_eq!(audit.2, 42);
    assert_eq!(audit.3, 7);
    assert_eq!(audit.4, "error");
    assert!(audit.5.contains("spawn limit exceeded"));
}

#[tokio::test]
async fn project_send_message_audits_invalid_delivery_without_persisting() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "paused").await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(send_message_request("teleport")).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let message_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = 888")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(message_count, 0);
    let audit: (String, i64, i64, i64, i64, String, String) = sqlx::query_as(
        "SELECT tool_name, source_session_id, source_feature_id, source_project_id,
                target_session_id, status, error
         FROM mcp_tool_audit_log
         WHERE tool_name = 'project_send_session_message'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "project_send_session_message");
    assert_eq!(audit.1, 777);
    assert_eq!(audit.2, 42);
    assert_eq!(audit.3, 7);
    assert_eq!(audit.4, 888);
    assert_eq!(audit.5, "error");
    assert!(audit.6.contains("unsupported delivery mode"));
}

#[tokio::test]
async fn project_send_message_queue_if_busy_creates_messaged_link() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "running").await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app
        .oneshot(send_message_request("queue_if_busy"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let message_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = 888")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(message_count, 0);
    let link: (i64, i64, String, String) = sqlx::query_as(
        "SELECT source_session_id, target_session_id, link_type, note
         FROM agent_session_links
         WHERE source_session_id = 777 AND target_session_id = 888",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        link,
        (
            777,
            888,
            "messaged".into(),
            "delegated by project MCP".into()
        )
    );
}

#[tokio::test]
async fn project_send_message_can_skip_session_link() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "running").await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app
        .oneshot(send_message_request_with_link("queue_if_busy", false))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let link_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_session_links")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(link_count, 0);
}

#[tokio::test]
async fn project_send_message_rejects_when_hourly_source_budget_is_exhausted() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "paused").await;
    seed_recent_send_audits(&pool, 20).await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(send_message_request("send_now")).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let message_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agent_messages WHERE session_id = 888")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(message_count, 0);
}

async fn seeded_control_pool() -> sqlx::SqlitePool {
    global_write_content(
        r#"{"project_mcp_allow_spawn":"true","project_mcp_allow_send_message":"true"}"#,
    )
    .await
    .unwrap();
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    run_migrations(&MigrationContext {
        pool: &pool,
        db_path: None,
        app_version: None,
    })
    .await
    .unwrap();
    sqlx::query("INSERT INTO projects (id, name, path) VALUES (7, 'Proj', '/tmp/proj')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title, status, type) VALUES (42, 7, 'Source', 'active', 'ws-session')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status) VALUES (777, 42, 'session', 'running')")
        .execute(&pool)
        .await
        .unwrap();
    pool
}

async fn seed_recent_send_audits(pool: &sqlx::SqlitePool, count: i64) {
    for _ in 0..count {
        sqlx::query(
            "INSERT INTO mcp_tool_audit_log
             (server_name, tool_name, source_session_id, source_feature_id, source_project_id,
              target_session_id, target_feature_id, target_project_id, status, created_at)
             VALUES ('cadencr-project', 'project_send_session_message', 777, 42, 7,
                     888, 43, 7, 'ok', datetime('now'))",
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn seed_send_target_session(pool: &sqlx::SqlitePool, status: &str) {
    sqlx::query(
        "INSERT INTO features (id, project_id, title, status, type)
         VALUES (43, 7, 'Target', 'active', 'ws-session')",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status)
         VALUES (888, 43, 'session', ?)",
    )
    .bind(status)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_spawn_chain(pool: &sqlx::SqlitePool, root_session_id: i64, chain_length: i64) {
    let mut previous_session_id = root_session_id;
    for offset in 1..=chain_length {
        let feature_id = 1000 + offset;
        let session_id = 2000 + offset;
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type)
             VALUES (?, 7, ?, 'active', 'ws-session')",
        )
        .bind(feature_id)
        .bind(format!("Spawned {offset}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_sessions (id, feature_id, agent_type, status)
             VALUES (?, ?, 'session', 'paused')",
        )
        .bind(session_id)
        .bind(feature_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_session_links (source_session_id, target_session_id, link_type)
             VALUES (?, ?, 'spawned')",
        )
        .bind(previous_session_id)
        .bind(session_id)
        .execute(pool)
        .await
        .unwrap();
        previous_session_id = session_id;
    }
}

fn send_message_request(delivery: &str) -> Request<Body> {
    send_message_request_with_link(delivery, true)
}

fn send_message_request_with_link(delivery: &str, link_to_current_session: bool) -> Request<Body> {
    let body = json!({
        "source_feature_id": 42,
        "source_session_id": 777,
        "target_session_id": 888,
        "message": "Please validate delivery.",
        "delivery": delivery,
        "source_note": "delegated by project MCP",
        "link_to_current_session": link_to_current_session
    });
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/send-message")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn spawn_request() -> Request<Body> {
    spawn_request_with_link(true)
}

fn spawn_request_with_link(link_to_current_session: bool) -> Request<Body> {
    let body = json!({
        "source_feature_id": 42,
        "source_session_id": 777,
        "title": "Investigate flaky login test",
        "initial_message": "Please investigate and report findings.",
        "branch": { "mode": "new_worktree", "base": "main" },
        "provider": "missing_provider",
        "model": "missing-model",
        "permission_mode": "default",
        "codex_permission_mode": "auto_review",
        "source_note": "delegated by project MCP",
        "link_to_current_session": link_to_current_session
    });
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/spawn-session")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
