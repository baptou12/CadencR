//! The Steward grant guarding the two `cadencr-workspace` write endpoints.
//!
//! Source feature 42 (project 7) is the caller; feature 44 / session 999
//! (project 8) is the cross-project target no project-scoped write can reach.

mod support;

use axum::{body::Body, http::Request, http::StatusCode};
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::control_router;
use serde_json::{json, Value};
use tower::ServiceExt;

use support::mcp_control::{seed_cross_project_send_target, seeded_control_pool};

const STEWARD_KEY: &str = "steward_workspace_writes";

async fn grant_steward(pool: &sqlx::SqlitePool, value: &str) {
    sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (42, ?, ?)")
        .bind(STEWARD_KEY)
        .bind(value)
        .execute(pool)
        .await
        .unwrap();
}

async fn post(pool: &sqlx::SqlitePool, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = control_router()
        .with_state(AppState::with_pool(pool.clone()))
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn update_feature(pool: &sqlx::SqlitePool, body: Value) -> (StatusCode, Value) {
    post(pool, "/internal/mcp/workspace/update-feature", body).await
}

async fn stop_session(pool: &sqlx::SqlitePool, target_session_id: i64) -> (StatusCode, Value) {
    post(
        pool,
        "/internal/mcp/workspace/stop-session",
        json!({ "source_session_id": 777, "target_session_id": target_session_id }),
    )
    .await
}

async fn audit_rows(
    pool: &sqlx::SqlitePool,
    tool_name: &str,
) -> Vec<(String, String, Option<i64>)> {
    sqlx::query_as(
        "SELECT server_name, status, target_project_id FROM mcp_tool_audit_log
         WHERE tool_name = ? ORDER BY id",
    )
    .bind(tool_name)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_feature_without_the_grant_cannot_update_across_the_workspace() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "paused").await;

    let (status, body) = update_feature(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 44, "pinned": true }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "STEWARD_REQUIRED");
    assert_eq!(
        body["error"],
        "This feature is not granted workspace write authority. The user can enable 'Workspace writes (Steward)' in this feature's settings."
    );
    let untouched: bool = sqlx::query_scalar("SELECT is_pinned FROM features WHERE id = 44")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!untouched);

    // A refusal at the Steward boundary is journaled even though nothing was
    // written, exactly like the stop-session twin's.
    let audits = audit_rows(&pool, "workspace_update_feature").await;
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].0, "cadencr-workspace");
    assert_eq!(audits[0].1, "error");
    assert_eq!(audits[0].2, None, "the target project is never resolved");
    let (error, previous_value): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT error, previous_value FROM mcp_tool_audit_log
         WHERE tool_name = 'workspace_update_feature'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(error
        .expect("the refusal message")
        .contains("Workspace writes (Steward)"));
    assert!(
        previous_value.is_none(),
        "a refused write has nothing to undo"
    );
}

/// Only the exact string the settings endpoint stores counts. Anything else —
/// a disabled toggle, a hand-edited row, a truthy-looking value — is no grant.
#[tokio::test]
async fn a_false_or_malformed_grant_is_still_a_refusal() {
    for value in ["false", "True", "1", "yes", ""] {
        let pool = seeded_control_pool().await;
        seed_cross_project_send_target(&pool, "paused").await;
        grant_steward(&pool, value).await;

        let (update_status, update_body) = update_feature(
            &pool,
            json!({ "source_session_id": 777, "feature_id": 44, "pinned": true }),
        )
        .await;
        let (stop_status, stop_body) = stop_session(&pool, 999).await;

        assert_eq!(update_status, StatusCode::FORBIDDEN, "grant {value:?}");
        assert_eq!(update_body["code"], "STEWARD_REQUIRED");
        assert_eq!(stop_status, StatusCode::FORBIDDEN, "grant {value:?}");
        assert_eq!(stop_body["code"], "STEWARD_REQUIRED");
    }
}

