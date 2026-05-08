//! `OpenCodeAcpSession` — `AgentRuntimeSession` impl backed by ACP.
//!
//! Owns the `AcpClient` plus per-session state and translates trait
//! methods into ACP requests/notifications. Helpers split into
//! `session_permissions` (deny/cancel/drain) and `session_prompt`
//! (`build_prompt_params`, `emit_turn_result`) to stay under 400 lines.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;

use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMessageRx, RuntimePermissionMode,
    RuntimePermissionResponse,
};
use crate::domain::agents::opencode::acp::event_loop::PendingPermissions;
use crate::domain::agents::opencode::acp::input::acp_prompt_blocks_from_content;
use crate::domain::agents::opencode::acp::session_permissions;
use crate::domain::agents::opencode::acp::session_prompt::{build_prompt_params, emit_turn_result};
use crate::domain::agents::opencode::acp::terminal_registry::TerminalRegistry;

pub(super) struct OpenCodeAcpSession {
    pub(super) client: AcpClient,
    pub(super) session_id: Arc<RwLock<Option<String>>>,
    pub(super) current_model: Arc<RwLock<Option<String>>>,
    pub(super) current_effort: Arc<RwLock<Option<String>>>,
    pub(super) current_mode: Arc<RwLock<String>>,
    pub(super) cwd: PathBuf,
    pub(super) pending_permissions: PendingPermissions,
    pub(super) closing: Arc<AtomicBool>,
    pub(super) pid: Option<u32>,
    pub(super) context_window: Option<u64>,
    pub(super) message_rx: Option<RuntimeMessageRx>,
    pub(super) loop_task: Option<JoinHandle<()>>,
    /// Shared with the event loop; ties the loop's lifetime to the session.
    pub(super) terminals_for_loop: Arc<TerminalRegistry>,
    /// Same channel `take_message_rx` returns — used by the session to
    /// emit synthetic events (e.g. `Result` on `stopReason`).
    pub(super) local_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
}

impl OpenCodeAcpSession {
    pub(super) async fn current_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn require_session_id(&self) -> Result<String, RuntimeError> {
        self.current_session_id()
            .await
            .ok_or_else(|| RuntimeError::new("ACP session id not yet known"))
    }
}

#[async_trait]
impl AgentRuntimeSession for OpenCodeAcpSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        self.message_rx
            .take()
            .expect("OpenCodeAcpSession message_rx already taken")
    }

    fn context_window(&self) -> Option<u64> {
        self.context_window
    }

    async fn session_id(&self) -> Option<String> {
        self.current_session_id().await
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        let session_id = self.require_session_id().await?;
        let prompt = acp_prompt_blocks_from_content(content);
        let model = self.current_model.read().await.clone();
        let effort = self.current_effort.read().await.clone();
        let params = build_prompt_params(&session_id, prompt, model.as_deref(), effort.as_deref());
        // `session/prompt` represents a whole agent turn — it can sit idle
        // for minutes while the user reviews permission drawers or while
        // the agent runs long-running tools. The 60s default is fine for
        // all other ACP requests but blows up turns that wait on humans.
        // Use a deliberately huge ceiling so the only realistic way for
        // this to fire is a wedged subprocess.
        let response = self
            .client
            .request_with_timeout(
                "session/prompt",
                params,
                std::time::Duration::from_secs(60 * 60),
            )
            .await
            .map_err(|e| RuntimeError::new(format!("session/prompt failed: {e}")))?;
        if let Some(reason) = response.get("stopReason").and_then(Value::as_str) {
            tracing::debug!(stop_reason = reason, "session/prompt completed");
            emit_turn_result(
                &self.local_tx,
                self.current_session_id().await,
                self.context_window,
                reason,
                &response,
            )
            .await;
        }
        Ok(())
    }

    async fn interrupt(&self) -> Result<(), RuntimeError> {
        let session_id = self.require_session_id().await?;
        self.client
            .notify("session/cancel", json!({ "sessionId": session_id }))
            .await
            .map_err(|e| RuntimeError::new(format!("session/cancel failed: {e}")))?;
        Ok(())
    }

    async fn close(&mut self) {
        self.closing.store(true, Ordering::SeqCst);
        // Best-effort cancel before tearing down. Ignore failures.
        if let Some(session_id) = self.current_session_id().await {
            let _ = self
                .client
                .notify("session/cancel", json!({ "sessionId": session_id }))
                .await;
        }
        session_permissions::reject_all_pending_permissions(self).await;
        if let Some(task) = self.loop_task.take() {
            task.abort();
        }
        self.client.shutdown().await;
    }

    async fn set_model(&self, model: &str) -> Result<(), RuntimeError> {
        // ACP has no live model-switch RPC, but `session/prompt` accepts
        // extra params; `stream_input` echoes this on every call.
        *self.current_model.write().await = Some(model.to_string());
        Ok(())
    }

    fn applies_thinking_effort_in_place(&self) -> bool {
        true
    }

    async fn set_thinking_effort(&self, effort: Option<String>) -> Result<(), RuntimeError> {
        *self.current_effort.write().await = effort;
        Ok(())
    }

    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        // `supports_permission_mode` restricts the public surface to
        // {Default, AcceptEdits, Plan}; map defensively otherwise.
        let mode_id = match mode {
            RuntimePermissionMode::Plan => "plan",
            _ => "build",
        };
        let session_id = self.require_session_id().await?;
        self.client
            .request(
                "session/set_mode",
                json!({ "sessionId": session_id, "modeId": mode_id }),
            )
            .await
            .map_err(|e| RuntimeError::new(format!("session/set_mode failed: {e}")))?;
        *self.current_mode.write().await = mode_id.to_string();
        Ok(())
    }

    async fn respond_permission(
        &self,
        response: RuntimePermissionResponse,
    ) -> Result<(), RuntimeError> {
        session_permissions::respond_permission(self, response).await
    }

    fn pid(&self) -> Option<u32> {
        self.pid
    }
}

