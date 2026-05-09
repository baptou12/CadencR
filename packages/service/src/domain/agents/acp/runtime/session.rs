//! Provider-neutral ACP session. Implements `AgentRuntimeSession`, dispatches
//! `session/prompt` and `session/cancel`, owns the per-session terminal
//! registry and pending-permissions map, and delegates provider-specific
//! choices (model id mapping, permission decisions, tool name aliases) to
//! `AcpProviderHooks`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;

use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{
    AgentRuntimeSession, RuntimeError, RuntimeEvent, RuntimeMessageRx, RuntimePermissionMode,
    RuntimePermissionResponse,
};

use super::config_options::{set_config_option_model, set_config_option_thinking_effort};
use super::events_stream_blocks::EventIndexer;
use super::mode_switch::set_session_mode;
use super::permissions::{
    acp_permission_response_payload, reject_all_pending, take_pending, PendingPermissions,
};
use super::prompt_turn::{acp_prompt_blocks_from_content, build_prompt_params};
use super::provider_hooks::AcpProviderHooks;
use super::session_permissions::SessionPermissions;
use super::turn_lifecycle::{
    finalize_cancelled_turn, finalize_turn, request_prompt_with_cancel, PromptCancel,
    PromptRequestOutcome, PromptTurnLock,
};

/// Channel buffer for the per-session runtime stream. Matches the size used
/// by other adapters; deltas are coalesced upstream so even noisy turns fit.
pub const MESSAGE_CHANNEL_CAPACITY: usize = 1024;

/// Provider-neutral ACP session.
pub struct AcpRuntimeSession {
    pub(super) client: AcpClient,
    pub(super) session_id: Arc<RwLock<Option<String>>>,
    pub(super) current_model: Arc<RwLock<Option<String>>>,
    pub(super) current_effort: Arc<RwLock<Option<String>>>,
    pub(super) current_mode: Arc<RwLock<String>>,
    /// Tracks whether the agent supports `session/set_config_option`.
    /// Defaults to `true`; flipped to `false` on the first `MethodNotFound`
    /// response so we stop wasting round trips and let the legacy
    /// "ride-along on the next prompt" fallback handle model/effort changes.
    pub(super) supports_set_config_option: Arc<AtomicBool>,
    /// Tracks whether the agent supports `session/set_mode`.
    pub(super) supports_set_mode: Arc<AtomicBool>,
    pub(super) pending_permissions: PendingPermissions,
    /// In-memory map of `allow_for_session` / `allow_always` decisions.
    /// Cleared on session close.
    pub(super) session_permissions: SessionPermissions,
    pub(super) closing: Arc<AtomicBool>,
    pub(super) pid: Option<u32>,
    pub(super) context_window: Option<u64>,
    pub(super) message_rx: Option<RuntimeMessageRx>,
    pub(super) loop_task: Option<JoinHandle<()>>,
    pub(super) local_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    pub(super) hooks: Arc<dyn AcpProviderHooks>,
    /// Shared streaming-block indexer (also held by the event loop) used to
    /// drain still-open text/thinking blocks at turn end (W4).
    pub(super) indexer: Arc<StdMutex<EventIndexer>>,
    /// Serialises prompt turns so a second `stream_input` waits for the
    /// in-flight turn (request + post-response drain) to finish before
    /// sending its own `session/prompt` (W4).
    pub(super) prompt_turn_lock: PromptTurnLock,
    pub(super) prompt_cancel: PromptCancel,
}

impl AcpRuntimeSession {
    pub async fn current_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn require_session_id(&self) -> Result<String, RuntimeError> {
        self.current_session_id()
            .await
            .ok_or_else(|| RuntimeError::new("ACP session id not yet known"))
    }
}