#[tokio::test]
async fn a_granted_feature_updates_a_feature_in_another_project() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "paused").await;
    grant_steward(&pool, "true").await;

    let (status, body) = update_feature(
        &pool,
        json!({
            "source_session_id": 777,
            "feature_id": 44,
            "label": "stalled",
            "status": "archived"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["updated"]["status"], "archived");
    assert_eq!(body["updated"]["label"], "stalled");
    assert_eq!(body["previous"]["status"], "active");
    let row: (Option<String>, String) =
        sqlx::query_as("SELECT label, status FROM features WHERE id = 44")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, (Some("stalled".to_string()), "archived".to_string()));

    let audit: (String, String, i64, i64, i64, Option<String>) = sqlx::query_as(
        "SELECT server_name, status, source_session_id, source_project_id, target_project_id,
                previous_value
         FROM mcp_tool_audit_log WHERE tool_name = 'workspace_update_feature'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, "cadencr-workspace");
    assert_eq!(audit.1, "ok");
    assert_eq!(audit.2, 777);
    assert_eq!(audit.3, 7, "the source project is the caller's");
    assert_eq!(audit.4, 8, "the target project is where the write landed");
    let previous: Value = serde_json::from_str(&audit.5.expect("previous_value")).unwrap();
    assert_eq!(
        previous,
        json!({"title": "Cross-project target", "label": null, "pinned": false, "status": "active"})
    );
}

/// The grant is read from the source feature's own row. A workspace-level copy
/// of the key is not part of that lookup, so it must confer nothing.
#[tokio::test]
async fn a_grant_on_another_feature_does_not_authorize_this_one() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "paused").await;
    sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (44, ?, 'true')")
        .bind(STEWARD_KEY)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = update_feature(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 44, "pinned": true }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "STEWARD_REQUIRED");
}

#[tokio::test]
async fn stopping_a_session_in_another_project_needs_the_grant() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "running").await;

    let (status, body) = stop_session(&pool, 999).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "STEWARD_REQUIRED");
    // Both workspace write tools journal a refused call.
    let audits = audit_rows(&pool, "workspace_stop_session").await;
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].0, "cadencr-workspace");
    assert_eq!(audits[0].1, "error");
}

#[tokio::test]
async fn a_granted_feature_stops_a_session_in_another_project() {
    let pool = seeded_control_pool().await;
    seed_cross_project_send_target(&pool, "running").await;
    grant_steward(&pool, "true").await;

    let (status, body) = stop_session(&pool, 999).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["targetSessionId"], 999);
    // No connection owns the target in-process, so the interrupt is the normal
    // "nothing was running" no-op — what matters here is that it got that far.
    assert_eq!(body["stopped"], false);
    assert_eq!(body["reason"], "SESSION_NOT_RUNNING");

    let audits = audit_rows(&pool, "workspace_stop_session").await;
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].0, "cadencr-workspace");
    assert_eq!(audits[0].1, "ok");
    assert_eq!(audits[0].2, Some(8));
}

/// The grant widens which sessions may be stopped, not the self-interrupt rule.
#[tokio::test]
async fn a_granted_feature_still_cannot_stop_itself() {
    let pool = seeded_control_pool().await;
    grant_steward(&pool, "true").await;

    let (status, body) = stop_session(&pool, 777).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "CANNOT_STOP_SELF");
}

/// Feature-scoped writes must stay reachable: the workspace endpoint is an
/// addition, not a replacement, and a steward's own project is fair game.
#[tokio::test]
async fn a_granted_feature_can_still_update_a_feature_in_its_own_project() {
    let pool = seeded_control_pool().await;
    grant_steward(&pool, "true").await;

    let (status, body) = update_feature(
        &pool,
        json!({ "source_session_id": 777, "feature_id": 42, "title": "Renamed by steward" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["updated"]["title"], "Renamed by steward");
    let audits = audit_rows(&pool, "workspace_update_feature").await;
    assert_eq!(audits[0].2, Some(7));
}

#[tokio::test]
async fn an_update_with_no_fields_names_the_workspace_tool_in_its_refusal() {
    let pool = seeded_control_pool().await;
    grant_steward(&pool, "true").await;

    let (status, body) =
        update_feature(&pool, json!({ "source_session_id": 777, "feature_id": 42 })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "EMPTY_UPDATE");
    assert!(body["error"]
        .as_str()
        .unwrap()
        .starts_with("workspace_update_feature"));
}
