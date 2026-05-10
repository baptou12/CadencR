use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use codex_app_server_sdk_rs::{AppServerEvent, CodexAppServerClient};
use serde_json::Value;
use tempfile::TempPath;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};
use tracing::warn;

use super::event_loop::spawn_event_loop;
use super::event_system::init_event;
use super::event_turn_state::RootTurnTracker;
use super::input::user_input_from_content;
use super::permissions::PendingCodexRequest;
use super::responses::response_value;
use super::turn_start::turn_start_params;
use super::with_timeout;
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMcpServerStatus, RuntimeMessageRx,
    RuntimePermissionDecision, RuntimePermissionMode, RuntimePermissionResponse,
    RuntimePermissionResponseKind,
};

pub(super) struct CodexSession {
    client: CodexAppServerClient,
    thread_id: String,
    active_turn_id: Arc<RwLock<Option<String>>>,
    /// Interrupt fallback when `active_turn_id` is None — see `event_turn_state`.
    last_root_turn_id: Arc<RwLock<Option<String>>>,
    model: Arc<RwLock<Option<String>>>,
    effort: Arc<RwLock<Option<String>>>,
    permission_mode: Arc<RwLock<Option<RuntimePermissionMode>>>,
    cwd: PathBuf,
    event_rx: Option<broadcast::Receiver<AppServerEvent>>,
    local_rx: Option<mpsc::UnboundedReceiver<Result<RuntimeEvent, RuntimeError>>>,
    local_tx: mpsc::UnboundedSender<Result<RuntimeEvent, RuntimeError>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingCodexRequest>>>,
    temp_files: Arc<Mutex<Vec<TempPath>>>,
    closing: Arc<AtomicBool>,
    mcp_servers: Vec<RuntimeMcpServerStatus>,
    context_window: Option<u64>,
}

impl CodexSession {
    pub(super) fn new(
        client: CodexAppServerClient,
        thread_id: String,
        model: Option<String>,
        effort: Option<String>,
        permission_mode: Option<RuntimePermissionMode>,
        cwd: PathBuf,
        event_rx: broadcast::Receiver<AppServerEvent>,
        mcp_servers: Vec<RuntimeMcpServerStatus>,
        context_window: Option<u64>,
    ) -> Self {
        let (local_tx, local_rx) = mpsc::unbounded_channel();
        Self {
            client,
            thread_id,
            active_turn_id: Arc::new(RwLock::new(None)),
            last_root_turn_id: Arc::new(RwLock::new(None)),
            model: Arc::new(RwLock::new(model)),
            effort: Arc::new(RwLock::new(effort)),
            permission_mode: Arc::new(RwLock::new(permission_mode)),
            cwd,
            event_rx: Some(event_rx),
            local_rx: Some(local_rx),
            local_tx,
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            temp_files: Arc::new(Mutex::new(Vec::new())),
            closing: Arc::new(AtomicBool::new(false)),
            mcp_servers,
            context_window,
        }
    }

    pub(super) async fn send_init_event(&self) {
        let event = init_event(
            &self.thread_id,
            self.model.read().await.clone(),
            self.context_window,
            self.mcp_servers.clone(),
        );
        let _ = self.local_tx.send(Ok(event));
    }

    pub(super) async fn start_initial_turn(&self, content: Value) -> Result<(), RuntimeError> {
        self.start_turn(content).await
    }

    async fn start_turn(&self, content: Value) -> Result<(), RuntimeError> {
        let input = self.convert_input(content).await?;
        let model = self.model.read().await.clone();
        let effort = self.effort.read().await.clone();
        let permission_mode = self.permission_mode.read().await.clone();
        let params = turn_start_params(
            &self.thread_id,
            input,
            &self.cwd,
            permission_mode.as_ref(),
            model,
            effort,
        );
        let turn = with_timeout("Codex turn/start", self.client.turn_start(params)).await?;
        *self.active_turn_id.write().await = Some(turn.id.clone());
        *self.last_root_turn_id.write().await = Some(turn.id);
        Ok(())
    }

    async fn convert_input(&self, content: Value) -> Result<Vec<Value>, RuntimeError> {
        let mut new_files = Vec::new();
        let input = user_input_from_content(content, &mut new_files)?;
        if !new_files.is_empty() {
            self.temp_files.lock().await.extend(new_files);
        }
        Ok(input)
    }
}

