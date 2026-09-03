mod support;

use axum::{body::Body, http::Request, http::StatusCode};
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::control_router;
use tower::ServiceExt;

use support::mcp_control::{
    seed_cross_project_send_target, seed_send_target_session, seeded_control_pool,
};

fn stop_session_request(source_session_id: i64, target_session_id: i64) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/stop-session")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "source_session_id": source_session_id,
                "target_session_id": target_session_id
            })
            .to_string(),
        ))
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn audit_row(pool: &sqlx::SqlitePool) -> (String, i64, i64, String, Option<String>) {
    sqlx::query_as(
        "SELECT tool_name, source_session_id, target_session_id, status, previous_value
         FROM mcp_tool_audit_log
         WHERE tool_name = 'project_stop_session'",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An idle target is the normal watchdog race, not a failure: the tool answers
/// `stopped: false` so the caller can treat it as success.
#[tokio::test]
async fn stopping_a_session_without_a_running_turn_is_a_successful_no_op() {
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "running").await;

    let app = control_router().with_state(AppState::with_pool(pool.clone()));
    let response = app.oneshot(stop_session_request(777, 888)).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["stopped"], false);
    assert_eq!(body["reason"], "SESSION_NOT_RUNNING");
    assert_eq!(body["targetSessionId"], 888);

    let audit = audit_row(&pool).await;
    assert_eq!(audit.0, "project_stop_session");
    assert_eq!((audit.1, audit.2), (777, 888));
    assert_eq!(audit.3, "ok");
    // Nothing was interrupted, so there is no previous state to restore.
    assert!(audit.4.is_none());
}

#[tokio::test]
async fn a_session_cannot_stop_itself() {
    let pool = seeded_control_pool().await;

    let app = control_router().with_state(AppState::with_pool(pool.clone()));
    let response = app.oneshot(stop_session_request(777, 777)).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["code"], "CANNOT_STOP_SELF");
    assert_eq!(
        body["error"],
        "a session cannot interrupt its own running turn"
    );

    let audit = audit_row(&pool).await;
    assert_eq!(audit.3, "error");
}

#[tokio::test]
async fn stopping_a_session_in_another_project_is_refused() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "running").await;

    let app = control_router().with_state(AppState::with_pool(pool.clone()));
    let response = app.oneshot(stop_session_request(777, 999)).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("does not belong to current project"));

    let audit = audit_row(&pool).await;
    assert_eq!(audit.3, "error");
}

#[tokio::test]
async fn stopping_an_unknown_session_is_not_found() {
    let pool = seeded_control_pool().await;

    let app = control_router().with_state(AppState::with_pool(pool.clone()));
    let response = app.oneshot(stop_session_request(777, 4242)).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
