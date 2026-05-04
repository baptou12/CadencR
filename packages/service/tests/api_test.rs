mod common;

use sqlx::sqlite::SqlitePoolOptions;

use common::start_test_server;

#[tokio::test]
async fn test_health_check() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/health", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

/// The OpenAPI count assertion is brittle: every new endpoint forces an
/// update. Switch to explicit lookups for the workflow-overhaul paths so a
/// new endpoint never breaks this test, and a removed one is loud.
#[tokio::test]
async fn test_openapi_includes_workflow_paths() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/openapi.json", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let paths = body["paths"].as_object().expect("paths object");

    let required = [
        "/api/git/branches",
        "/api/git/status",
        "/api/git/uncommitted-files",
        "/api/git/commit",
        "/api/git/push",
        "/api/git/push-input",
        "/api/git/compare-url",
        "/api/features/{id}/target-branch",
    ];
    for path in required {
        assert!(
            paths.contains_key(path),
            "OpenAPI spec missing path {path:?}; have {:?}",
            paths.keys().collect::<Vec<_>>()
        );
    }
}

#[tokio::test]
async fn test_get_branch() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/git/branch?project_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["branch"].is_string());
}

#[tokio::test]
async fn test_list_files() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/git/files?feature_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn test_commit_log() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!(
            "{}/api/git/commit-log?feature_id=1",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["commits"].as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn test_file_content() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!(
            "{}/api/git/file-content?feature_id=1&file_path=test.txt&mode=worktree",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["new_content"].is_string());
}

#[tokio::test]
async fn test_file_content_batch_has_file_path() {
    let server = start_test_server().await;
    let resp = server
        .client
        .post(format!("{}/api/git/file-content-batch", server.base_url))
        .json(&serde_json::json!({
            "feature_id": 1,
            "file_paths": ["test.txt"],
            "mode": "worktree"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let items = body.as_array().unwrap();
    assert!(!items.is_empty());
    for item in items {
        assert!(
            item["file_path"].is_string(),
            "each item should have file_path"
        );
    }
}

#[tokio::test]
async fn test_invalid_project_returns_404() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!(
            "{}/api/git/branch?project_id=9999",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn test_merge_conflicts_no_conflict() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!(
            "{}/api/git/merge-conflicts?project_id=1&feature_id=1",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["has_conflicts"], false);
}

#[tokio::test]
async fn test_file_blob_shas() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!(
            "{}/api/git/file-blob-shas?feature_id=1",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let items = body.as_array().unwrap();
    assert!(!items.is_empty(), "should return file blob shas");
    for item in items {
        assert!(item["sha"].is_string());
        assert!(item["file_path"].is_string());
    }
}

#[tokio::test]
async fn test_snapshot_includes_completed_plan_agent() {
    let server = start_test_server().await;

    server
        .client
        .post(format!("{}/api/features/1/snapshot", server.base_url))
        .send()
        .await
        .ok();

    let tmp_dir_path = format!("{}", server.tmp_dir.path().display());
    let db_path = format!("{}/test.db", tmp_dir_path);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{db_path}"))
        .await
        .unwrap();

    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (1, 1, 'plan', 'completed', '2024-01-01')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (2, 1, 'plan', 'running', '2024-01-02')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (3, 1, 'execute', 'completed', '2024-01-03')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO workflow_queue (id, feature_id, item_type, status, order_index, agent_session_id) VALUES (1, 1, 'execute', 'completed', 0, 3)")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (4, 1, 'unknown_type', 'completed', '2024-01-04')")
        .execute(&pool).await.unwrap();

    pool.close().await;

    let resp = server
        .client
        .get(format!("{}/api/features/1/snapshot", server.base_url))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(status, 200, "snapshot failed: {:?}", body);

    let sessions = body["agent_sessions"].as_array().unwrap();
    assert_eq!(
        sessions.len(),
        3,
        "expected 3 agent sessions, got: {:?}",
        sessions
    );

    let agent_types: Vec<&str> = sessions
        .iter()
        .map(|s| s["agent_type"].as_str().unwrap())
        .collect();
    assert!(agent_types.contains(&"plan"));

    let statuses: Vec<&str> = sessions
        .iter()
        .filter(|s| s["agent_type"].as_str().unwrap() == "plan")
        .map(|s| s["status"].as_str().unwrap())
        .collect();
    assert!(statuses.contains(&"completed"));
    assert!(statuses.contains(&"running"));
}

#[tokio::test]
async fn test_snapshot_does_not_include_phase_states() {
    let server = start_test_server().await;

    let resp = server
        .client
        .get(format!("{}/api/features/1/snapshot", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();

    assert!(
        body.get("phase_states").is_none(),
        "phase_states field should not be present"
    );
}

#[tokio::test]
async fn test_file_tree_includes_dotfiles() {
    let server = start_test_server().await;
    let repo_path = server.repo_path();

    std::fs::write(repo_path.join(".hidden"), "secret\n").unwrap();

    let resp = server
        .client
        .get(format!(
            "{}/api/editor/tree?project_id=1&dir_path=",
            server.base_url,
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let entries = body.as_array().unwrap();
    let names: Vec<&str> = entries
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&".hidden"),
        "dotfiles should be included in file tree, got: {:?}",
        names
    );
    assert!(
        names.contains(&".git"),
        ".git dir should be included in file tree, got: {:?}",
        names
    );
}

/// Full RFC 6455 header set; axum's extractor rejects the request before
/// our handler runs if any are missing.
fn apply_ws_upgrade_headers(req: reqwest::RequestBuilder, origin: &str) -> reqwest::RequestBuilder {
    req.header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
        .header("Origin", origin)
}

#[tokio::test]
async fn test_ws_rejects_cross_origin() {
    let server = start_test_server().await;
    let resp = apply_ws_upgrade_headers(
        server.client.get(format!("{}/ws", server.base_url)),
        "https://evil.example",
    )
    .send()
    .await
    .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_terminal_ws_rejects_cross_origin() {
    let server = start_test_server().await;
    let resp = apply_ws_upgrade_headers(
        server.client.get(format!(
            "{}/api/terminal/ws?feature_id=1&project_id=1",
            server.base_url
        )),
        "https://evil.example",
    )
    .send()
    .await
    .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::FORBIDDEN);
}