#[async_trait]
impl AgentRuntimeSession for CodexSession {
    fn context_window(&self) -> Option<u64> {
        self.context_window
    }

    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        let Some(source_rx) = self.event_rx.take() else {
            warn!("Codex take_message_rx called twice");
            return error_receiver("Codex message stream was already taken");
        };
        let Some(local_rx) = self.local_rx.take() else {
            warn!("Codex local receiver missing");
            return error_receiver("Codex local message stream is unavailable");
        };

        let (tx, rx) = mpsc::channel(256);
        spawn_event_loop(
            source_rx,
            tx.clone(),
            Arc::clone(&self.pending_requests),
            RootTurnTracker {
                active_turn_id: Arc::clone(&self.active_turn_id),
                last_root_turn_id: Arc::clone(&self.last_root_turn_id),
                root_thread_id: self.thread_id.clone(),
            },
            self.model.clone(),
            Arc::clone(&self.closing),
        );
        spawn_local_forwarder(local_rx, tx);
        rx
    }

    async fn session_id(&self) -> Option<String> {
        Some(self.thread_id.clone())
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        let input = self.convert_input(content.clone()).await?;
        let active = self.active_turn_id.read().await.clone();
        if let Some(turn_id) = active {
            return with_timeout(
                "Codex turn/steer",
                self.client.turn_steer(&self.thread_id, &turn_id, input),
            )
            .await;
        }
        self.start_turn(content).await
    }

    async fn interrupt(&self) -> Result<(), RuntimeError> {
        // Live turn: surface RPC failures so the UI shows Stop failed.
        if let Some(turn_id) = self.active_turn_id.read().await.clone() {
            return with_timeout(
                "Codex turn/interrupt",
                self.client.turn_interrupt(&self.thread_id, &turn_id),
            )
            .await;
        }
        // Fallback (race between Stop and the next turn/started). Errors
        // are treated as success — nothing to interrupt is the user's goal.
        let Some(turn_id) = self.last_root_turn_id.read().await.clone() else {
            return Ok(());
        };
        let _ = with_timeout(
            "Codex turn/interrupt (fallback)",
            self.client.turn_interrupt(&self.thread_id, &turn_id),
        )
        .await;
        Ok(())
    }

    async fn compact(&self) -> Result<(), RuntimeError> {
        with_timeout(
            "Codex thread/compact/start",
            self.client.thread_compact_start(&self.thread_id),
        )
        .await
    }

    async fn close(&mut self) {
        self.closing.store(true, Ordering::SeqCst);
        let _ = with_timeout(
            "Codex thread/unsubscribe",
            self.client.thread_unsubscribe(&self.thread_id),
        )
        .await;
        self.temp_files.lock().await.clear();
        self.client.shutdown().await;
    }

    async fn set_model(&self, model: &str) -> Result<(), RuntimeError> {
        *self.model.write().await = Some(model.to_string());
        Ok(())
    }

    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        *self.permission_mode.write().await = Some(mode);
        Ok(())
    }

    async fn set_thinking_effort(&self, effort: Option<String>) -> Result<(), RuntimeError> {
        *self.effort.write().await = effort;
        Ok(())
    }

    async fn respond_permission(
        &self,
        response: RuntimePermissionResponse,
    ) -> Result<(), RuntimeError> {
        if is_plan_approval_request_id(&response.request_id) {
            return self.respond_plan_approval(response).await;
        }
        let pending = take_pending(&self.pending_requests, &response.request_id).await?;
        let result = response_value(&pending.method, &pending.params, &response);
        self.client
            .respond_server_request(pending.id.clone(), result)
            .await?;
        Ok(())
    }

    fn permission_response_kind(&self, request_id: &str) -> RuntimePermissionResponseKind {
        permission_kind_for_request_id(request_id)
    }

    fn pid(&self) -> Option<u32> {
        self.client.pid()
    }
}

fn error_receiver(message: &'static str) -> RuntimeMessageRx {
    let (tx, rx) = mpsc::channel(1);
    let _ = tx.try_send(Err(RuntimeError::new(message)));
    rx
}

impl CodexSession {
    async fn respond_plan_approval(
        &self,
        response: RuntimePermissionResponse,
    ) -> Result<(), RuntimeError> {
        let prompt = plan_approval_prompt(response.decision, response.feedback);
        self.stream_input(serde_json::Value::String(prompt)).await
    }
}

