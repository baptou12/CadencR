//! Integration tests for `GET /api/git/branches` and `GET /api/git/status`.
//! Sibling of `git_workflow_test.rs`; split out to keep each file under the
//! 400-line cap.

mod common;

use common::{git_in, stage_file, start_test_server, write_unstaged};

// ---------------------------------------------------------------------------
// GET /api/git/branches
// ---------------------------------------------------------------------------

#[tokio::test]
async fn branches_returns_local_and_remote() {
    let server = start_test_server().await;
    let repo = server.repo_path();

    // Synthesize a remote-tracking branch so `attached_worktree_path` and
    // `is_local=false` paths are exercised.
    git_in(&repo, &["update-ref", "refs/remotes/origin/main", "HEAD"]);

    let resp = server
        .client
        .get(format!("{}/api/git/branches?project_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let arr = body.as_array().expect("array");
    let names: Vec<&str> = arr.iter().map(|b| b["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"main"), "got: {names:?}");
    assert!(names.contains(&"feature/test-branch"));
    assert!(names.contains(&"origin/main"));

    let main = arr.iter().find(|b| b["name"] == "main").unwrap();
    assert_eq!(main["is_local"], true);
    let remote_main = arr.iter().find(|b| b["name"] == "origin/main").unwrap();
    assert_eq!(remote_main["is_local"], false);
}

#[tokio::test]
async fn branches_attached_worktree_field_is_populated() {
    // A second worktree on `main` makes the registry surface it as attached.
    let server = start_test_server().await;
    let repo = server.repo_path();
    let donor = server.tmp_dir.path().join("donor-wt");
    git_in(&repo, &["worktree", "add", donor.to_str().unwrap(), "main"]);

    let resp = server
        .client
        .get(format!("{}/api/git/branches?project_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    let main = body
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["name"] == "main")
        .unwrap();
    assert!(
        main["attached_worktree_path"].is_string(),
        "main should report a worktree path; got {main}"
    );
}

#[tokio::test]
async fn branches_missing_project_returns_404() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!(
            "{}/api/git/branches?project_id=9999",
            server.base_url
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn branches_missing_param_returns_400() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/git/branches", server.base_url))
        .send()
        .await
        .unwrap();
    // Axum's Query extractor rejects with 400.
    assert_eq!(resp.status(), 400);
}

// ---------------------------------------------------------------------------
// GET /api/git/status
// ---------------------------------------------------------------------------

#[tokio::test]
async fn status_clean_tree() {
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/git/status?feature_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["uncommitted_count"], 0);
    assert_eq!(body["staged_count"], 0);
    assert_eq!(body["unstaged_count"], 0);
    assert_eq!(body["untracked_count"], 0);
    assert_eq!(body["has_remote"], false);
}

#[tokio::test]
async fn status_dirty_tree_counts_staged_and_unstaged() {
    let server = start_test_server().await;
    let repo = server.repo_path();
    stage_file(&repo, "staged.txt", Some("s\n"));
    write_unstaged(&repo, "unstaged.txt", "u\n");

    let resp = server
        .client
        .get(format!("{}/api/git/status?feature_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["uncommitted_count"].as_i64().unwrap() >= 2);
    assert!(body["staged_count"].as_i64().unwrap() >= 1);
    // `unstaged.txt` is untracked, so it lands in untracked_count, not unstaged.
    assert!(body["untracked_count"].as_i64().unwrap() >= 1);
}

#[tokio::test]
async fn status_no_remote() {
    // Default test repo has no remote configured; `ahead_of_remote` falls
    // back to "commits not reachable from any remote" when no upstream
    // exists — that is *every* local commit. We assert `has_remote=false`
    // and `behind_remote=0` (no upstream to be behind of).
    let server = start_test_server().await;
    let resp = server
        .client
        .get(format!("{}/api/git/status?feature_id=1", server.base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["has_remote"], false);
    assert_eq!(body["behind_remote"], 0);
}
