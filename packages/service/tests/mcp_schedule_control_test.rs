//! The schedule control routes as the `mcp-serve` subprocess reaches them:
//! through `control_router()`, not by calling handlers directly. A handler that
//! is never merged into the router is invisible to every agent.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use cadencr_service::api::middleware::MCP_CONTROL_HEADER;
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::control_router;
use cadencr_service::shared::migrate::{run_migrations, MigrationContext};
use serde_json::json;
use sqlx::SqlitePool;
use tower::ServiceExt;

const CALLER_SESSION: i64 = 777;

async fn seeded_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    run_migrations(&MigrationContext {
        pool: &pool,
        db_path: None,
        app_version: None,
    })
    .await
    .unwrap();
    sqlx::raw_sql(
        "INSERT INTO projects (id, name, path) VALUES (7, 'Current', '/tmp/current');
         INSERT INTO features (id, project_id, title, status, type)
         VALUES (42, 7, 'Caller', 'active', 'ws-session');
         INSERT INTO agent_sessions (id, feature_id, agent_type, status)
         VALUES (777, 42, 'session', 'paused');",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

fn post(path: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .header(MCP_CONTROL_HEADER, "test-mcp-token")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn saving_then_listing_round_trips_through_the_control_router() {
    let pool = seeded_pool().await;
    let state = AppState::with_pool(pool.clone());

    let saved = control_router()
        .with_state(state.clone())
        .oneshot(post(
            "/internal/mcp/project/schedule/save",
            json!({
                "source_session_id": CALLER_SESSION,
                "name": "Re-check CI",
                "prompt": "check whether the pipeline went green overnight",
                "enabled": true,
                "target": { "kind": "new_conversation" },
                "recurrence": { "kind": "daily", "time_of_day": "09:00", "timezone": "UTC" }
            }),
        ))
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = json_body(saved).await;
    assert_eq!(saved["enabled"], true);
    assert!(saved["next_run_at"].is_string());

    let listed = control_router()
        .with_state(state)
        .oneshot(post(
            "/internal/mcp/project/schedule/list",
            json!({ "source_session_id": CALLER_SESSION }),
        ))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let listed = json_body(listed).await;
    assert_eq!(listed["project_id"], 7);
    assert_eq!(listed["count"], 1);
    assert_eq!(listed["schedules"][0]["id"], saved["id"]);
    assert_eq!(listed["schedules"][0]["recurrence"], "daily at 09:00 UTC");
    assert_eq!(
        listed["schedules"][0]["prompt_preview"],
        "check whether the pipeline went green overnight"
    );
}

#[tokio::test]
async fn a_save_without_enabled_is_a_400_with_a_stable_code() {
    let state = AppState::with_pool(seeded_pool().await);

    let response = control_router()
        .with_state(state)
        .oneshot(post(
            "/internal/mcp/project/schedule/save",
            json!({
                "source_session_id": CALLER_SESSION,
                "prompt": "check whether the pipeline went green overnight",
                "target": { "kind": "new_conversation" },
                "recurrence": { "kind": "daily", "time_of_day": "09:00" }
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(response).await["code"], "ENABLED_REQUIRED");
}

#[tokio::test]
async fn set_enabled_and_run_are_both_routed() {
    let pool = seeded_pool().await;
    let state = AppState::with_pool(pool.clone());
    let saved = json_body(
        control_router()
            .with_state(state.clone())
            .oneshot(post(
                "/internal/mcp/project/schedule/save",
                json!({
                    "source_session_id": CALLER_SESSION,
                    "prompt": "re-check the flaky test",
                    "enabled": true,
                    "target": { "kind": "conversation", "feature_id": 42 },
                    "recurrence": { "kind": "daily", "time_of_day": "09:00" }
                }),
            ))
            .await
            .unwrap(),
    )
    .await;
    let schedule_id = saved["id"].as_i64().unwrap();

    let ran = control_router()
        .with_state(state.clone())
        .oneshot(post(
            "/internal/mcp/project/schedule/run",
            json!({ "source_session_id": CALLER_SESSION, "schedule_id": schedule_id }),
        ))
        .await
        .unwrap();
    assert_eq!(ran.status(), StatusCode::OK);
    assert_eq!(json_body(ran).await["id"], schedule_id);

    let disabled = control_router()
        .with_state(state)
        .oneshot(post(
            "/internal/mcp/project/schedule/set-enabled",
            json!({
                "source_session_id": CALLER_SESSION,
                "schedule_id": schedule_id,
                "enabled": false
            }),
        ))
        .await
        .unwrap();
    assert_eq!(disabled.status(), StatusCode::OK);
    let disabled = json_body(disabled).await;
    assert_eq!(disabled["enabled"], false);
    assert_eq!(disabled["previous_enabled"], true);
}
