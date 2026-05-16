//! Bridge between Cadencr's permission UI and OpenCode's REST permission
//! endpoint for sub-agent prompts surfaced via HTTP polling.
//!
//! Sub-agent permission prompts never reach the ACP wire (upstream issue
//! sst/opencode#6573), so the polling listener stashes them in a registry
//! keyed by OpenCode's `permissionID`. When the user clicks an option in
//! the Cadencr permission drawer, the runtime's `respond_permission`
//! eventually calls back through `AcpProviderHooks::respond_permission_fallback`
//! — this module is what that fallback delegates to, mapping the decision
//! to OpenCode's wire reply and POSTing it to `/permission/{id}/reply`.

use opencode_sdk_rs::{OpenCodeClient, PermissionReply};

use crate::domain::agents::acp::runtime::provider_hooks::PermissionFallbackOutcome;
use crate::domain::agents::adapter::{
    RuntimeError, RuntimePermissionDecision, RuntimePermissionResponse,
};

use super::upstream_workaround::PermissionRegistry;

/// Try to route `response` as a polled sub-agent permission reply.
///
/// Returns:
/// - `Some(HandledWithCacheKey)` after a successful REST POST — the
///   runtime caches the decision under `(tool_name, tool_input)` so
///   identical follow-up calls skip the prompt.
/// - `None` if `response.request_id` isn't in the registry (caller should
///   fall through to the next fallback path, e.g. the question sidecar).
/// - `Err(...)` if the REST POST itself failed.
pub(super) async fn route_subagent_permission_reply(
    client: &OpenCodeClient,
    directory: &str,
    registry: &PermissionRegistry,
    response: &RuntimePermissionResponse,
) -> Result<Option<PermissionFallbackOutcome>, RuntimeError> {
    let Some(request) = registry.write().await.remove(&response.request_id) else {
        return Ok(None);
    };
    let reply = match response.decision {
        RuntimePermissionDecision::AllowOnce => PermissionReply::Once,
        RuntimePermissionDecision::AllowFuture | RuntimePermissionDecision::AllowForSession => {
            PermissionReply::Always
        }
        RuntimePermissionDecision::Deny => PermissionReply::Reject,
    };
    // `directory` MUST scope the reply or upstream's
    // `WorkspaceRoutingMiddleware` falls back to `process.cwd()` of the
    // OpenCode subprocess (which never actually chdir's to `--cwd`) and
    // the reply lands on the wrong pending map — `Permission.reply`
    // silently no-ops and the sub-agent's bash stalls forever.
    client
        .reply_permission(&response.request_id, reply, Some(directory))
        .await
        .map_err(|err| RuntimeError::new(format!("OpenCode permission reply failed: {err}")))?;
    Ok(Some(PermissionFallbackOutcome::HandledWithCacheKey {
        tool_name: request.tool_name,
        tool_input: request.tool_input,
    }))
}

#[cfg(test)]
mod tests {
    use super::route_subagent_permission_reply;
    use crate::domain::agents::acp::runtime::provider_hooks::PermissionFallbackOutcome;
    use crate::domain::agents::adapter::{
        RuntimePermissionDecision, RuntimePermissionRequest, RuntimePermissionResponse,
    };
    use axum::http::{HeaderMap, Uri};
    use axum::{extract::State, routing::post, Json, Router};
    use opencode_sdk_rs::OpenCodeClient;
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio::sync::RwLock;

    #[derive(Clone, Default)]
    struct Recorded {
        /// (request_id, reply, directory_query_or_header) tuples — the
        /// last slot proves the scope landed on the wire.
        replies: Arc<Mutex<Vec<(String, String, String)>>>,
    }

