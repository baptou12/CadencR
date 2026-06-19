use axum::{body::Body, extract::ws::Message, http::Request, http::StatusCode};
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::control_router;
use cadencr_service::domain::settings_store::global_write_content;
use cadencr_service::shared::migrate::{run_migrations, MigrationContext};
use serde_json::json;
use tower::ServiceExt;

static SETTINGS_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn send_now_routes_generated_message_through_runtime_pipeline() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_runtime_pool().await;
    seed_target_session(&pool, 888, 43, "paused", "missing_provider").await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(send_now_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let generated_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_messages
         WHERE session_id = 888 AND role = 'user' AND message_type = 'user_message'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        generated_count, 1,
        "replay dispatch must not duplicate user rows"
    );
    let error_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_messages
         WHERE session_id = 888 AND message_type = 'error' AND content LIKE '%missing_provider%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        error_count, 1,
        "runtime pipeline should surface adapter errors"
    );
}

#[tokio::test]
async fn send_now_broadcasts_generated_user_message_to_target_viewers() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_runtime_pool().await;
    seed_target_session(&pool, 888, 43, "paused", "missing_provider").await;
    let state = AppState::with_pool(pool.clone());
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    state.ws_feature_senders.register(43, tx).await;
    let app = control_router().with_state(state);

    let response = app.oneshot(send_now_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let payload = recv_user_message_payload(&mut rx).await;
    assert_eq!(payload["text"], "Please validate delivery.");
    assert_eq!(payload["origin"]["originKind"], "session_generated");
    assert_eq!(payload["origin"]["sourceSessionId"], 777);
}

#[tokio::test]
async fn spawn_with_initial_message_routes_prompt_through_runtime_pipeline() {
    let _settings_guard = SETTINGS_TEST_LOCK.lock().await;
    let pool = seeded_runtime_pool().await;
    let app = control_router().with_state(AppState::with_pool(pool.clone()));

    let response = app.oneshot(spawn_missing_provider_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let response_body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let session_id = response_body["sessionId"].as_i64().unwrap();
    let generated_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_messages
         WHERE session_id = ? AND role = 'user' AND message_type = 'user_message'",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        generated_count, 1,
        "initial replay must not duplicate user rows"
    );
    let error_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_messages
         WHERE session_id = ? AND message_type = 'error' AND content LIKE '%missing_provider%'",
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        error_count, 1,
        "spawn should hand initial prompt to runtime pipeline"
    );
}

async fn recv_user_message_payload(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<Message>,
) -> serde_json::Value {
    for _ in 0..5 {
        let Some(Message::Text(text)) = rx.recv().await else {
            continue;
        };
        let env: serde_json::Value = serde_json::from_str(&text).unwrap();
        if env["domain"] == "session" && env["action"] == "user_message" {
            return env["payload"].clone();
        }
    }
    panic!("expected generated user_message broadcast");
}

async fn seeded_runtime_pool() -> sqlx::SqlitePool {
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
    sqlx::query(
        "INSERT INTO features (id, project_id, title, status, type)
         VALUES (42, 7, 'Source', 'active', 'ws-session')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status)
         VALUES (777, 42, 'session', 'running')",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

async fn seed_target_session(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    feature_id: i64,
    status: &str,
    provider: &str,
) {
    sqlx::query(
        "INSERT INTO features (id, project_id, title, status, type)
         VALUES (?, 7, 'Target', 'active', 'ws-session')",
    )
    .bind(feature_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, runtime_provider)
         VALUES (?, ?, 'session', ?, ?)",
    )
    .bind(session_id)
    .bind(feature_id)
    .bind(status)
    .bind(provider)
    .execute(pool)
    .await
    .unwrap();
}

fn send_now_request() -> Request<Body> {
    let body = json!({
        "source_feature_id": 42,
        "source_session_id": 777,
        "target_session_id": 888,
        "message": "Please validate delivery.",
        "delivery": "send_now",
        "source_note": "delegated by project MCP"
    });
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/send-message")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn spawn_missing_provider_request() -> Request<Body> {
    let body = json!({
        "source_feature_id": 42,
        "source_session_id": 777,
        "title": "Investigate flaky login test",
        "initial_message": "Please investigate and report findings.",
        "branch": { "mode": "none" },
        "provider": "missing_provider",
        "model": "missing-model",
        "permission_mode": "default",
        "source_note": "delegated by project MCP"
    });
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/spawn-session")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
