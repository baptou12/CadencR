mod events;
mod model;
pub(crate) mod permissions;
mod questions;
mod stream_loop;
mod stream_synthesizer;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{mpsc, Mutex, RwLock};

use self::model::{parse_model_ref, permission_mode_agent};
use self::permissions::parse_permission_request as parse_opencode_permission_request;
use self::questions::extract_question_answers;
use self::stream_loop::spawn_event_loop;
use super::adapter::{
    AgentRuntimeAdapter, AgentRuntimeSession, RuntimeError, RuntimeMessageRx,
    RuntimePermissionDecision, RuntimePermissionMode, RuntimePermissionRequest,
    RuntimePermissionResponse, RuntimeSpawnConfig,
};

pub struct OpenCodeAdapter;

pub static OPENCODE_ADAPTER: OpenCodeAdapter = OpenCodeAdapter;

#[derive(Clone, Copy)]
pub(super) enum PendingRequestKind {
    Permission,
    Question,
}

pub struct OpenCodeSession {
    client: opencode_sdk_rs::OpenCodeClient,
    dispatcher: Arc<opencode_sdk_rs::SseDispatcher>,
    session_id: String,
    current_agent: Arc<RwLock<String>>,
    current_model: Arc<RwLock<Option<opencode_sdk_rs::ModelRef>>>,
    directory: String,
    system_prompt: Option<String>,
    event_rx: Option<mpsc::Receiver<opencode_sdk_rs::SseEvent>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequestKind>>>,
    server_pid: Option<u32>,
}

fn prompt_parts_from_content(content: Value) -> Vec<opencode_sdk_rs::PromptPart> {
    match content {
        Value::String(text) => vec![opencode_sdk_rs::PromptPart::Text { text }],
        Value::Array(items) => items
            .into_iter()
            .map(|item| {
                let text = item
                    .get("text")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                match text {
                    Some(text) => opencode_sdk_rs::PromptPart::Text { text },
                    None => opencode_sdk_rs::PromptPart::Raw(item),
                }
            })
            .collect(),
        other => vec![opencode_sdk_rs::PromptPart::Raw(other)],
    }
}

#[async_trait]
impl AgentRuntimeSession for OpenCodeSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        let Some(source_rx) = self.event_rx.take() else {
            let (_tx, rx) = mpsc::channel(1);
            return rx;
        };
        let (tx, rx) = mpsc::channel(256);
        let pending_requests = Arc::clone(&self.pending_requests);
        let session_id = self.session_id.clone();
        let model = self.current_model.try_read().ok().and_then(|guard| {
            guard
                .clone()
                .map(|m| format!("{}/{}", m.provider_id, m.model_id))
        });
        spawn_event_loop(source_rx, tx, pending_requests, session_id, model);
        rx
    }

    async fn session_id(&self) -> Option<String> {
        Some(self.session_id.clone())
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        let options = opencode_sdk_rs::PromptOptions {
            model: self.current_model.read().await.clone(),
            agent: Some(self.current_agent.read().await.clone()),
            system: self.system_prompt.clone(),
        };
        self.client
            .prompt_async_in_directory(
                &self.session_id,
                Some(&self.directory),
                prompt_parts_from_content(content),
                options,
            )
            .await
            .map_err(RuntimeError::from)
    }

    async fn interrupt(&self) -> Result<(), RuntimeError> {
        self.client
            .abort_session_in_directory(&self.session_id, Some(&self.directory))
            .await
            .map_err(RuntimeError::from)
    }

    async fn close(&mut self) {
        self.dispatcher.unsubscribe(&self.session_id).await;
    }

    async fn set_model(&self, model: &str) -> Result<(), RuntimeError> {
        *self.current_model.write().await = parse_model_ref(model);
        Ok(())
    }

    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        *self.current_agent.write().await = permission_mode_agent(Some(mode)).to_string();
        Ok(())
    }

    async fn respond_permission(
        &self,
        response: RuntimePermissionResponse,
    ) -> Result<(), RuntimeError> {
        let pending = self
            .pending_requests
            .lock()
            .await
            .get(&response.request_id)
            .copied()
            .or_else(|| {
                response
                    .updated_input
                    .as_ref()
                    .and_then(|input| input.get("answers"))
                    .map(|_| PendingRequestKind::Question)
            });
        let result = match pending {
            Some(PendingRequestKind::Permission) => self
                .client
                .reply_permission_in_directory(
                    &response.request_id,
                    Some(&self.directory),
                    match response.decision {
                        RuntimePermissionDecision::AllowOnce => {
                            opencode_sdk_rs::PermissionReply::Once
                        }
                        RuntimePermissionDecision::AllowFuture => {
                            opencode_sdk_rs::PermissionReply::Always
                        }
                        RuntimePermissionDecision::Deny => opencode_sdk_rs::PermissionReply::Reject,
                    },
                    response.feedback.as_deref(),
                )
                .await
                .map_err(RuntimeError::from),
            Some(PendingRequestKind::Question) => {
                if matches!(response.decision, RuntimePermissionDecision::Deny) {
                    return self
                        .client
                        .reject_question_in_directory(&response.request_id, Some(&self.directory))
                        .await
                        .map_err(RuntimeError::from);
                }
                self.client
                    .reply_question_in_directory(
                        &response.request_id,
                        Some(&self.directory),
                        extract_question_answers(
                            response.updated_input.as_ref(),
                            response.feedback.as_deref(),
                        ),
                    )
                    .await
                    .map_err(RuntimeError::from)
            }
            None => Err(RuntimeError::new(
                "received permission response for unknown OpenCode request",
            )),
        };

        if result.is_ok() {
            self.pending_requests
                .lock()
                .await
                .remove(&response.request_id);
        }
        result
    }

    fn pid(&self) -> Option<u32> {
        self.server_pid
    }
}