fn spawn_local_forwarder(
    mut local_rx: mpsc::UnboundedReceiver<Result<RuntimeEvent, RuntimeError>>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) {
    tokio::spawn(async move {
        while let Some(event) = local_rx.recv().await {
            if tx.send(event).await.is_err() {
                break;
            }
        }
    });
}

async fn take_pending(
    pending_requests: &Arc<Mutex<HashMap<String, PendingCodexRequest>>>,
    request_id: &str,
) -> Result<PendingCodexRequest, RuntimeError> {
    if let Some(request) = pending_requests.lock().await.remove(request_id) {
        return Ok(request);
    }
    Err(RuntimeError::new(
        "received permission response for unknown Codex request",
    ))
}

fn is_plan_approval_request_id(request_id: &str) -> bool {
    request_id.starts_with("codex_plan_approval_")
}

fn permission_kind_for_request_id(request_id: &str) -> RuntimePermissionResponseKind {
    if is_plan_approval_request_id(request_id) {
        RuntimePermissionResponseKind::PlanApproval
    } else {
        RuntimePermissionResponseKind::ContinueOnDeny
    }
}

fn plan_approval_prompt(decision: RuntimePermissionDecision, feedback: Option<String>) -> String {
    match decision {
        RuntimePermissionDecision::AllowOnce | RuntimePermissionDecision::AllowFuture => {
            "Plan approved. Proceed with execution.".to_string()
        }
        RuntimePermissionDecision::Deny => feedback
            .filter(|feedback| !feedback.trim().is_empty())
            .map(|feedback| format!("User feedback on plan rejection:\n\n{feedback}"))
            .unwrap_or_else(|| "Plan rejected. Revise the plan.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use serde_json::json;
    use tokio::sync::Mutex;

    use super::super::permissions::PendingCodexRequest;
    use super::{
        is_plan_approval_request_id, permission_kind_for_request_id, plan_approval_prompt,
        take_pending,
    };
    use crate::domain::agents::adapter::{
        RuntimePermissionDecision, RuntimePermissionResponseKind,
    };

    #[test]
    fn identifies_synthetic_plan_approval_requests() {
        assert!(is_plan_approval_request_id("codex_plan_approval_plan_1"));
        assert!(!is_plan_approval_request_id("approval_1"));
    }

    #[test]
    fn codex_permission_denials_keep_turn_running() {
        assert_eq!(
            permission_kind_for_request_id("approval_1"),
            RuntimePermissionResponseKind::ContinueOnDeny
        );
        assert_eq!(
            permission_kind_for_request_id("codex_plan_approval_plan_1"),
            RuntimePermissionResponseKind::PlanApproval
        );
    }

    #[tokio::test]
    async fn take_pending_requires_exact_request_id() {
        let pending = Arc::new(Mutex::new(HashMap::from([(
            "approval_1".to_string(),
            PendingCodexRequest {
                id: json!("approval_1"),
                method: "item/commandExecution/requestApproval".to_string(),
                params: json!({}),
            },
        )])));

        let error = take_pending(&pending, "wrong_id")
            .await
            .expect_err("unknown id should fail");
        assert!(error.to_string().contains("unknown Codex request"));
    }

    #[tokio::test]
    async fn take_pending_removes_request_atomically() {
        let pending = Arc::new(Mutex::new(HashMap::from([(
            "approval_1".to_string(),
            PendingCodexRequest {
                id: json!("approval_1"),
                method: "item/commandExecution/requestApproval".to_string(),
                params: json!({}),
            },
        )])));

        let request = take_pending(&pending, "approval_1")
            .await
            .expect("pending request should resolve");
        assert_eq!(request.method, "item/commandExecution/requestApproval");
        assert!(pending.lock().await.is_empty());
        assert!(take_pending(&pending, "approval_1").await.is_err());
    }

    #[test]
    fn plan_approval_prompt_preserves_rejection_feedback() {
        assert_eq!(
            plan_approval_prompt(RuntimePermissionDecision::AllowOnce, None),
            "Plan approved. Proceed with execution."
        );
        assert_eq!(
            plan_approval_prompt(
                RuntimePermissionDecision::Deny,
                Some("Please inspect package scripts first".to_string())
            ),
            "User feedback on plan rejection:\n\nPlease inspect package scripts first"
        );
        assert_eq!(
            plan_approval_prompt(RuntimePermissionDecision::Deny, Some("  ".to_string())),
            "Plan rejected. Revise the plan."
        );
    }
}
