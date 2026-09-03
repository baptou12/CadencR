//! `project_cleanup_worktree` end-to-end through `control_router()`, against a
//! real git repo and a real linked worktree.

mod common;

use std::path::{Path, PathBuf};

use axum::{body::Body, http::Request, http::StatusCode};
use cadencr_service::app_state::AppState;
use cadencr_service::domain::mcp::control::approval_registry::ApprovalOutcome;
use cadencr_service::domain::mcp::control::control_router;
use cadencr_service::shared::migrate::{run_migrations, MigrationContext};
use sqlx::SqlitePool;
use tempfile::TempDir;
use tower::ServiceExt;

use common::{git_capture, git_in};

const SOURCE_SESSION: i64 = 777;
const TARGET_FEATURE: i64 = 43;

struct Fixture {
    _tmp: TempDir,
    project: PathBuf,
    worktree: PathBuf,
    pool: SqlitePool,
    state: AppState,
}

impl Fixture {
    fn app(&self) -> axum::Router {
        control_router().with_state(self.state.clone())
    }

    fn worktree_exists(&self) -> bool {
        self.worktree.exists()
    }
}

/// `merged` picks whether the feature branch was merged into `main` before the
/// worktree was created — the only difference between the happy path and the
/// `BRANCH_NOT_MERGED` refusal.
async fn fixture(access_mode: &str, merged: bool) -> Fixture {
    let tmp = TempDir::new().unwrap();
    let project = tmp.path().join("project");
    let worktree = tmp.path().join("wt");
    std::fs::create_dir_all(&project).unwrap();
    build_repo(&project, merged);
    git_in(
        &project,
        &[
            "worktree",
            "add",
            worktree.to_str().unwrap(),
            "feature/test-branch",
        ],
    );

    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    run_migrations(&MigrationContext {
        pool: &pool,
        db_path: None,
        app_version: None,
    })
    .await
    .unwrap();
    seed(&pool, &project, &worktree, access_mode).await;

    let state = AppState::with_pool(pool.clone());
    Fixture {
        _tmp: tmp,
        project,
        worktree,
        pool,
        state,
    }
}

fn build_repo(project: &Path, merged: bool) {
    git_in(project, &["init", "-b", "main"]);
    git_in(project, &["config", "user.email", "test@test.com"]);
    git_in(project, &["config", "user.name", "Test"]);
    git_in(project, &["config", "commit.gpgsign", "false"]);
    std::fs::write(project.join("README.md"), "# Test\n").unwrap();
    git_in(project, &["add", "."]);
    git_in(project, &["commit", "-m", "initial commit"]);
    git_in(project, &["checkout", "-b", "feature/test-branch"]);
    std::fs::write(project.join("feature.txt"), "work\n").unwrap();
    git_in(project, &["add", "."]);
    git_in(project, &["commit", "-m", "feature work"]);
    git_in(project, &["checkout", "main"]);
    if merged {
        git_in(
            project,
            &["merge", "--no-ff", "feature/test-branch", "-m", "merge"],
        );
    }
}

async fn seed(pool: &SqlitePool, project: &Path, worktree: &Path, access_mode: &str) {
    sqlx::query("INSERT INTO projects (id, name, path) VALUES (7, 'Proj', ?)")
        .bind(project.to_string_lossy().to_string())
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO features (id, project_id, title, status, type)
         VALUES (42, 7, 'Source', 'active', 'ws-session'),
                (43, 7, 'Target', 'active', 'ws-session')",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_sessions (id, feature_id, agent_type, status, runtime_provider, codex_permission_mode)
         VALUES (777, 42, 'session', 'running', 'codex_cli', ?)",
    )
    .bind(access_mode)
    .execute(pool)
    .await
    .unwrap();
    for (key, value) in [
        ("worktree_path", worktree.to_string_lossy().to_string()),
        ("worktree_branch", "feature/test-branch".to_string()),
        ("target_branch", "main".to_string()),
    ] {
        sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (43, ?, ?)")
            .bind(key)
            .bind(value)
            .execute(pool)
            .await
            .unwrap();
    }
}

fn cleanup_request(feature_id: i64) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/internal/mcp/project/cleanup-worktree")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "source_session_id": SOURCE_SESSION,
                "feature_id": feature_id
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

