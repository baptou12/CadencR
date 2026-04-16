mod events;
mod model;
pub(crate) mod permissions;
mod prompt_parts;
mod questions;
mod session;
mod session_resolution;
mod stream_loop;
mod stream_state;
mod stream_synthesizer;

use async_trait::async_trait;
use serde_json::Value;

use self::model::{parse_model_ref, permission_mode_agent};
use self::permissions::{
    parse_permission_request as parse_opencode_permission_request, permission_options,
};
use self::session::OpenCodeSession;
use self::session_resolution::resolve_session_id;
use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeError, RuntimePermissionRequest,
    RuntimeSpawnConfig,
};

pub struct OpenCodeAdapter;

pub static OPENCODE_ADAPTER: OpenCodeAdapter = OpenCodeAdapter;

#[async_trait]
impl AgentRuntimeAdapter for OpenCodeAdapter {
    fn parse_permission_request(&self, raw: &Value) -> Option<RuntimePermissionRequest> {
        parse_opencode_permission_request(raw).map(|request| RuntimePermissionRequest {
            request_id: request.request_id,
            tool_name: request.tool_name,
            tool_input: request.tool_input,
            description: request.description,
            pattern: None,
            preview: request.preview,
            options: permission_options(),
        })
    }

    fn accepts_model(&self, model: &str) -> bool {
        crate::domain::agents::model_refs::is_opencode_model_ref(model)
    }

    fn catalog_entry(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
        super::providers::opencode::catalog_entry()
    }

    async fn catalog_entry_live(&self) -> crate::domain::agents::runtime::ProviderCatalogEntry {
        super::providers::opencode::catalog_entry_live().await
    }

    fn spawn_startup_warmup(&self) {
        if !crate::domain::agents::providers::opencode::should_warmup_on_start() {
            tracing::info!("opencode startup warmup disabled by CADENCE_OPENCODE_WARMUP_ON_START");
            return;
        }
        tokio::spawn(async {
            if let Err(error) = OPENCODE_ADAPTER.init().await {
                tracing::warn!(error = %error, "opencode startup warmup failed");
            } else {
                tracing::info!("opencode startup warmup completed");
            }
        });
    }

    async fn session_finished(&self, runtime_session_id: &str) -> bool {
        crate::domain::agents::providers::opencode::session_finished(runtime_session_id).await
    }

    async fn init(&self) -> Result<(), RuntimeError> {
        let _ = opencode_sdk_rs::OpenCodeClient::init()
            .await
            .map_err(RuntimeError::from)?;
        Ok(())
    }

    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError> {
        let server = opencode_sdk_rs::OpenCodeServer::ensure_running()
            .await
            .map_err(RuntimeError::from)?;
        let client = opencode_sdk_rs::OpenCodeClient::with_base_url(server.base_url.clone());
        let directory = config.cwd.to_string_lossy().to_string();
        let dispatcher =
            opencode_sdk_rs::shared_dispatcher(client.clone(), Some(directory.clone())).await;

        let current_model = config.model.as_deref().and_then(parse_model_ref);
        let context_window = match config.model.as_deref() {
            Some(model_id) => super::providers::opencode::context_window_for_model(model_id).await,
            None => None,
        };
        let current_agent = permission_mode_agent(config.permission_mode.clone()).to_string();
        let session_id = resolve_session_id(&client, &directory, config.resume_session_id).await?;
        let event_rx = dispatcher.subscribe(&session_id).await;
        let session = OpenCodeSession::new(
            client,
            dispatcher,
            session_id,
            current_agent,
            current_model,
            directory,
            config.system_prompt,
            event_rx,
            server.pid,
            context_window,
        );
        session.dispatch_input(content).await?;
        Ok(Box::new(session))
    }
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use axum::{
        response::sse::{Event, Sse},
        routing::{get, post},
        Json, Router,
    };
    use futures::stream::iter;
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    use super::{session::OpenCodeSession, OpenCodeAdapter};
    use crate::domain::agents::adapter::{AgentRuntimeAdapter, AgentRuntimeSession};

    #[test]
    fn adapter_parses_opencode_permission_request() {
        let adapter = OpenCodeAdapter;
        let parsed = adapter
            .parse_permission_request(&json!({
                "type": "opencode_permission_request",
                "request_id": "req-1",
                "tool_name": "Read",
                "tool_input": { "filePath": "README.md" },
                "description": "Read file"
            }))
            .expect("expected permission request");

        assert_eq!(parsed.request_id, "req-1");
        assert_eq!(parsed.tool_name, "Read");
        assert_eq!(parsed.tool_input, json!({ "filePath": "README.md" }));
        assert_eq!(parsed.description.as_deref(), Some("Read file"));
        assert_eq!(parsed.pattern, None);
        assert_eq!(parsed.preview.as_deref(), Some("README.md"));
        assert_eq!(parsed.options.len(), 3);
    }

    #[test]
    fn adapter_ignores_non_permission_events() {
        let adapter = OpenCodeAdapter;
        assert!(adapter
            .parse_permission_request(&json!({ "type": "other_event" }))
            .is_none());
    }

    #[tokio::test]
    async fn opencode_stream_input_surfaces_prompt_dispatch_errors() {
        async fn prompt_async() -> (axum::http::StatusCode, Json<serde_json::Value>) {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "name": "UnknownError",
                    "data": { "message": "prompt failed" }
                })),
            )
        }

        async fn event() -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
            Sse::new(iter(Vec::<Result<Event, Infallible>>::new()))
        }

        let app = Router::new()
            .route("/session/{id}/prompt_async", post(prompt_async))
            .route("/event", get(event));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let client = opencode_sdk_rs::OpenCodeClient::with_base_url(format!("http://{addr}"));
        let dispatcher =
            opencode_sdk_rs::shared_dispatcher(client.clone(), Some("/tmp/worktree".to_string()))
                .await;
        let (_event_tx, event_rx) = mpsc::unbounded_channel();
        let session = OpenCodeSession::new(
            client,
            dispatcher,
            "ses_1".to_string(),
            "build".to_string(),
            None,
            "/tmp/worktree".to_string(),
            None,
            event_rx,
            None,
            None,
        );

        let error = session
            .stream_input(serde_json::Value::String("hello".to_string()))
            .await
            .expect_err("expected immediate dispatch error");
        assert!(error.to_string().contains("prompt failed"));
    }
}
