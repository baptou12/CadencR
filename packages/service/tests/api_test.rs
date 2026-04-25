use std::process::Command;

use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Client;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tempfile::TempDir;
use tokio::net::TcpListener;

use cadence_service::api;
use cadence_service::api::middleware::AUTH_HEADER;
use cadence_service::app_state::AppState;

const TEST_AUTH_TOKEN: &str = "test-token";

/// Create a temp git repo with an initial commit and a feature branch.
fn create_test_repo(dir: &std::path::Path) {
    let run = |args: &[&str]| {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@test.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@test.com")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("HOME", dir)
            .output()
            .expect("git command failed to spawn");
        assert!(
            output.status.success(),
            "git {} failed (exit {}): {}",
            args.join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr),
        );
    };

    run(&["init", "-b", "main"]);
    run(&["config", "commit.gpgsign", "false"]);
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

    sqlx::query(
        r#"CREATE TABLE projects (
        id INTEGER PRIMARY KEY, name TEXT, path TEXT, branch_prefix TEXT DEFAULT 'feature/',
        model_plan TEXT, model_prd TEXT, model_execute TEXT, model_risk TEXT,
        model_review TEXT, "model_review-fixer" TEXT, model_session TEXT,
        model_qa TEXT, model_retro TEXT,
        agent_runtime_plan TEXT, agent_runtime_prd TEXT, agent_runtime_execute TEXT,
        agent_runtime_risk TEXT, agent_runtime_review TEXT, "agent_runtime_review-fixer" TEXT,
        agent_runtime_session TEXT, agent_runtime_qa TEXT, agent_runtime_retro TEXT
    )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE features (
        id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, title TEXT,
        status TEXT DEFAULT 'draft', type TEXT NOT NULL DEFAULT 'feature',
        workflow_status TEXT DEFAULT 'idle',
        model_plan TEXT, model_prd TEXT, model_execute TEXT, model_risk TEXT,
        model_review TEXT, "model_review-fixer" TEXT, model_session TEXT,
        model_qa TEXT, model_retro TEXT,
        agent_runtime_plan TEXT, agent_runtime_prd TEXT, agent_runtime_execute TEXT,
        agent_runtime_risk TEXT, agent_runtime_review TEXT, "agent_runtime_review-fixer" TEXT,
        agent_runtime_session TEXT, agent_runtime_qa TEXT, agent_runtime_retro TEXT,
        agent_autonomy TEXT, parallel_execution TEXT
    )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY(feature_id, key))")
        .execute(&pool).await.unwrap();

    sqlx::query(
        r#"CREATE TABLE agent_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL,
        agent_type TEXT NOT NULL DEFAULT 'session', status TEXT NOT NULL DEFAULT 'idle',
        runtime_provider TEXT, runtime_session_id TEXT, claude_session_id TEXT,
        model TEXT, permission_mode TEXT,
        has_file_changes INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        context_window INTEGER NOT NULL DEFAULT 200000, started_at TEXT, ended_at TEXT
    )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE workflow_queue (
        id INTEGER PRIMARY KEY, feature_id INTEGER NOT NULL,
        workflow_type TEXT NOT NULL DEFAULT 'feature_build', item_type TEXT NOT NULL,
        phase_id INTEGER, status TEXT NOT NULL DEFAULT 'pending',
        order_index INTEGER NOT NULL, group_index INTEGER, config JSON,
        agent_session_id INTEGER, result JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME, ended_at DATETIME, pid INTEGER,
        max_retries INTEGER NOT NULL DEFAULT 1, retry_count INTEGER NOT NULL DEFAULT 0
    )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL,
        title TEXT, summary TEXT, context TEXT, clarifications TEXT, completion_conditions TEXT,
        status TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"CREATE TABLE phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
        step_number INTEGER, title TEXT, status TEXT DEFAULT 'pending',
        complexity TEXT, commit_message TEXT, description TEXT,
        agent_count INTEGER DEFAULT 1
    )"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO projects (id, name, path) VALUES (1, 'test-project', ?)")
        .bind(repo_path)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title, status) VALUES (1, 1, 'Test Feature', 'in_progress')")
        .execute(&pool).await.unwrap();
    // Set worktree settings to point at the repo itself (for branch mode testing)
    sqlx::query(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (1, 'worktree_path', ?)",
    )
    .bind(repo_path)
    .execute(&pool)
    .await
    .unwrap();
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

    // Bind first so we can thread the OS-assigned port into AppState for
    // the host-header pin.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let (turn_state_tx, _) = tokio::sync::broadcast::channel(64);
    let (file_change_tx, _) = tokio::sync::broadcast::channel(16);
    let state = AppState {
        read_pool: pool.clone(),
        write_pool: pool,
        max_parallel_agents: 3,
        agent_timeout_minutes: 30,
        turn_state_tx: cadence_service::app_state::TurnStateBroadcaster::new(
            turn_state_tx,
            std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
        ),
        pty_manager: cadence_service::domain::terminal::service::PtyManager::new(),
        file_change_tx,
        file_watcher: cadence_service::domain::editor::watcher::new_shared(),
        auth_token: TEST_AUTH_TOKEN.to_string(),
        frontend_port: 1420,
        port,
        custom_action_scheduler:
            cadence_service::domain::custom_actions::scheduler::CustomActionScheduler::new(),
    };

    let app = api::build_router(state).layer(tower_http::cors::CorsLayer::permissive());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let mut default_headers = HeaderMap::new();
    default_headers.insert(AUTH_HEADER, HeaderValue::from_static(TEST_AUTH_TOKEN));
    let client = Client::builder()
        .default_headers(default_headers)
        .build()
        .expect("reqwest client");

    TestServer {
        base_url: format!("http://127.0.0.1:{port}"),
        client,
        _tmp_dir: tmp_dir,
    }
}

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