async fn audit_row(pool: &SqlitePool) -> (String, Option<String>) {
    sqlx::query_as(
        "SELECT status, previous_value FROM mcp_tool_audit_log
         WHERE tool_name = 'project_cleanup_worktree'",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Poll until the blocked call has persisted its gate, so the test answers a
/// real gate rather than racing the handler.
async fn await_pending_gate(pool: &SqlitePool) -> String {
    for _ in 0..200 {
        let pending: Option<String> =
            sqlx::query_scalar("SELECT pending_permission FROM agent_sessions WHERE id = 777")
                .fetch_one(pool)
                .await
                .unwrap();
        if let Some(pending) = pending {
            let payload: serde_json::Value = serde_json::from_str(&pending).unwrap();
            return payload["request_id"].as_str().unwrap().to_string();
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("no approval gate was raised");
}

#[tokio::test]
async fn full_access_removes_the_worktree_without_asking() {
    let fixture = fixture("fullAccess", true).await;
    assert!(fixture.worktree_exists());

    let response = fixture
        .app()
        .oneshot(cleanup_request(TARGET_FEATURE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["removed"], true);
    assert_eq!(body["branch"], "feature/test-branch");
    assert_eq!(
        body["worktree_path"],
        fixture.worktree.to_string_lossy().to_string()
    );
    assert!(!fixture.worktree_exists());
    // The safe path drops the worktree, never the branch.
    assert!(git_capture(
        &fixture.project,
        &["branch", "--list", "feature/test-branch"]
    )
    .contains("feature/test-branch"));
    // No gate was raised.
    let pending: Option<String> =
        sqlx::query_scalar("SELECT pending_permission FROM agent_sessions WHERE id = 777")
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert!(pending.is_none());

    let (status, previous) = audit_row(&fixture.pool).await;
    assert_eq!(status, "ok");
    let previous: serde_json::Value = serde_json::from_str(&previous.unwrap()).unwrap();
    assert_eq!(previous["branch"], "feature/test-branch");
    assert!(previous["head_sha"].as_str().unwrap().len() >= 7);
}

#[tokio::test]
async fn default_mode_blocks_on_an_approval_that_then_removes_the_worktree() {
    let fixture = fixture("default", true).await;
    let (pool, state) = (fixture.pool.clone(), fixture.state.clone());
    let app = fixture.app();

    let call = tokio::spawn(async move { app.oneshot(cleanup_request(TARGET_FEATURE)).await });

    let request_id = await_pending_gate(&pool).await;
    assert!(
        fixture.worktree_exists(),
        "nothing is removed before the answer"
    );
    state
        .tool_approvals
        .take(SOURCE_SESSION, &request_id)
        .await
        .expect("the raised gate parked a waiter")
        .send(ApprovalOutcome::Approved)
        .unwrap();

    let body = json_body(call.await.unwrap().unwrap()).await;
    assert_eq!(body["removed"], true);
    assert!(!fixture.worktree_exists());
}

#[tokio::test]
async fn a_denied_approval_keeps_the_worktree_and_reports_it_as_success() {
    let fixture = fixture("default", true).await;
    let (pool, state) = (fixture.pool.clone(), fixture.state.clone());
    let app = fixture.app();

    let call = tokio::spawn(async move { app.oneshot(cleanup_request(TARGET_FEATURE)).await });

    let request_id = await_pending_gate(&pool).await;
    state
        .tool_approvals
        .take(SOURCE_SESSION, &request_id)
        .await
        .unwrap()
        .send(ApprovalOutcome::Denied {
            feedback: Some("still reviewing".to_string()),
        })
        .unwrap();

    let response = call.await.unwrap().unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["removed"], false);
    assert_eq!(body["reason"], "DENIED");
    assert_eq!(body["feedback"], "still reviewing");
    assert!(fixture.worktree_exists());
}

#[tokio::test]
async fn a_dirty_worktree_is_refused_before_anything_is_asked() {
    let fixture = fixture("default", true).await;
    std::fs::write(fixture.worktree.join("scratch.txt"), "wip\n").unwrap();

    let response = fixture
        .app()
        .oneshot(cleanup_request(TARGET_FEATURE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(response).await["code"], "WORKTREE_DIRTY");
    assert!(fixture.worktree_exists());
    let (status, _) = audit_row(&fixture.pool).await;
    assert_eq!(status, "error");
}

#[tokio::test]
async fn an_unmerged_branch_is_refused() {
    let fixture = fixture("fullAccess", false).await;

    let response = fixture
        .app()
        .oneshot(cleanup_request(TARGET_FEATURE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(response).await["code"], "BRANCH_NOT_MERGED");
    assert!(fixture.worktree_exists());
}

#[tokio::test]
async fn a_feature_in_another_project_is_not_found() {
    let fixture = fixture("fullAccess", true).await;
    sqlx::query(
        "INSERT INTO projects (id, name, path) VALUES (8, 'Other', '/tmp/other');
         INSERT INTO features (id, project_id, title, status, type)
         VALUES (44, 8, 'Elsewhere', 'active', 'ws-session')",
    )
    .execute(&fixture.pool)
    .await
    .unwrap();

    let response = fixture.app().oneshot(cleanup_request(44)).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(fixture.worktree_exists());
}

#[tokio::test]
async fn a_feature_without_a_worktree_is_not_found() {
    let fixture = fixture("fullAccess", true).await;
    sqlx::query("DELETE FROM feature_settings WHERE feature_id = 43 AND key = 'worktree_path'")
        .execute(&fixture.pool)
        .await
        .unwrap();

    let response = fixture
        .app()
        .oneshot(cleanup_request(TARGET_FEATURE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// The carve-out: a linked parent agent may answer every other gate kind, but
/// never a removal the user was asked to confirm.
#[tokio::test]
async fn a_parent_agent_cannot_answer_the_approval_gate() {
    let fixture = fixture("default", true).await;
    let (pool, state) = (fixture.pool.clone(), fixture.state.clone());
    sqlx::query(
        "INSERT INTO features (id, project_id, title, status, type)
         VALUES (45, 7, 'Parent', 'active', 'ws-session');
         INSERT INTO agent_sessions (id, feature_id, agent_type, status)
         VALUES (555, 45, 'session', 'running');
         INSERT INTO agent_session_links (source_session_id, target_session_id, link_type)
         VALUES (555, 777, 'spawned')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let app = fixture.app();
    let call = tokio::spawn(async move { app.oneshot(cleanup_request(TARGET_FEATURE)).await });
    let request_id = await_pending_gate(&pool).await;

    let response = control_router()
        .with_state(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/mcp/project/respond-gate")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "source_session_id": 555,
                        "session_id": SOURCE_SESSION,
                        "request_id": request_id,
                        "decision": { "type": "permission", "action": "allow_once" }
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_body(response).await["code"], "HUMAN_APPROVAL_REQUIRED");
    assert!(fixture.worktree_exists());

    // Release the still-blocked call so the test does not sit on the timeout.
    state
        .tool_approvals
        .take(SOURCE_SESSION, &request_id)
        .await
        .unwrap()
        .send(ApprovalOutcome::Denied { feedback: None })
        .unwrap();
    let body = json_body(call.await.unwrap().unwrap()).await;
    assert_eq!(body["removed"], false);
}
