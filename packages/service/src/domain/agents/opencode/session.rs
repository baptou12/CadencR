use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tracing::{error, warn};

use super::model::{parse_model_ref, permission_mode_agent};
use super::prompt_parts::prompt_parts_from_content;
use super::questions::extract_question_answers;
use super::stream_loop::spawn_event_loop;
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMessageRx, RuntimePermissionDecision,
    RuntimePermissionMode, RuntimePermissionResponse,
};

#[derive(Clone, Copy)]
pub(super) enum PendingRequestKind {
    Permission,
    Question,
}

pub(super) struct OpenCodeSession {
    pub(super) client: opencode_sdk_rs::OpenCodeClient,
    pub(super) dispatcher: Arc<opencode_sdk_rs::SseDispatcher>,
    pub(super) session_id: String,
    pub(super) current_agent: Arc<RwLock<String>>,
    pub(super) current_model: Arc<RwLock<Option<opencode_sdk_rs::ModelRef>>>,
    pub(super) directory: String,
    pub(super) system_prompt: Option<String>,
    pub(super) event_rx: Option<mpsc::UnboundedReceiver<opencode_sdk_rs::SseEvent>>,
    pub(super) local_rx: Option<mpsc::UnboundedReceiver<Result<RuntimeEvent, RuntimeError>>>,
    pub(super) local_tx: mpsc::UnboundedSender<Result<RuntimeEvent, RuntimeError>>,
    pub(super) pending_requests: Arc<Mutex<HashMap<String, PendingRequestKind>>>,
    pub(super) server_pid: Option<u32>,
    pub(super) context_window: Option<u64>,
}

const COMMAND_DISPATCH_GRACE: Duration = Duration::from_millis(250);

impl OpenCodeSession {
    pub(super) fn new(
        client: opencode_sdk_rs::OpenCodeClient,
        dispatcher: Arc<opencode_sdk_rs::SseDispatcher>,
        session_id: String,
        current_agent: String,
        current_model: Option<opencode_sdk_rs::ModelRef>,
        directory: String,
        system_prompt: Option<String>,
        event_rx: mpsc::UnboundedReceiver<opencode_sdk_rs::SseEvent>,
        server_pid: Option<u32>,
        context_window: Option<u64>,
    ) -> Self {
        let (local_tx, local_rx) = mpsc::unbounded_channel();
        Self {
            client,
            dispatcher,
            session_id,
            current_agent: Arc::new(RwLock::new(current_agent)),
            current_model: Arc::new(RwLock::new(current_model)),
            directory,
            system_prompt,
            event_rx: Some(event_rx),
            local_rx: Some(local_rx),
            local_tx,
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            server_pid,
            context_window,
        }
    }

    pub(super) async fn dispatch_input(&self, content: Value) -> Result<(), RuntimeError> {
        self.dispatch_parts(prompt_parts_from_content(content))
            .await
    }

    async fn dispatch_parts(
        &self,
        parts: Vec<opencode_sdk_rs::PromptPart>,
    ) -> Result<(), RuntimeError> {
        let options = opencode_sdk_rs::PromptOptions {
            model: self.current_model.read().await.clone(),
            agent: Some(self.current_agent.read().await.clone()),
            system: self.system_prompt.clone(),
        };

        if opencode_sdk_rs::parse_command_invocation(&parts).is_none() {
            return self
                .client
                .send_prompt_or_command_in_directory(
                    &self.session_id,
                    Some(&self.directory),
                    parts,
                    options,
                )
                .await
                .map_err(RuntimeError::from);
        }

        self.dispatch_command_parts(parts, options).await
    }

    async fn dispatch_command_parts(
        &self,
        parts: Vec<opencode_sdk_rs::PromptPart>,
        options: opencode_sdk_rs::PromptOptions,
    ) -> Result<(), RuntimeError> {
        let client = self.client.clone();
        let session_id = self.session_id.clone();
        let directory = self.directory.clone();
        let local_tx = self.local_tx.clone();
        let (immediate_tx, immediate_rx) = oneshot::channel();

        tokio::spawn(async move {
            let result = client
                .send_prompt_or_command_in_directory(&session_id, Some(&directory), parts, options)
                .await
                .map_err(RuntimeError::from);

            if let Err(result) = immediate_tx.send(result) {
                if let Err(error) = result {
                    error!(session_id, error = %error, "OpenCode command dispatch failed after grace period");
                    let _ = local_tx.send(Err(error));
                }
            }
        });

        match tokio::time::timeout(COMMAND_DISPATCH_GRACE, immediate_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(RuntimeError::new(
                "OpenCode command dispatch task ended unexpectedly",
            )),
            Err(_) => Ok(()),
        }
    }
}

fn spawn_local_result_forwarder(
    mut local_rx: mpsc::UnboundedReceiver<Result<RuntimeEvent, RuntimeError>>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) {
    tokio::spawn(async move {
        while let Some(result) = local_rx.recv().await {
            if tx.send(result).await.is_err() {
                break;
            }
        }
    });
}

#[async_trait]
impl AgentRuntimeSession for OpenCodeSession {
    fn context_window(&self) -> Option<u64> {
        self.context_window
    }

    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        let Some(source_rx) = self.event_rx.take() else {
            warn!("take_message_rx called twice — returning dead channel");
            let (_tx, rx) = mpsc::channel(1);
            return rx;
        };
        let Some(local_rx) = self.local_rx.take() else {
            warn!("local result receiver missing — returning dead channel");
            let (_tx, rx) = mpsc::channel(1);
            return rx;
        };

        let (tx, rx) = mpsc::channel(256);
        let pending_requests = Arc::clone(&self.pending_requests);
        let session_id = self.session_id.clone();
        let model = self.current_model.try_read().ok().and_then(|guard| {
            guard
                .clone()
                .map(|model| format!("{}/{}", model.provider_id, model.model_id))
        });

        spawn_event_loop(
            source_rx,
            tx.clone(),
            pending_requests,
            session_id,
            model,
            self.context_window,
        );
        spawn_local_result_forwarder(local_rx, tx);
        rx
    }

    async fn session_id(&self) -> Option<String> {
        Some(self.session_id.clone())
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        self.dispatch_input(content).await
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
    use tokio::sync::{mpsc, Mutex};

    use super::{OpenCodeSession, PendingRequestKind};
    use crate::domain::agents::adapter::{
        AgentRuntimeSession, RuntimePermissionDecision, RuntimePermissionResponse,
    };

    #[tokio::test]
    async fn question_reply_uses_directory_scope() {
        async fn reply(
            State(dir): State<Arc<tokio::sync::Mutex<Option<String>>>>,
            headers: axum::http::HeaderMap,
        ) -> Json<serde_json::Value> {
            *dir.lock().await = headers
                .get("x-opencode-directory")
                .and_then(|value| value.to_str().ok())
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
        let dispatcher =
            opencode_sdk_rs::shared_dispatcher(client.clone(), Some("/tmp/worktree".to_string()))
                .await;
        let (_event_tx, event_rx) = mpsc::unbounded_channel();
        let mut session = OpenCodeSession::new(
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
        session.pending_requests = Arc::new(Mutex::new(HashMap::from([(
            "que_1".to_string(),
            PendingRequestKind::Question,
        )])));

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