#[async_trait]
impl AgentRuntimeAdapter for OpenCodeAdapter {
    fn parse_permission_request(&self, raw: &Value) -> Option<RuntimePermissionRequest> {
        parse_opencode_permission_request(raw).map(|request| RuntimePermissionRequest {
            request_id: request.request_id,
            tool_name: request.tool_name,
            tool_input: request.tool_input,
            description: request.description,
            pattern: None,
        })
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
        let current_agent = permission_mode_agent(config.permission_mode.clone()).to_string();
        let session_id = resolve_session_id(&client, &directory, config.resume_session_id).await?;
        let event_rx = dispatcher.subscribe(&session_id).await;
        let prompt_options = opencode_sdk_rs::PromptOptions {
            model: current_model.clone(),
            agent: Some(current_agent.clone()),
            system: config.system_prompt.clone(),
        };
        client
            .prompt_async_in_directory(
                &session_id,
                Some(&directory),
                prompt_parts_from_content(content),
                prompt_options,
            )
            .await
            .map_err(RuntimeError::from)?;

        Ok(Box::new(OpenCodeSession {
            client,
            dispatcher,
            session_id,
            current_agent: Arc::new(RwLock::new(current_agent)),
            current_model: Arc::new(RwLock::new(current_model)),
            directory,
            system_prompt: config.system_prompt,
            event_rx: Some(event_rx),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            server_pid: server.pid,
        }))
    }
}

async fn resolve_session_id(
    client: &opencode_sdk_rs::OpenCodeClient,
    directory: &str,
    resume_session_id: Option<String>,
) -> Result<String, RuntimeError> {
    match resume_session_id {
        Some(session_id) => match client.get_session(&session_id, directory).await {
            Ok(_) => Ok(session_id),
            Err(error) if should_create_fresh_session(&error) => client
                .create_session(directory)
                .await
                .map(|session| session.id)
                .map_err(RuntimeError::from),
            Err(error) => Err(RuntimeError::from(error)),
        },
        None => client
            .create_session(directory)
            .await
            .map(|session| session.id)
            .map_err(RuntimeError::from),
    }
}

fn should_create_fresh_session(error: &opencode_sdk_rs::SdkError) -> bool {
    matches!(
        error,
        opencode_sdk_rs::SdkError::HttpStatus { status: 404, .. }
    )
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, convert::Infallible, sync::Arc};

    use axum::{
        extract::State,
        response::sse::{Event, Sse},
        routing::{get, post},
        Json, Router,
    };
    use futures::stream::iter;
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio::sync::{Mutex, RwLock};

    use super::{OpenCodeAdapter, OpenCodeSession, PendingRequestKind};
    use crate::domain::agents::adapter::{
        AgentRuntimeAdapter, AgentRuntimeSession, RuntimePermissionDecision,
        RuntimePermissionResponse,
    };

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
    }

    #[test]
    fn adapter_ignores_non_permission_events() {
        let adapter = OpenCodeAdapter;
        assert!(adapter
            .parse_permission_request(&json!({ "type": "other_event" }))
            .is_none());
    }

    #[test]
    fn create_fresh_session_only_on_not_found() {
        assert!(super::should_create_fresh_session(
            &opencode_sdk_rs::SdkError::HttpStatus {
                status: 404,
                body: "missing".to_string(),
            }
        ));
        assert!(!super::should_create_fresh_session(
            &opencode_sdk_rs::SdkError::HttpStatus {
                status: 500,
                body: "boom".to_string(),
            }
        ));
        assert!(!super::should_create_fresh_session(
            &opencode_sdk_rs::SdkError::Timeout("timed out".to_string())
        ));
    }

    #[tokio::test]
    async fn question_reply_uses_directory_scope() {
        async fn reply(
            State(dir): State<Arc<tokio::sync::Mutex<Option<String>>>>,
            headers: axum::http::HeaderMap,
        ) -> Json<serde_json::Value> {
            *dir.lock().await = headers
                .get("x-opencode-directory")
                .and_then(|v| v.to_str().ok())
                .map(ToOwned::to_owned);
            Json(json!({ "ok": true }))
        }
        async fn event() -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
            Sse::new(iter(Vec::<Result<Event, Infallible>>::new()))
        }
        let dir = Arc::new(tokio::sync::Mutex::new(None));
        let app = Router::new()
            .route("/question/{id}/reply", post(reply))
            .route("/event", get(event))
            .with_state(Arc::clone(&dir));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = opencode_sdk_rs::OpenCodeClient::with_base_url(format!("http://{addr}"));
        let session = OpenCodeSession {
            client: client.clone(),
            dispatcher: opencode_sdk_rs::shared_dispatcher(
                client,
                Some("/tmp/worktree".to_string()),
            )
            .await,
            session_id: "ses_1".to_string(),
            current_agent: Arc::new(RwLock::new("build".to_string())),
            current_model: Arc::new(RwLock::new(None)),
            directory: "/tmp/worktree".to_string(),
            system_prompt: None,
            event_rx: None,
            pending_requests: Arc::new(Mutex::new(HashMap::from([(
                "que_1".to_string(),
                PendingRequestKind::Question,
            )]))),
            server_pid: None,
        };
        session
            .respond_permission(RuntimePermissionResponse {
                request_id: "que_1".to_string(),
                decision: RuntimePermissionDecision::AllowOnce,
                feedback: None,
                updated_input: Some(json!({ "answers": [["Alpha"]] })),
            })
            .await
            .unwrap();
        assert_eq!(dir.lock().await.as_deref(), Some("/tmp/worktree"));
    }
}
