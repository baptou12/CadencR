mod support;

use axum::{body::Body, http::Request, http::StatusCode};
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::control_router;
use serde_json::{json, Value};
use tower::ServiceExt;

use support::mcp_control::{
    seed_cross_project_send_target, seed_send_target_session, seeded_control_pool,
};

fn update_request(body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/update-feature")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Run one update against a router built on `pool` and return its status/body.
async fn update(pool: &sqlx::SqlitePool, body: Value) -> (StatusCode, Value) {
    let app = control_router().with_state(AppState::with_pool(pool.clone()));
    let response = app.oneshot(update_request(body)).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn an_update_with_no_fields_is_rejected_as_empty() {
    let pool = seeded_control_pool().await;

    let (status, body) = update(&pool, json!({ "source_session_id": 777, "feature_id": 42 })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "EMPTY_UPDATE");
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("at least one of title, label, pinned, or status"));
}

#[tokio::test]
async fn a_feature_in_another_project_cannot_be_updated() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "paused").await;

    let (status, body) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 44, "pinned": true }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "FEATURE_NOT_IN_PROJECT");
    let untouched: bool = sqlx::query_scalar("SELECT is_pinned FROM features WHERE id = 44")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!untouched);
}

#[tokio::test]
async fn archiving_is_blocked_while_a_session_in_the_feature_is_running() {
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "running").await;

    let (status, body) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 43, "status": "archived" }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "FEATURE_HAS_RUNNING_SESSION");
    assert_eq!(
        body["error"],
        "A session in this feature is still running. Stop it first via project_stop_session, or skip this feature."
    );
    let status_column: String = sqlx::query_scalar("SELECT status FROM features WHERE id = 43")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status_column, "active");
}

/// The caller is mid-turn by definition while it runs this tool, so its own
/// session must not block "archive my feature now that I am done".
#[tokio::test]
async fn a_caller_can_archive_its_own_feature_despite_its_own_running_session() {
    let pool = seeded_control_pool().await;

    let (status, body) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 42, "status": "archived" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["updated"]["status"], "archived");
    assert_eq!(body["previous"]["status"], "active");
}

#[tokio::test]
async fn a_multi_field_update_applies_atomically_and_echoes_both_states() {
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "paused").await;
    sqlx::query("UPDATE features SET label = 'old', is_pinned = 0 WHERE id = 43")
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = update(
        &pool,
        json!({
            "source_session_id": 777,
            "feature_id": 43,
            "title": "Login flake",
            "label": "urgent",
            "pinned": true,
            "status": "archived"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["updated"],
        json!({"title": "Login flake", "label": "urgent", "pinned": true, "status": "archived"})
    );
    assert_eq!(
        body["previous"],
        json!({"title": "Target", "label": "old", "pinned": false, "status": "active"})
    );

    let row: (String, Option<String>, bool, String, Option<String>) = sqlx::query_as(
        "SELECT title, label, is_pinned, status, archived_at FROM features WHERE id = 43",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "Login flake");
    assert_eq!(row.1.as_deref(), Some("urgent"));
    assert!(row.2);
    assert_eq!(row.3, "archived");
    assert!(row.4.is_some(), "archiving stamps the retention clock");
    let manual_title: String = sqlx::query_scalar(
        "SELECT value FROM feature_settings WHERE feature_id = 43 AND key = 'title_manually_set'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(manual_title, "true");
}

#[tokio::test]
async fn the_write_audit_stores_the_previous_state_as_the_undo_payload() {
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "paused").await;
    sqlx::query("UPDATE features SET label = 'old' WHERE id = 43")
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 43, "title": "Renamed" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let audit: (String, String, i64, i64, i64, Option<i64>, Option<String>) = sqlx::query_as(
        "SELECT server_name, status, source_session_id, source_project_id, target_feature_id,
                target_session_id, previous_value
         FROM mcp_tool_audit_log WHERE tool_name = 'project_update_feature'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "cadencr-project");
    assert_eq!(audit.1, "ok");
    assert_eq!(audit.2, 777);
    assert_eq!(audit.3, 7);
    assert_eq!(audit.4, 43);
    assert_eq!(audit.5, None);
    let previous: Value = serde_json::from_str(&audit.6.expect("previous_value")).unwrap();
    assert_eq!(
        previous,
        json!({"title": "Target", "label": "old", "pinned": false, "status": "active"})
    );
}

#[tokio::test]
async fn an_explicit_null_label_clears_it_while_other_columns_stay_put() {
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "paused").await;
    sqlx::query("UPDATE features SET label = 'old', is_pinned = 1 WHERE id = 43")
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 43, "label": null }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["updated"]["label"].is_null());
    assert_eq!(body["previous"]["label"], "old");
    assert_eq!(body["updated"]["title"], "Target");
    assert_eq!(body["updated"]["pinned"], true);
    let row: (Option<String>, String, bool) =
        sqlx::query_as("SELECT label, title, is_pinned FROM features WHERE id = 43")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, (None, "Target".to_string(), true));
}

#[tokio::test]
async fn un_archiving_clears_the_retention_stamp() {
    let pool = seeded_control_pool().await;
    seed_send_target_session(&pool, "paused").await;
    sqlx::query(
        "UPDATE features SET status = 'archived', archived_at = datetime('now') WHERE id = 43",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 43, "status": "active" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["previous"]["status"], "archived");
    let archived_at: Option<String> =
        sqlx::query_scalar("SELECT archived_at FROM features WHERE id = 43")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(archived_at, None);
}

#[tokio::test]
async fn an_unknown_feature_is_reported_as_not_found() {
    let pool = seeded_control_pool().await;

    let (status, body) = update(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 4242, "title": "Nope" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "NOT_FOUND");
}