    async fn handle_reply(
        State(rec): State<Recorded>,
        axum::extract::Path(id): axum::extract::Path<String>,
        uri: Uri,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        let reply = body
            .get("reply")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let dir = headers
            .get("x-opencode-directory")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .or_else(|| {
                uri.query().and_then(|q| {
                    q.split('&')
                        .find_map(|p| p.strip_prefix("directory="))
                        .map(|raw| raw.replace("%2F", "/"))
                })
            })
            .unwrap_or_default();
        rec.replies.lock().unwrap().push((id, reply, dir));
        Json(json!({}))
    }

    async fn spawn_fake_opencode() -> (u16, Recorded) {
        let recorded = Recorded::default();
        let app = Router::new()
            .route("/permission/{id}/reply", post(handle_reply))
            .with_state(recorded.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (port, recorded)
    }

    fn seed_request(registry: &Arc<RwLock<HashMap<String, RuntimePermissionRequest>>>) {
        let req = RuntimePermissionRequest {
            request_id: "per_42".into(),
            tool_use_id: Some("call_1".into()),
            tool_name: "Bash".into(),
            tool_input: json!({ "command": "git status" }),
            description: None,
            pattern: None,
            preview: None,
            options: vec![],
        };
        registry.try_write().unwrap().insert("per_42".into(), req);
    }

    #[tokio::test]
    async fn allow_future_posts_always_with_directory_scope_and_returns_cache_key() {
        let (port, recorded) = spawn_fake_opencode().await;
        let registry: Arc<RwLock<HashMap<String, RuntimePermissionRequest>>> =
            Arc::new(RwLock::new(HashMap::new()));
        seed_request(&registry);
        let outcome = route_subagent_permission_reply(
            &OpenCodeClient::new(port),
            "/tmp/project",
            &registry,
            &RuntimePermissionResponse {
                request_id: "per_42".into(),
                decision: RuntimePermissionDecision::AllowFuture,
                option_id: Some("allow_always".into()),
                feedback: None,
                updated_input: None,
            },
        )
        .await
        .unwrap()
        .expect("must route");
        match outcome {
            PermissionFallbackOutcome::HandledWithCacheKey {
                tool_name,
                tool_input,
            } => {
                assert_eq!(tool_name, "Bash");
                assert_eq!(tool_input["command"], "git status");
            }
            other => panic!("unexpected {other:?}"),
        }
        // Directory MUST land on the wire — otherwise the upstream reply
        // falls back to the wrong workspace and silently no-ops.
        assert_eq!(
            recorded.replies.lock().unwrap().clone(),
            vec![("per_42".into(), "always".into(), "/tmp/project".into())]
        );
        assert!(registry.read().await.is_empty());
    }

    #[tokio::test]
    async fn unknown_request_id_returns_none() {
        let (port, _rec) = spawn_fake_opencode().await;
        let registry: Arc<RwLock<HashMap<String, RuntimePermissionRequest>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let outcome = route_subagent_permission_reply(
            &OpenCodeClient::new(port),
            "/tmp/project",
            &registry,
            &RuntimePermissionResponse {
                request_id: "per_unknown".into(),
                decision: RuntimePermissionDecision::AllowOnce,
                option_id: None,
                feedback: None,
                updated_input: None,
            },
        )
        .await
        .unwrap();
        assert!(outcome.is_none());
    }

    #[tokio::test]
    async fn deny_maps_to_reject_wire_value() {
        let (port, recorded) = spawn_fake_opencode().await;
        let registry: Arc<RwLock<HashMap<String, RuntimePermissionRequest>>> =
            Arc::new(RwLock::new(HashMap::new()));
        seed_request(&registry);
        route_subagent_permission_reply(
            &OpenCodeClient::new(port),
            "/tmp/project",
            &registry,
            &RuntimePermissionResponse {
                request_id: "per_42".into(),
                decision: RuntimePermissionDecision::Deny,
                option_id: None,
                feedback: None,
                updated_input: None,
            },
        )
        .await
        .unwrap()
        .expect("must route");
        assert_eq!(
            recorded.replies.lock().unwrap().clone(),
            vec![("per_42".into(), "reject".into(), "/tmp/project".into())]
        );
    }
}
