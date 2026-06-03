use axum::extract::ws::Message;
use tracing::{debug, error, info};

use crate::domain::agents::adapter::{AgentRuntimeAdapter, RuntimeError, RuntimeEvent};
use crate::domain::runtime_stream::{
    capture_runtime_session_id, permission_request_payload, persist_usage,
};
use crate::domain::session_status::AgentStatus;
use crate::domain::ws_session::persistence::{
    raw_event_with_agent_message_id, PendingUserInput, PersistedMessageRef, WsSessionPersistence,
};
use crate::domain::ws_session::protocol::{
    PermissionRequestPayload, SessionEndedPayload, SessionErrorPayload, SessionMessagePayload,
    SessionUsageUpdatePayload, WsEnvelope,
};

use super::super::send_runtime_session_id;
use super::mcp_servers::{refresh_mcp_servers_for_active_session, send_mcp_servers_if_init};
use super::stream_reader_forward::{forward_immediate_event, ForwardOutcome};
use super::stream_reader_task::{EventOutcome, StreamReaderState, StreamReaderTask};

impl StreamReaderTask {
    pub(super) async fn handle_runtime_event(
        &self,
        state: &mut StreamReaderState,
        runtime_adapter: Option<&'static dyn AgentRuntimeAdapter>,
        persistence: &mut WsSessionPersistence,
        runtime_event: RuntimeEvent,
    ) -> EventOutcome {
        state.last_runtime_activity = tokio::time::Instant::now();

        match forward_immediate_event(self, &runtime_event).await {
            ForwardOutcome::Forwarded => return EventOutcome::Continue,
            ForwardOutcome::SenderClosed => return EventOutcome::Break,
            ForwardOutcome::NotHandled => {}
        }

        if self
            .handle_permission_request(runtime_adapter, &runtime_event)
            .await
        {
            return EventOutcome::Continue;
        }

        self.capture_runtime_session_id(state, &runtime_event).await;
        if self.send_mcp_servers_if_init(&runtime_event).await.is_err() {
            return EventOutcome::Break;
        }

        if self.handle_non_result_signal(state, &runtime_event).await {
            return EventOutcome::Continue;
        }

        self.persist_and_forward_event(state, runtime_adapter, persistence, &runtime_event)
            .await
    }

    async fn handle_permission_request(
        &self,
        runtime_adapter: Option<&'static dyn AgentRuntimeAdapter>,
        runtime_event: &RuntimeEvent,
    ) -> bool {
        let Some(request) = runtime_adapter
            .and_then(|adapter| adapter.parse_permission_request(runtime_event.raw_json()))
        else {
            return false;
        };
        let is_question = request.tool_name == "AskUserQuestion";
        let payload: PermissionRequestPayload = permission_request_payload(request);
        let question_payload = is_question.then(|| {
            serde_json::json!({
                "tool_name": payload.tool_name.clone(),
                "tool_input": payload.tool_input.clone(),
                "request_id": payload.request_id.clone(),
                "pattern": payload.pattern.clone(),
            })
        });
        self.persist_pending_user_input(&payload, question_payload.as_ref())
            .await;
        let envelope = WsEnvelope::new(
            "session",
            "permission.request",
            serde_json::to_value(&payload).unwrap(),
        );
        let _ = self
            .sender
            .send(Message::Text(String::from(envelope).into()));
        true
    }

    async fn persist_pending_user_input(
        &self,
        payload: &PermissionRequestPayload,
        question_payload: Option<&serde_json::Value>,
    ) {
        let pending = question_payload
            .map(PendingUserInput::Question)
            .unwrap_or(PendingUserInput::Permission(payload));
        WsSessionPersistence::mark_awaiting_user_static(
            &self.write_pool,
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            &pending,
        )
        .await;
    }

    async fn capture_runtime_session_id(
        &self,
        state: &mut StreamReaderState,
        runtime_event: &RuntimeEvent,
    ) {
        let Some(runtime_sid) =
            capture_runtime_session_id(runtime_event, &mut state.needs_session_id_capture)
        else {
            return;
        };
        state.runtime_session_id = Some(runtime_sid.clone());
        state.usage_state.set_root_session_id(&runtime_sid);
        info!(self.db_session_id, runtime_session_id = %runtime_sid, "stream_reader: persisting runtime session_id to DB");
        WsSessionPersistence::persist_runtime_session_id_static(
            &self.write_pool,
            self.db_session_id,
            &self.runtime_provider,
            &runtime_sid,
        )
        .await;
        send_runtime_session_id(&self.sender, &runtime_sid);
    }

    async fn send_mcp_servers_if_init(&self, runtime_event: &RuntimeEvent) -> Result<(), ()> {
        let result = send_mcp_servers_if_init(
            &self.sender,
            &self.sdk_sessions,
            self.db_session_id,
            runtime_event,
        )
        .await;
        if result.is_err() {
            debug!(
                self.db_session_id,
                "WebSocket sender closed during mcp_servers forward"
            );
        }
        result
    }

    async fn handle_non_result_signal(
        &self,
        state: &mut StreamReaderState,
        runtime_event: &RuntimeEvent,
    ) -> bool {
        if runtime_event.is_result() {
            return false;
        }
        if crate::domain::session_status::event_starts_fresh_turn(runtime_event) {
            state.between_turns = false;
        }
        if !state.between_turns {
            self.broadcast_runtime_signal(state, runtime_event).await;
        }
        runtime_event.is_turn_started_signal()
    }

