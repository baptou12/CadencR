use std::process::Command;

use reqwest::Client;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tempfile::TempDir;
use tokio::net::TcpListener;

use cadence_service::api;
use cadence_service::app_state::AppState;

/// Create a temp git repo with an initial commit and a feature branch.
fn create_test_repo(dir: &std::path::Path) {
    let run = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@test.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@test.com")
            .output()
            .expect("git command failed");
    };

    run(&["init", "-b", "main"]);
    std::fs::write(dir.join("README.md"), "# Test\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-m", "initial commit"]);
    run(&["checkout", "-b", "feature/test-branch"]);
    std::fs::write(dir.join("test.txt"), "hello world\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-m", "add test file"]);
}

async fn setup_test_db(db_path: &str, repo_path: &str) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{db_path}?mode=rwc"))
        .await
        .unwrap();

    sqlx::query("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, path TEXT, branch_prefix TEXT DEFAULT 'feature/')")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT, status TEXT DEFAULT 'draft', type TEXT NOT NULL DEFAULT 'feature')")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(feature_id, key))")
        .execute(&pool).await.unwrap();

    sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'test-project', ?)")
        .bind(repo_path)
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title, status) VALUES (1, 1, 'Test Feature', 'in_progress')")
        .execute(&pool).await.unwrap();
    // Set worktree settings to point at the repo itself (for branch mode testing)
    sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (1, 'worktree_path', ?)")
        .bind(repo_path)
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (1, 'worktree_branch', 'feature/test-branch')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (1, 'worktree_original_branch', 'main')")
        .execute(&pool).await.unwrap();

    pool
}

struct TestServer {
    base_url: String,
    client: Client,
    _tmp_dir: TempDir,
}

async fn start_test_server() -> TestServer {
    let tmp_dir = TempDir::new().unwrap();
    let repo_path = tmp_dir.path().join("repo");
    std::fs::create_dir_all(&repo_path).unwrap();
    create_test_repo(&repo_path);

    let db_path = tmp_dir.path().join("test.db");
    let db_path_str = db_path.to_string_lossy().to_string();
    let repo_path_str = repo_path.to_string_lossy().to_string();

    let pool = setup_test_db(&db_path_str, &repo_path_str).await;

    let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);
    let state = AppState {
        read_pool: pool.clone(),
        write_pool: pool,
        electron_port: 45679,
        max_parallel_agents: 3,
        agent_timeout_minutes: 30,
        turn_state_tx,
    };

    let app = api::build_router(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    TestServer {
        base_url: format!("http://127.0.0.1:{port}"),
        client: Client::new(),
        _tmp_dir: tmp_dir,
    }
}

#[tokio::test]
async fn test_health_check() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/health", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn test_openapi_has_20_paths() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/openapi.json", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let paths = body["paths"].as_object().unwrap();
    assert!(paths.len() >= 20, "expected >= 20 paths, got {}", paths.len());
}

#[tokio::test]
async fn test_get_branch() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/git/branch?project_id=1", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["branch"].is_string());
}

#[tokio::test]
async fn test_list_files() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/git/files?feature_id=1", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn test_commit_log() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/git/commit-log?feature_id=1", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["commits"].as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn test_file_content() {
    let server = start_test_server().await;
    let resp = server.client.get(format!(
        "{}/api/git/file-content?feature_id=1&file_path=test.txt&mode=worktree",
        server.base_url
    )).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    // new_content should have the file content
    assert!(body["new_content"].is_string());
}

#[tokio::test]
async fn test_file_content_batch_has_file_path() {
    let server = start_test_server().await;
    let resp = server.client.post(format!("{}/api/git/file-content-batch", server.base_url))
        .json(&serde_json::json!({
            "feature_id": 1,
            "file_paths": ["test.txt"],
            "mode": "worktree"
        }))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let items = body.as_array().unwrap();
    assert!(!items.is_empty());
    for item in items {
        assert!(item["file_path"].is_string(), "each item should have file_path");
    }
}

#[tokio::test]
async fn test_invalid_project_returns_404() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/git/branch?project_id=9999", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn test_merge_conflicts_no_conflict() {
    let server = start_test_server().await;
    let resp = server.client.get(format!(
        "{}/api/git/merge-conflicts?project_id=1&feature_id=1",
        server.base_url
    )).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["has_conflicts"], false);
}

#[tokio::test]
async fn test_file_blob_shas() {
    let server = start_test_server().await;
    let resp = server.client.get(format!("{}/api/git/file-blob-shas?feature_id=1", server.base_url))
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let items = body.as_array().unwrap();
    // Should have at least 1 file with sha
    assert!(!items.is_empty(), "should return file blob shas");
    for item in items {
        assert!(item["sha"].is_string());
        assert!(item["file_path"].is_string());
    }
}