#[async_trait]
impl AgentRuntimeSession for AcpRuntimeSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        self.message_rx
            .take()
            .expect("AcpRuntimeSession message_rx already taken")
    }

    fn context_window(&self) -> Option<u64> {
        self.context_window
    }

    async fn session_id(&self) -> Option<String> {
        self.current_session_id().await
    }

    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError> {
        // Hold the per-session prompt-turn lock for the entire request +
        // post-response drain so a second `stream_input` queues behind the
        // in-flight turn. `interrupt()` does NOT take this lock; it
        // pre-empts via `session/cancel` and the cancelled response then
        // releases the lock through the same drain path below.
        let _guard = self.prompt_turn_lock.lock().await;
        let session_id = self.require_session_id().await?;
        let prompt = acp_prompt_blocks_from_content(content);
        let supports = self.supports_set_config_option.load(Ordering::SeqCst);
        let model = self.current_model.read().await.clone();
        let effort = self.current_effort.read().await.clone();
        let params = build_prompt_params(
            &session_id,
            prompt,
            model.as_deref(),
            effort.as_deref(),
            supports,
        );
        // `session/prompt` represents a whole agent turn — sit-idle ceilings
        // need to be huge (minutes of permission drawers + long tools).
        let response =
            match request_prompt_with_cancel(&self.client, params, &self.prompt_cancel).await? {
                PromptRequestOutcome::Completed(response) => response,
                PromptRequestOutcome::Cancelled => {
                    finalize_cancelled_turn(
                        &self.local_tx,
                        &self.indexer,
                        Some(session_id),
                        self.context_window,
                    )
                    .await;
                    return Ok(());
                }
            };
        if let Some(reason) = response.get("stopReason").and_then(Value::as_str) {
            tracing::debug!(stop_reason = reason, "session/prompt completed");
            finalize_turn(
                &self.local_tx,
                &self.indexer,
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
        self.prompt_cancel.cancel_current_turn();
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
        reject_all_pending(&self.client, &self.pending_permissions).await;
        // Drop session-scoped permission grants on close.
        self.session_permissions.clear().await;
        if let Some(task) = self.loop_task.take() {
            task.abort();
        }
        self.client.shutdown().await;
    }

    async fn set_model(&self, model: &str) -> Result<(), RuntimeError> {
        // Schema-correct path: `session/set_config_option`. Falls back to
        // ride-along on the next `session/prompt` if the agent rejects the
        // method (older `opencode acp` builds).
        let session_id = self.require_session_id().await?;
        set_config_option_model(
            &self.client,
            &session_id,
            &self.current_model,
            &self.supports_set_config_option,
            model,
        )
        .await
    }

    fn applies_thinking_effort_in_place(&self) -> bool {
        true
    }

    async fn set_thinking_effort(&self, effort: Option<String>) -> Result<(), RuntimeError> {
        let session_id = self.require_session_id().await?;
        set_config_option_thinking_effort(
            &self.client,
            &session_id,
            &self.current_effort,
            &self.supports_set_config_option,
            effort.as_deref(),
        )
        .await
    }

    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        let mode_id = self.hooks.mode_for_permission_mode(mode).unwrap_or("build");
        let session_id = self.require_session_id().await?;
        set_session_mode(
            &self.client,
            &session_id,
            &self.current_mode,
            &self.supports_set_mode,
            mode_id,
        )
        .await
    }

    async fn respond_permission(
        &self,
        response: RuntimePermissionResponse,
    ) -> Result<(), RuntimeError> {
        // Try the default ACP path first: only if the request_id matches a
        // pending server-request do we answer it directly. Otherwise we fall
        // through to the provider-specific hook (e.g. OpenCode's question
        // sidecar) before surfacing a "no pending" error.
        if let Some(pending) = take_pending(&self.pending_permissions, &response.request_id).await {
            // Cache session/always grants; one-shot variants are no-ops.
            self.session_permissions
                .record(pending.key, response.decision)
                .await;
            let payload = acp_permission_response_payload(
                response.decision,
                response.option_id.as_deref(),
                response.feedback.as_deref(),
            );
            return self
                .client
                .respond_server_request(pending.server_id, payload)
                .await
                .map_err(|e| RuntimeError::new(format!("respond_permission write failed: {e}")));
        }
        let request_id = response.request_id.clone();
        if self.hooks.respond_permission_fallback(response).await? {
            return Ok(());
        }
        Err(RuntimeError::new(format!(
            "no pending ACP permission for request_id {}",
            request_id
        )))
    }

    fn pid(&self) -> Option<u32> {
        self.pid
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