    async fn broadcast_runtime_signal(
        &self,
        state: &mut StreamReaderState,
        runtime_event: &RuntimeEvent,
    ) {
        let Some(signal) = crate::domain::session_status::provider_signal_for_event(runtime_event)
        else {
            return;
        };
        let next = signal.status();
        if state.last_signal_status == Some(next) {
            return;
        }
        if runtime_event.is_turn_started_signal() && next == AgentStatus::Agent {
            WsSessionPersistence::mark_running_static(&self.write_pool, self.db_session_id).await;
        }
        WsSessionPersistence::broadcast_session_signal(
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            signal,
        );
        state.last_signal_status = Some(next);
    }

    async fn persist_and_forward_event(
        &self,
        state: &mut StreamReaderState,
        runtime_adapter: Option<&'static dyn AgentRuntimeAdapter>,
        persistence: &mut WsSessionPersistence,
        runtime_event: &RuntimeEvent,
    ) -> EventOutcome {
        let usage_update = state
            .usage_state
            .apply_event(runtime_adapter, runtime_event);
        if usage_update.context_window_changed {
            WsSessionPersistence::update_context_window(
                &self.write_pool,
                self.db_session_id,
                usage_update.snapshot.context_window,
            )
            .await;
        }

        let persisted_message = persistence.persist_runtime_event(runtime_event).await;
        if !usage_update.is_subagent {
            let _ = persist_usage(runtime_event, self.db_session_id, &self.write_pool).await;
        }
        if usage_update.changed
            && (usage_update.snapshot.input_tokens > 0 || usage_update.snapshot.output_tokens > 0)
        {
            self.send_usage_update(
                usage_update.snapshot.input_tokens,
                usage_update.snapshot.output_tokens,
                usage_update.snapshot.context_window,
            )
            .await;
        }

        let envelope = self
            .runtime_event_envelope(state, runtime_event, persisted_message)
            .await;
        if self
            .send_and_mirror(Message::Text(String::from(envelope).into()))
            .await
        {
            debug!(
                self.db_session_id,
                "WebSocket sender closed, stopping stream reader"
            );
            return EventOutcome::Break;
        }
        if runtime_event.is_result() && self.refresh_mcp_servers_after_turn().await.is_err() {
            return EventOutcome::Break;
        }
        EventOutcome::Continue
    }

    async fn refresh_mcp_servers_after_turn(&self) -> Result<(), ()> {
        let result = refresh_mcp_servers_for_active_session(
            &self.sender,
            &self.sdk_sessions,
            self.db_session_id,
        )
        .await;
        if result.is_err() {
            debug!(
                self.db_session_id,
                "WebSocket sender closed during post-turn mcp_servers refresh"
            );
        }
        result
    }

    async fn send_usage_update(
        &self,
        input_tokens: u64,
        output_tokens: u64,
        context_window: Option<u64>,
    ) {
        let usage_env = WsEnvelope::new(
            "session",
            "usage_update",
            serde_json::to_value(SessionUsageUpdatePayload {
                input_tokens,
                output_tokens,
                context_window,
            })
            .unwrap(),
        );
        let _ = self
            .send_and_mirror(Message::Text(String::from(usage_env).into()))
            .await;
    }

    async fn runtime_event_envelope(
        &self,
        state: &mut StreamReaderState,
        runtime_event: &RuntimeEvent,
        persisted_message: Option<PersistedMessageRef>,
    ) -> WsEnvelope {
        if runtime_event.is_result() {
            return self.result_envelope(state).await;
        }
        let block = raw_event_with_agent_message_id(runtime_event.raw_json(), persisted_message);
        WsEnvelope::new(
            "session",
            "message",
            serde_json::to_value(SessionMessagePayload {
                blocks: vec![block],
            })
            .unwrap(),
        )
    }

    async fn result_envelope(&self, state: &mut StreamReaderState) -> WsEnvelope {
        WsSessionPersistence::mark_completed_static(&self.write_pool, self.db_session_id).await;
        state.between_turns = true;
        let has_pending_user_input =
            WsSessionPersistence::get_session_row(&self.write_pool, self.db_session_id)
                .await
                .is_some_and(|row| row.has_pending_user_input());
        if !has_pending_user_input {
            WsSessionPersistence::broadcast_session_status(
                &self.session_status_tx,
                self.db_session_id,
                self.feature_id,
                AgentStatus::Idle,
                None,
            );
            state.last_signal_status = Some(AgentStatus::Idle);
        }
        WsEnvelope::new(
            "session",
            "ended",
            serde_json::to_value(SessionEndedPayload {
                reason: "turn_complete".into(),
            })
            .unwrap(),
        )
    }

    pub(super) async fn handle_stream_error(&self, error: RuntimeError) {
        let code = match &error {
            RuntimeError::CompactFailed(_) => "COMPACT_ERROR",
            _ => "SDK_ERROR",
        };
        let message = error.to_string();
        error!(self.db_session_id, error = %message, "SDK stream error");
        WsSessionPersistence::persist_error_message_static(
            &self.write_pool,
            self.db_session_id,
            &message,
            None,
        )
        .await;
        WsSessionPersistence::mark_paused_static(&self.write_pool, self.db_session_id).await;
        WsSessionPersistence::broadcast_session_status(
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            AgentStatus::Idle,
            None,
        );
        let err_env = WsEnvelope::new(
            "session",
            "error",
            serde_json::to_value(SessionErrorPayload {
                code: code.into(),
                message,
                ..Default::default()
            })
            .unwrap(),
        );
        let _ = self
            .send_and_mirror(Message::Text(String::from(err_env).into()))
            .await;
    }

    pub(super) async fn send_stream_closed(&self) {
        info!(self.db_session_id, "SDK stream closed");
        let end_env = WsEnvelope::new(
            "session",
            "ended",
            serde_json::to_value(SessionEndedPayload {
                reason: "stream_closed".into(),
            })
            .unwrap(),
        );
        let _ = self
            .send_and_mirror(Message::Text(String::from(end_env).into()))
            .await;
    }
}