#[cfg(test)]
mod tests {
    use super::OpenCodeAcpSession;
    use crate::domain::agents::acp::{AcpClient, AcpClientInfo};
    use crate::domain::agents::adapter::{
        AgentRuntimeSession, RuntimePermissionDecision, RuntimePermissionMode,
        RuntimePermissionResponse,
    };
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::sync::{mpsc, RwLock};

    fn build_test_session() -> (
        OpenCodeAcpSession,
        tokio::io::DuplexStream,
        BufReader<tokio::io::DuplexStream>,
    ) {
        let (client_reads_stdout, agent_writes_stdout) = duplex(64 * 1024);
        let (agent_reads_stdin, client_writes_stdin) = duplex(64 * 1024);
        let client = AcpClient::spawn_with_streams(
            Box::new(client_writes_stdin),
            client_reads_stdout,
            tokio::io::empty(),
            AcpClientInfo::default(),
        );
        let (local_tx, rx) = mpsc::channel(16);
        let session = OpenCodeAcpSession {
            client,
            session_id: Arc::new(RwLock::new(Some("s-test".into()))),
            current_model: Arc::new(RwLock::new(Some("opencode/test".into()))),
            current_effort: Arc::new(RwLock::new(None)),
            current_mode: Arc::new(RwLock::new("build".into())),
            cwd: PathBuf::from("/tmp"),
            pending_permissions: Arc::new(RwLock::new(Default::default())),
            closing: Arc::new(AtomicBool::new(false)),
            pid: None,
            context_window: Some(200_000),
            message_rx: Some(rx),
            loop_task: None,
            terminals_for_loop: Arc::new(super::TerminalRegistry::default()),
            local_tx,
        };
        (
            session,
            agent_writes_stdout,
            BufReader::new(agent_reads_stdin),
        )
    }

    async fn next_request(stdin: &mut BufReader<tokio::io::DuplexStream>) -> Value {
        let mut line = String::new();
        stdin.read_line(&mut line).await.unwrap();
        serde_json::from_str(line.trim()).unwrap()
    }
    async fn reply_ok(out: &mut tokio::io::DuplexStream, id: &Value, result: Value) {
        let payload = format!("{}\n", json!({ "id": id, "result": result }));
        out.write_all(payload.as_bytes()).await.unwrap();
    }
    async fn reply_end_turn(out: &mut tokio::io::DuplexStream, id: &Value) {
        reply_ok(out, id, json!({ "stopReason": "end_turn" })).await;
    }

    /// Build a parallel session sharing all `Arc`s — `RuntimeMessageRx`
    /// is not `Send`, so tests rebuild a stub before `tokio::spawn`.
    fn stub_from(session: &OpenCodeAcpSession) -> OpenCodeAcpSession {
        OpenCodeAcpSession {
            client: session.client.clone(),
            session_id: session.session_id.clone(),
            current_model: session.current_model.clone(),
            current_effort: session.current_effort.clone(),
            current_mode: session.current_mode.clone(),
            cwd: session.cwd.clone(),
            pending_permissions: session.pending_permissions.clone(),
            closing: session.closing.clone(),
            pid: session.pid,
            context_window: session.context_window,
            message_rx: None,
            loop_task: None,
            terminals_for_loop: session.terminals_for_loop.clone(),
            local_tx: session.local_tx.clone(),
        }
    }

    #[tokio::test]
    async fn interrupt_writes_session_cancel_notification() {
        let (session, _agent_stdout, mut agent_stdin) = build_test_session();
        session.interrupt().await.unwrap();
        let parsed = next_request(&mut agent_stdin).await;
        assert_eq!(parsed["method"], "session/cancel");
        assert_eq!(parsed["params"]["sessionId"], "s-test");
        assert!(parsed.get("id").is_none());
    }

