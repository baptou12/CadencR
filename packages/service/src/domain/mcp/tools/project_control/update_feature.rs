use serde_json::{json, Value};

use super::{require_source_session, McpContext, McpControlClient};
use crate::domain::mcp::tools::helpers::require_i64;
use crate::domain::mcp::write_scope::WriteScope;

/// Fields the control plane treats as "left alone" when the key is absent. They
/// are forwarded verbatim so an explicit `label: null` (clear) stays
/// distinguishable from an omitted label (unchanged).
const OPTIONAL_FIELDS: [&str; 4] = ["title", "label", "pinned", "status"];

pub(crate) async fn update_feature(
    args: &Value,
    ctx: &McpContext,
) -> Result<serde_json::Value, String> {
    update_feature_with_client(
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
pub(crate) async fn update_workspace_feature(
    args: &Value,
    ctx: &McpContext,
) -> Result<serde_json::Value, String> {
    update_feature_with_client(
        args,
        ctx,
        McpControlClient::from_env()?,
        WriteScope::Workspace,
    )
    .await
}

async fn update_feature_with_client(
    args: &Value,
    ctx: &McpContext,
    client: McpControlClient,
    scope: WriteScope,
) -> Result<serde_json::Value, String> {
    let source_session_id = require_source_session(ctx, scope.update_feature_tool())?;
    let feature_id = require_i64(args, "feature_id")?;
    let mut body = json!({
        "source_session_id": source_session_id,
        "feature_id": feature_id
    });
    let object = body.as_object_mut().expect("request body is an object");
    for field in OPTIONAL_FIELDS {
        if let Some(value) = args.get(field) {
            object.insert(field.to_string(), value.clone());
        }
    }
    // Not idempotent-retried: a replay would snapshot the already-updated row
    // and hand the agent a `previous` block that cannot undo anything.
    client
        .post_json(scope.update_feature_endpoint(), body)
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

    use crate::domain::mcp::context::McpContext;
    use crate::domain::mcp::write_scope::WriteScope;

    use super::{update_feature_with_client, McpControlClient};

    async fn capture_update_request(args: serde_json::Value) -> serde_json::Value {
        capture_request_for(args, WriteScope::Project).await
    }

    async fn capture_request_for(args: serde_json::Value, scope: WriteScope) -> serde_json::Value {
        let captured = Arc::new(Mutex::new(None));
        let state = captured.clone();
        let app = Router::new()
            .route(
                scope.update_feature_endpoint(),
                post(
                    |State(captured): State<Arc<Mutex<Option<serde_json::Value>>>>,
                     _headers: HeaderMap,
                     Json(body): Json<serde_json::Value>| async move {
                        *captured.lock().await = Some(body);
                        Json(json!({"updated": {}, "previous": {}}))
                    },
                ),
            )
            .with_state(state);
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let ctx = McpContext::new_with_source_session(pool.clone(), pool, 42, Some(777));
        let client = McpControlClient::from_env_values(
            Some(format!("http://{address}")),
            Some("secret".to_string()),
        )
        .expect("control client");

        update_feature_with_client(&args, &ctx, client, scope)
            .await
            .expect("update result");
        let request = captured.lock().await.take();
        request.expect("captured request")
    }

    #[tokio::test]
    async fn only_the_fields_the_caller_set_are_forwarded() {
        let request = capture_update_request(json!({
            "feature_id": 43,
            "title": "Login flake",
            "status": "archived"
        }))
        .await;

        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["feature_id"], 43);
        assert_eq!(request["title"], "Login flake");
        assert_eq!(request["status"], "archived");
        assert!(!request.as_object().unwrap().contains_key("label"));
        assert!(!request.as_object().unwrap().contains_key("pinned"));
    }

    #[tokio::test]
    async fn an_explicit_null_label_survives_as_null_instead_of_being_dropped() {
        let request = capture_update_request(json!({ "feature_id": 43, "label": null })).await;

        assert!(request.as_object().unwrap().contains_key("label"));
        assert!(request["label"].is_null());
    }

    #[tokio::test]
    async fn a_missing_source_session_is_reported_before_any_request() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let ctx = McpContext::new_with_source_session(pool.clone(), pool, 42, None);
        let client = McpControlClient::from_env_values(
            Some("http://127.0.0.1:1".to_string()),
            Some("s".into()),
        )
        .unwrap();

        let error = super::update_feature_with_client(
            &json!({"feature_id": 43}),
            &ctx,
            client,
            WriteScope::Project,
        )
        .await
        .unwrap_err();

        assert!(error.contains("project_update_feature requires a source session id"));
    }

    /// The workspace tool must reach the workspace endpoint — posting to the
    /// project one would silently skip the Steward check and the cross-project
    /// target lookup.
    #[tokio::test]
    async fn the_workspace_variant_posts_to_the_workspace_endpoint() {
        let request = capture_request_for(
            json!({ "feature_id": 44, "status": "archived" }),
            WriteScope::Workspace,
        )
        .await;

        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["feature_id"], 44);
        assert_eq!(request["status"], "archived");
    }
}
