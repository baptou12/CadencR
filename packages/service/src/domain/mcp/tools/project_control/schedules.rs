use serde_json::{json, Value};

use super::{optional_i64, optional_string, require_source_session, McpControlClient};
use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::helpers::require_i64;

const LIST_ENDPOINT: &str = "/internal/mcp/project/schedule/list";
const SAVE_ENDPOINT: &str = "/internal/mcp/project/schedule/save";
const SET_ENABLED_ENDPOINT: &str = "/internal/mcp/project/schedule/set-enabled";
const RUN_ENDPOINT: &str = "/internal/mcp/project/schedule/run";

pub(crate) async fn list_schedules(args: &Value, ctx: &McpContext) -> Result<Value, String> {
    let source_session_id = require_source_session(ctx, "project_list_schedules")?;
    McpControlClient::from_env()?
        .post_json(
            LIST_ENDPOINT,
            json!({
                "source_session_id": source_session_id,
                "limit": optional_i64(args, "limit")
            }),
        )
        .await
}

pub(crate) async fn save_schedule(args: &Value, ctx: &McpContext) -> Result<Value, String> {
    save_schedule_with_client(args, ctx, McpControlClient::from_env()?).await
}

pub(crate) async fn set_schedule_enabled(args: &Value, ctx: &McpContext) -> Result<Value, String> {
    let source_session_id = require_source_session(ctx, "project_set_schedule_enabled")?;
    let schedule_id = require_i64(args, "schedule_id")?;
    let enabled = required_bool(args, "enabled")?;
    McpControlClient::from_env()?
        .post_json(
            SET_ENABLED_ENDPOINT,
            json!({
                "source_session_id": source_session_id,
                "schedule_id": schedule_id,
                "enabled": enabled
            }),
        )
        .await
}

pub(crate) async fn run_schedule(args: &Value, ctx: &McpContext) -> Result<Value, String> {
    let source_session_id = require_source_session(ctx, "project_run_schedule")?;
    let schedule_id = require_i64(args, "schedule_id")?;
    // Deliberately not retried: a manual run delivers a real message, so a
    // retried request would send it twice.
    McpControlClient::from_env()?
        .post_json(
            RUN_ENDPOINT,
            json!({
                "source_session_id": source_session_id,
                "schedule_id": schedule_id
            }),
        )
        .await
}

async fn save_schedule_with_client(
    args: &Value,
    ctx: &McpContext,
    client: McpControlClient,
) -> Result<Value, String> {
    let source_session_id = require_source_session(ctx, "project_save_schedule")?;
    // Mirrored from the control plane so an agent that forgot to decide is told
    // here, before a round trip, and always sees the same refusal.
    let enabled = required_bool(args, "enabled")?;
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing required parameter: prompt".to_string())?;
    let target = required_object(args, "target")?;
    let recurrence = required_object(args, "recurrence")?;
    client
        .post_json(
            SAVE_ENDPOINT,
            json!({
                "source_session_id": source_session_id,
                "schedule_id": optional_i64(args, "schedule_id"),
                "name": optional_string(args, "name"),
                "prompt": prompt,
                "target": target,
                "recurrence": recurrence,
                "enabled": enabled
            }),
        )
        .await
}

fn required_bool(args: &Value, key: &str) -> Result<bool, String> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("Missing required parameter: {key} (pass true or false explicitly)"))
}

fn required_object(args: &Value, key: &str) -> Result<Value, String> {
    args.get(key)
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| format!("Missing required parameter: {key}"))
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

    use super::{save_schedule_with_client, McpControlClient, SAVE_ENDPOINT};

    async fn test_ctx() -> Arc<McpContext> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        McpContext::new_with_source_session(pool.clone(), pool, 42, Some(777))
    }

    async fn spawn_save_route(captured: Arc<Mutex<Option<serde_json::Value>>>) -> String {
        async fn handler(
            State(captured): State<Arc<Mutex<Option<serde_json::Value>>>>,
            Json(body): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            *captured.lock().await = Some(body);
            Json(json!({ "id": 5, "enabled": true, "next_run_at": "2026-09-03T09:00:00Z" }))
        }
        let app = Router::new()
            .route(SAVE_ENDPOINT, post(handler))
            .with_state(captured);
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn save_forwards_the_caller_and_the_explicit_enabled_flag() {
        let captured = Arc::new(Mutex::new(None));
        let url = spawn_save_route(captured.clone()).await;
        let client =
            McpControlClient::from_env_values(Some(url), Some("secret".into())).expect("client");
        let ctx = test_ctx().await;

        let result = save_schedule_with_client(
            &json!({
                "name": "Re-check CI",
                "prompt": "check whether the pipeline is green",
                "enabled": false,
                "target": { "kind": "new_conversation" },
                "recurrence": { "kind": "once", "run_at": "2026-09-03T09:00:00Z" }
            }),
            &ctx,
            client,
        )
        .await
        .expect("save result");

        assert_eq!(result["id"], 5);
        let request = captured.lock().await.take().expect("captured request");
        assert_eq!(request["source_session_id"], 777);
        assert_eq!(request["name"], "Re-check CI");
        assert_eq!(request["enabled"], false);
        assert_eq!(request["target"]["kind"], "new_conversation");
        assert_eq!(request["recurrence"]["kind"], "once");
        // Absent means create; the control plane must not see a stray id.
        assert!(request["schedule_id"].is_null());
    }

    // The refusal happens before any request is sent, so a forgetful agent
    // never creates a schedule it did not mean to arm.
    #[tokio::test]
    async fn save_refuses_to_post_without_an_explicit_enabled_flag() {
        let captured = Arc::new(Mutex::new(None));
        let url = spawn_save_route(captured.clone()).await;
        let client =
            McpControlClient::from_env_values(Some(url), Some("secret".into())).expect("client");
        let ctx = test_ctx().await;

        let error = save_schedule_with_client(
            &json!({
                "prompt": "check whether the pipeline is green",
                "target": { "kind": "new_conversation" },
                "recurrence": { "kind": "once", "run_at": "2026-09-03T09:00:00Z" }
            }),
            &ctx,
            client,
        )
        .await
        .unwrap_err();

        assert!(error.contains("enabled"), "{error}");
        assert!(captured.lock().await.is_none());
    }
}