    #[tokio::test]
    async fn stream_input_sends_prompt_and_returns_on_response() {
        let (session, mut agent_stdout, mut agent_stdin) = build_test_session();
        let stub = stub_from(&session);
        let h = tokio::spawn(async move { stub.stream_input(json!("hello")).await });
        let parsed = next_request(&mut agent_stdin).await;
        assert_eq!(parsed["method"], "session/prompt");
        assert_eq!(parsed["params"]["sessionId"], "s-test");
        assert_eq!(parsed["params"]["prompt"][0]["text"], "hello");
        reply_end_turn(&mut agent_stdout, &parsed["id"]).await;
        h.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn set_permission_mode_plan_sends_modeid_plan() {
        let (session, mut agent_stdout, mut agent_stdin) = build_test_session();
        let stub = stub_from(&session);
        let h = tokio::spawn(
            async move { stub.set_permission_mode(RuntimePermissionMode::Plan).await },
        );
        let parsed = next_request(&mut agent_stdin).await;
        assert_eq!(parsed["method"], "session/set_mode");
        assert_eq!(parsed["params"]["modeId"], "plan");
        reply_ok(&mut agent_stdout, &parsed["id"], json!(null)).await;
        h.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn set_model_updates_label_for_next_prompt() {
        let (session, _agent_stdout, _agent_stdin) = build_test_session();
        session.set_model("opencode/different").await.unwrap();
        assert_eq!(
            session.current_model.read().await.as_deref(),
            Some("opencode/different")
        );
    }

    #[tokio::test]
    async fn stream_input_echoes_current_model_and_effort() {
        let (session, mut agent_stdout, mut agent_stdin) = build_test_session();
        session.set_model("openai/gpt-5.5").await.unwrap();
        session
            .set_thinking_effort(Some("high".to_string()))
            .await
            .unwrap();
        let stub = stub_from(&session);
        let h = tokio::spawn(async move { stub.stream_input(json!("hi")).await });
        let parsed = next_request(&mut agent_stdin).await;
        assert_eq!(parsed["params"]["model"], "openai/gpt-5.5");
        assert_eq!(parsed["params"]["_meta"]["thinkingEffort"], "high");
        reply_end_turn(&mut agent_stdout, &parsed["id"]).await;
        h.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn stream_input_emits_result_event_on_stop_reason() {
        let (mut session, mut agent_stdout, mut agent_stdin) = build_test_session();
        let mut rx = session.message_rx.take().unwrap();
        let stub = stub_from(&session);
        let h = tokio::spawn(async move { stub.stream_input(json!("hi")).await });
        let parsed = next_request(&mut agent_stdin).await;
        reply_end_turn(&mut agent_stdout, &parsed["id"]).await;
        h.await.unwrap().unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(event.is_result());
    }

    #[tokio::test]
    async fn respond_permission_with_no_pending_returns_error() {
        let (session, _agent_stdout, _agent_stdin) = build_test_session();
        let err = session
            .respond_permission(RuntimePermissionResponse {
                request_id: "missing".into(),
                decision: RuntimePermissionDecision::AllowOnce,
                option_id: None,
                feedback: None,
                updated_input: None,
            })
            .await
            .expect_err("should error");
        assert!(err.to_string().contains("no pending"));
    }

    #[tokio::test]
    async fn respond_permission_writes_response_with_stashed_id() {
        let (session, _agent_stdout, mut agent_stdin) = build_test_session();
        session
            .pending_permissions
            .write()
            .await
            .insert("perm-7".into(), json!("perm-7"));
        let stub = stub_from(&session);
        let h = tokio::spawn(async move {
            stub.respond_permission(RuntimePermissionResponse {
                request_id: "perm-7".into(),
                decision: RuntimePermissionDecision::AllowOnce,
                option_id: Some("y1".into()),
                feedback: None,
                updated_input: None,
            })
            .await
        });
        let parsed = next_request(&mut agent_stdin).await;
        assert_eq!(parsed["id"], "perm-7");
        assert_eq!(parsed["result"]["outcome"]["outcome"], "selected");
        assert_eq!(parsed["result"]["outcome"]["optionId"], "y1");
        h.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn close_rejects_and_drains_unanswered_permissions() {
        let (mut session, _agent_stdout, mut agent_stdin) = build_test_session();
        session
            .pending_permissions
            .write()
            .await
            .insert("perm-close".into(), json!("perm-close"));
        session.close().await;
        let cancel = next_request(&mut agent_stdin).await;
        assert_eq!(cancel["method"], "session/cancel");
        let reject = next_request(&mut agent_stdin).await;
        assert_eq!(reject["id"], "perm-close");
        assert_eq!(reject["error"]["code"], -32800);
        assert!(session.pending_permissions.read().await.is_empty());
    }
}