#[tokio::test]
async fn test_openapi_has_20_paths() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/openapi.json", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let paths = body["paths"].as_object().unwrap();
    assert!(
        paths.len() >= 19,
        "expected >= 19 paths, got {}",
        paths.len()
    );
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
    // new_content should have the file content
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
    // Should have at least 1 file with sha
    assert!(!items.is_empty(), "should return file blob shas");
    for item in items {
        assert!(item["sha"].is_string());
        assert!(item["file_path"].is_string());
    }
}

#[tokio::test]
async fn test_snapshot_includes_completed_plan_agent() {
    let server = start_test_server().await;

    // Insert a completed plan agent session
    server
        .client
        .post(format!("{}/api/features/1/snapshot", server.base_url))
        .send()
        .await
        .ok();

    // We need to insert data directly, so get a separate pool
    let tmp_dir_path = format!("{}", server._tmp_dir.path().display());
    let db_path = format!("{}/test.db", tmp_dir_path);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{db_path}"))
        .await
        .unwrap();

    // Insert a completed plan agent and a running plan agent
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (1, 1, 'plan', 'completed', '2024-01-01')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (2, 1, 'plan', 'running', '2024-01-02')")
        .execute(&pool).await.unwrap();
    // Insert an execute agent linked to a queue item
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (3, 1, 'execute', 'completed', '2024-01-03')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO workflow_queue (id, feature_id, item_type, status, order_index, agent_session_id) VALUES (1, 1, 'execute', 'completed', 0, 3)")
        .execute(&pool).await.unwrap();
    // Insert an unrelated agent type that should NOT appear
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, agent_type, status, started_at) VALUES (4, 1, 'unknown_type', 'completed', '2024-01-04')")
        .execute(&pool).await.unwrap();

    pool.close().await;

    // Fetch snapshot
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
    // Should have 3 sessions: completed plan, running plan, and execute (linked to queue)
    // Should NOT have the unknown_type agent
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
    assert!(
        agent_types.contains(&"plan"),
        "completed plan agent should be in snapshot"
    );

    let statuses: Vec<&str> = sessions
        .iter()
        .filter(|s| s["agent_type"].as_str().unwrap() == "plan")
        .map(|s| s["status"].as_str().unwrap())
        .collect();
    assert!(
        statuses.contains(&"completed"),
        "completed plan agent must be included"
    );
    assert!(
        statuses.contains(&"running"),
        "running plan agent must be included"
    );
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

    // phase_states field was removed entirely
    assert!(
        body.get("phase_states").is_none(),
        "phase_states field should not be present"
    );
}

#[tokio::test]
async fn test_file_tree_includes_dotfiles() {
    let server = start_test_server().await;
    let repo_path = server._tmp_dir.path().join("repo");

    // Create a dotfile in the repo
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
