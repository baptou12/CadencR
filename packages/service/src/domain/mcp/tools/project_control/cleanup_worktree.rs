use serde_json::{json, Value};

use super::{require_source_session, McpContext, McpControlClient};
use crate::domain::mcp::tools::helpers::require_i64;

pub(crate) async fn cleanup_worktree(args: &Value, ctx: &McpContext) -> Result<Value, String> {
    cleanup_worktree_with_client(args, ctx, McpControlClient::from_env()?).await
}

async fn cleanup_worktree_with_client(
    args: &Value,
    ctx: &McpContext,
    client: McpControlClient,
) -> Result<Value, String> {
    let source_session_id = require_source_session(ctx, "project_cleanup_worktree")?;
    let feature_id = require_i64(args, "feature_id")?;
    // Not idempotent-retried: in Default access mode the call parks on a human
    // approval, and a retry would raise a second prompt for the same removal.
    client
        .post_json(
            "/internal/mcp/project/cleanup-worktree",
            json!({
                "source_session_id": source_session_id,
                "feature_id": feature_id
            }),
        )
        .await
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;
    use std::sync::Arc;

    use axum::{extract::State, routing::post, Json, Router};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

    use crate::domain::mcp::context::McpContext;

    use super::{cleanup_worktree_with_client, McpControlClient};

    async fn in_memory_context(source_session_id: Option<i64>) -> Arc<McpContext> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        McpContext::new_with_source_session(pool.clone(), pool, 42, source_session_id)
    }

    #[tokio::test]
    async fn the_caller_session_and_target_feature_are_forwarded() {
        let captured = Arc::new(Mutex::new(None));
        let state = captured.clone();
        let app = Router::new()
            .route(
                "/internal/mcp/project/cleanup-worktree",
                post(
                    |State(captured): State<Arc<Mutex<Option<serde_json::Value>>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        *captured.lock().await = Some(body);
                        Json(json!({"removed": true, "branch": "feature/x"}))
                    },
                ),
            )
            .with_state(state);
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = McpControlClient::from_env_values(
            Some(format!("http://{address}")),
            Some("secret".to_string()),
        )
        .expect("control client");

        let result = cleanup_worktree_with_client(
            &json!({ "feature_id": 43 }),
            &*in_memory_context(Some(777)).await,
            client,
        )
        .await
        .expect("cleanup result");

        assert_eq!(result["removed"], true);
        let request = captured.lock().await.take().expect("captured request");
        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["feature_id"], 43);
    }

    #[tokio::test]
    async fn a_missing_source_session_is_reported_before_any_request() {
        let client =
            McpControlClient::from_env_values(Some("http://127.0.0.1:1".into()), Some("s".into()))
                .unwrap();

        let error = cleanup_worktree_with_client(
            &json!({ "feature_id": 43 }),
            &*in_memory_context(None).await,
            client,
        )
        .await
        .unwrap_err();

        assert!(error.contains("project_cleanup_worktree requires a source session id"));
    }

    #[tokio::test]
    async fn a_missing_feature_id_is_reported_before_any_request() {
        let client =
            McpControlClient::from_env_values(Some("http://127.0.0.1:1".into()), Some("s".into()))
                .unwrap();

        let error =
            cleanup_worktree_with_client(&json!({}), &*in_memory_context(Some(777)).await, client)
                .await
                .unwrap_err();

        assert!(error.contains("feature_id"));
    }
}
