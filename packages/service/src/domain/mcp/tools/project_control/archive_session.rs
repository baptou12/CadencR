use serde_json::json;

use super::{require_i64, require_source_session, McpContext, McpControlClient};

/// The archive scope and cleanup options, relayed as the agent sent them: the
/// service's typed request rejects a wrong type instead of reading it as
/// "not requested".
const OPTION_FIELDS: [&str; 8] = [
    "include_parent",
    "include_descendants",
    "kill_terminals",
    "close_browser_tabs",
    "remove_worktree",
    "remove_branch",
    "force_remove_worktree",
    "force_remove_branch",
];

/// Relay `project_archive_session` to the service: it owns the archive
/// broadcast that refreshes open windows, the shells, the git cleanup, and the
/// bridge to the desktop browser — none of which this subprocess can reach.
pub(crate) async fn archive_session(
    args: &serde_json::Value,
    ctx: &McpContext,
) -> Result<serde_json::Value, String> {
    archive_session_with_client(args, ctx, McpControlClient::from_env()?).await
}

async fn archive_session_with_client(
    args: &serde_json::Value,
    ctx: &McpContext,
    client: McpControlClient,
) -> Result<serde_json::Value, String> {
    let source_session_id = require_source_session(ctx, "project_archive_session")?;
    let session_id = require_i64(args, "session_id")?;
    let mut request = json!({
        "source_feature_id": ctx.feature_id,
        "source_session_id": source_session_id,
        "session_id": session_id,
    });
    for field in OPTION_FIELDS {
        if let Some(value) = args.get(field) {
            request[field] = value.clone();
        }
    }
    client
        .post_json("/internal/mcp/project/archive-session", request)
        .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{extract::State, routing::post, Json, Router};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

    use super::{archive_session_with_client, McpControlClient};
    use crate::domain::mcp::context::McpContext;

    async fn context() -> Arc<McpContext> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        McpContext::new_with_source_session(pool.clone(), pool, 42, Some(777))
    }

    #[tokio::test]
    async fn the_target_and_only_the_given_options_reach_the_control_plane() {
        let captured = Arc::new(Mutex::new(None));
        let app = Router::new()
            .route(
                "/internal/mcp/project/archive-session",
                post(
                    |State(captured): State<Arc<Mutex<Option<serde_json::Value>>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        *captured.lock().await = Some(body);
                        Json(json!({ "archived_feature_ids": [43] }))
                    },
                ),
            )
            .with_state(captured.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = McpControlClient::from_env_values(Some(url), Some("secret".into())).unwrap();

        let result = archive_session_with_client(
            &json!({ "session_id": 900, "remove_branch": true, "kill_terminals": "yes" }),
            &*context().await,
            client,
        )
        .await
        .unwrap();

        assert_eq!(result["archived_feature_ids"][0], 43);
        let request = captured.lock().await.take().unwrap();
        assert_eq!(request["source_feature_id"], 42);
        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["session_id"], 900);
        assert_eq!(request["remove_branch"], true);
        assert_eq!(request["kill_terminals"], "yes");
        assert!(request.get("remove_worktree").is_none());
    }

    #[tokio::test]
    async fn a_missing_target_is_refused_before_any_request() {
        let client =
            McpControlClient::from_env_values(Some("http://127.0.0.1:9".into()), Some("s".into()))
                .unwrap();
        let error = archive_session_with_client(&json!({}), &*context().await, client)
            .await
            .unwrap_err();
        assert!(error.contains("session_id"), "{error}");
    }
}
