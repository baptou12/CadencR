use serde_json::json;

use super::{require_source_session, McpContext, McpControlClient};
use crate::domain::mcp::tools::helpers::require_i64;
use crate::domain::mcp::write_scope::WriteScope;

pub(crate) async fn stop_session(
    args: &serde_json::Value,
    ctx: &McpContext,
) -> Result<serde_json::Value, String> {
    stop_session_with_client(
        args,
        ctx,
        McpControlClient::from_env()?,
        WriteScope::Project,
    )
    .await
}

/// The `cadencr-workspace` twin: same payload, cross-project endpoint. The
/// Steward grant is checked by the control plane, not here — the tool has no
/// business deciding its own authority.
pub(crate) async fn stop_workspace_session(
    args: &serde_json::Value,
    ctx: &McpContext,
) -> Result<serde_json::Value, String> {
    stop_session_with_client(
        args,
        ctx,
        McpControlClient::from_env()?,
        WriteScope::Workspace,
    )
    .await
}

async fn stop_session_with_client(
    args: &serde_json::Value,
    ctx: &McpContext,
    client: McpControlClient,
    scope: WriteScope,
) -> Result<serde_json::Value, String> {
    let source_session_id = require_source_session(ctx, scope.stop_session_tool())?;
    let target_session_id = require_i64(args, "target_session_id")?;
    client
        .post_json(
            scope.stop_session_endpoint(),
            json!({
                "source_session_id": source_session_id,
                "target_session_id": target_session_id
            }),
        )
        .await
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;
    use std::sync::Arc;

    use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

    use crate::api::middleware::MCP_CONTROL_HEADER;
    use crate::domain::mcp::context::McpContext;
    use crate::domain::mcp::write_scope::WriteScope;

    use super::{stop_session_with_client, McpControlClient};

    #[tokio::test]
    async fn stop_session_posts_source_and_target_to_control_plane() {
        let captured = Arc::new(Mutex::new(None));
        let url = spawn_stop_route(
            WriteScope::Project,
            json!({ "stopped": true, "targetSessionId": 888 }),
            captured.clone(),
        )
        .await;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let ctx = McpContext::new_with_source_session(pool.clone(), pool, 42, Some(777));
        let client = McpControlClient::from_env_values(Some(url), Some("secret".to_string()))
            .expect("control client");

        let result = stop_session_with_client(
            &json!({ "target_session_id": 888 }),
            &ctx,
            client,
            WriteScope::Project,
        )
        .await
        .expect("stop session result");

        assert_eq!(result["stopped"], true);
        let request = captured.lock().await.take().expect("captured request");
        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["target_session_id"], 888);
    }

    /// The workspace tool must reach the workspace endpoint — posting to the
    /// project one would silently skip the Steward check and refuse every
    /// cross-project target.
    #[tokio::test]
    async fn the_workspace_variant_posts_to_the_workspace_endpoint() {
        let captured = Arc::new(Mutex::new(None));
        let url = spawn_stop_route(
            WriteScope::Workspace,
            json!({ "stopped": true, "targetSessionId": 999 }),
            captured.clone(),
        )
        .await;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let ctx = McpContext::new_with_source_session(pool.clone(), pool, 42, Some(777));
        let client = McpControlClient::from_env_values(Some(url), Some("secret".to_string()))
            .expect("control client");

        stop_session_with_client(
            &json!({ "target_session_id": 999 }),
            &ctx,
            client,
            WriteScope::Workspace,
        )
        .await
        .expect("workspace stop result");

        let request = captured.lock().await.take().expect("captured request");
        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["target_session_id"], 999);
    }

    #[tokio::test]
    async fn stop_session_requires_a_target_session_id() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let ctx = McpContext::new_with_source_session(pool.clone(), pool, 42, Some(777));
        let client = McpControlClient::from_env_values(
            Some("http://127.0.0.1:1".to_string()),
            Some("s".into()),
        )
        .expect("control client");

        let error = stop_session_with_client(&json!({}), &ctx, client, WriteScope::Project)
            .await
            .unwrap_err();

        assert!(
            error.contains("target_session_id"),
            "unexpected error: {error}"
        );
    }

    async fn spawn_stop_route(
        scope: WriteScope,
        response: serde_json::Value,
        captured: Arc<Mutex<Option<serde_json::Value>>>,
    ) -> String {
        async fn handler(
            State((response, captured)): State<(
                serde_json::Value,
                Arc<Mutex<Option<serde_json::Value>>>,
            )>,
            headers: HeaderMap,
            Json(body): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            assert_eq!(headers.get(MCP_CONTROL_HEADER).unwrap(), "secret");
            *captured.lock().await = Some(body);
            Json(response)
        }
        let app = Router::new()
            .route(scope.stop_session_endpoint(), post(handler))
            .with_state((response, captured));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address: SocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{address}")
    }
}
