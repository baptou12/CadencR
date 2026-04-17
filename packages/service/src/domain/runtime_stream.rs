use crate::domain::agents::adapter::{
    AgentRuntimeAdapter, RuntimeEvent, RuntimePermissionRequest, RuntimeStreamEvent,
};
use crate::domain::workflow::engine::AgentSlot;
use crate::domain::ws_session::protocol::{
    PermissionRequestPayload, WorkflowPermissionRequestPayload,
};

pub(crate) fn permission_request_payload(
    request: RuntimePermissionRequest,
) -> PermissionRequestPayload {
    PermissionRequestPayload {
        request_id: request.request_id,
        tool_name: request.tool_name,
        tool_input: request.tool_input,
        description: request.description,
        pattern: request.pattern,
        preview: request.preview,
        options: request.options.into_iter().map(Into::into).collect(),
    }
}

pub(crate) fn workflow_permission_request_payload(
    feature_id: i64,
    agent_slot: AgentSlot,
    request: RuntimePermissionRequest,
) -> WorkflowPermissionRequestPayload {
    let payload = permission_request_payload(request);

    WorkflowPermissionRequestPayload {
        feature_id,
        agent_slot,
        request_id: payload.request_id,
        tool_name: payload.tool_name,
        tool_input: payload.tool_input,
        description: payload.description,
        pattern: payload.pattern,
        preview: payload.preview,
        options: payload.options,
    }
}

pub(crate) fn capture_runtime_session_id(
    runtime_event: &RuntimeEvent,
    needs_capture: &mut bool,
) -> Option<String> {
    if !*needs_capture {
        return None;
    }

    let Some(runtime_session_id) = runtime_event.session_id() else {
        return None;
    };

    if runtime_session_id.is_empty() {
        return None;
    }

    *needs_capture = false;
    Some(runtime_session_id.to_string())
}

pub(crate) fn update_context_window(
    runtime_adapter: Option<&dyn AgentRuntimeAdapter>,
    runtime_event: &RuntimeEvent,
    active_model: Option<&str>,
) -> Option<u64> {
    runtime_adapter
        .and_then(|adapter| adapter.context_window_for_event(runtime_event, active_model))
        .or_else(|| {
            runtime_event
                .context_window()
                .or_else(|| runtime_event.init().and_then(|init| init.context_window))
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RuntimeUsageSnapshot {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RuntimeUsageUpdate {
    pub snapshot: RuntimeUsageSnapshot,
    pub changed: bool,
    pub context_window_changed: bool,
}

pub(crate) struct RuntimeUsageState {
    active_model: Option<String>,
    snapshot: RuntimeUsageSnapshot,
}

impl RuntimeUsageState {
    pub(crate) fn new(context_window: Option<u64>) -> Self {
        Self {
            active_model: None,
            snapshot: RuntimeUsageSnapshot {
                input_tokens: 0,
                output_tokens: 0,
                context_window,
            },
        }
    }

    pub(crate) fn apply_event(
        &mut self,
        runtime_adapter: Option<&dyn AgentRuntimeAdapter>,
        runtime_event: &RuntimeEvent,
    ) -> RuntimeUsageUpdate {
        let mut changed = false;
        let mut context_window_changed = false;

        if let Some(RuntimeStreamEvent::MessageStart {
            model,
            input_tokens,
        }) = runtime_event.stream_event()
        {
            if let Some(next_model) = model {
                self.active_model = Some(next_model.clone());
            }
            if let Some(next_input_tokens) = input_tokens {
                changed |= self.snapshot.input_tokens != *next_input_tokens;
                self.snapshot.input_tokens = *next_input_tokens;
            }
        }

        if let Some(next_context_window) =
            update_context_window(runtime_adapter, runtime_event, self.active_model.as_deref())
        {
            context_window_changed = self.snapshot.context_window != Some(next_context_window);
            changed |= context_window_changed;
            self.snapshot.context_window = Some(next_context_window);
        }

        if let Some(usage) = runtime_event.usage().filter(|usage| !usage.is_zero()) {
            changed |= self.snapshot.input_tokens != usage.input_tokens
                || self.snapshot.output_tokens != usage.output_tokens;
            self.snapshot.input_tokens = usage.input_tokens;
            self.snapshot.output_tokens = usage.output_tokens;
        }

        RuntimeUsageUpdate {
            snapshot: self.snapshot,
            changed,
            context_window_changed,
        }
    }
}

pub(crate) async fn persist_usage(
    runtime_event: &RuntimeEvent,
    db_session_id: i64,
    write_pool: &sqlx::SqlitePool,
) -> bool {
    let Some(usage) = runtime_event.usage() else {
        return false;
    };

    if usage.is_zero() {
        return false;
    }

    crate::domain::ws_session::persistence::WsSessionPersistence::update_token_usage(
        write_pool,
        db_session_id,
        usage.input_tokens,
        usage.output_tokens,
    )
    .await;

    true
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        capture_runtime_session_id, permission_request_payload, update_context_window,
        workflow_permission_request_payload,
    };
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
        RuntimeInitEvent, RuntimePermissionDecision, RuntimePermissionOption,
        RuntimePermissionRequest,
    };
    use crate::domain::agents::claude_code::CLAUDE_CODE_ADAPTER;
    use crate::domain::workflow::engine::AgentSlot;

    #[test]
    fn permission_request_payload_preserves_options() {
        let payload = permission_request_payload(RuntimePermissionRequest {
            request_id: "req-1".into(),
            tool_name: "Read".into(),
            tool_input: json!({ "path": "/tmp/file" }),
            description: Some("read a file".into()),
            pattern: Some("Read(/tmp/*)".into()),
            preview: Some("preview".into()),
            options: vec![RuntimePermissionOption {
                decision: RuntimePermissionDecision::AllowOnce,
                label: "Allow once".into(),
                description: "Allow this read".into(),
                collect_feedback: false,
            }],
        });

        assert_eq!(payload.request_id, "req-1");
        assert_eq!(payload.tool_name, "Read");
        assert_eq!(payload.options.len(), 1);
    }

    #[test]
    fn workflow_permission_request_payload_keeps_workflow_fields_explicit() {
        let payload = workflow_permission_request_payload(
            42,
            AgentSlot::Plan,
            RuntimePermissionRequest {
                request_id: "req-2".into(),
                tool_name: "Write".into(),
                tool_input: json!({ "path": "/tmp/file" }),
                description: None,
                pattern: None,
                preview: None,
                options: vec![],
            },
        );

        assert_eq!(payload.feature_id, 42);
        assert_eq!(payload.agent_slot, AgentSlot::Plan);
        assert_eq!(payload.request_id, "req-2");
    }

    #[test]
    fn capture_runtime_session_id_only_returns_once() {
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some("sess-123".into()),
                usage: None,
                context_window: None,
                raw: json!({ "type": "stream_event" }),
            },
            RuntimeEventKind::AssistantMessage {
                message: crate::domain::agents::adapter::RuntimeAssistantMessage {
                    model: None,
                    content: vec![RuntimeContentBlock::Other],
                },
                parent_tool_use_id: None,
            },
        );
        let mut needs_capture = true;

        assert_eq!(
            capture_runtime_session_id(&event, &mut needs_capture),
            Some("sess-123".into())
        );
        assert_eq!(capture_runtime_session_id(&event, &mut needs_capture), None);
    }

    #[test]
    fn update_context_window_reads_metadata_context_window() {
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: None,
                usage: None,
                context_window: Some(1_000_000),
                raw: json!({ "type": "result" }),
            },
            RuntimeEventKind::Result,
        );

        assert_eq!(update_context_window(None, &event, None), Some(1_000_000));
    }

    #[test]
    fn update_context_window_reads_opencode_init_value() {
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: None,
                usage: None,
                context_window: None,
                raw: json!({ "type": "init" }),
            },
            RuntimeEventKind::Init(RuntimeInitEvent {
                model: Some("claude-opus-4-6".into()),
                mcp_servers: vec![],
                context_window: Some(123_456),
            }),
        );

        assert_eq!(update_context_window(None, &event, None), Some(123_456));
    }

    #[test]
    fn update_context_window_uses_active_model_from_raw_json() {
        // When switching models, the result's modelUsage may contain entries
        // for multiple models. With active_model, we pick the right one.
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: None,
                usage: None,
                context_window: Some(1_000_000), // max() set by normalize_event
                raw: json!({
                    "type": "result",
                    "modelUsage": {
                        "claude-opus-4-7[1m]": { "contextWindow": 1_000_000 },
                        "claude-sonnet-4-6": { "contextWindow": 200_000 }
                    }
                }),
            },
            RuntimeEventKind::Result,
        );

        // Without active model, falls back to metadata max (1M)
        assert_eq!(
            update_context_window(Some(&CLAUDE_CODE_ADAPTER), &event, None),
            Some(1_000_000)
        );
        // With active model set to sonnet, picks sonnet's 200k
        assert_eq!(
            update_context_window(
                Some(&CLAUDE_CODE_ADAPTER),
                &event,
                Some("claude-sonnet-4-6"),
            ),
            Some(200_000)
        );
        // With active model set to opus, picks opus's 1M
        assert_eq!(
            update_context_window(
                Some(&CLAUDE_CODE_ADAPTER),
                &event,
                Some("claude-opus-4-7[1m]"),
            ),
            Some(1_000_000)
        );
    }

    #[test]
    fn update_context_window_uses_single_claude_model_when_alias_does_not_match() {
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: None,
                usage: None,
                context_window: Some(1_000_000),
                raw: json!({
                    "type": "result",
                    "modelUsage": {
                        "claude-opus-4-7[1m]": { "contextWindow": 1_000_000 }
                    }
                }),
            },
            RuntimeEventKind::Result,
        );

        assert_eq!(
            update_context_window(Some(&CLAUDE_CODE_ADAPTER), &event, Some("default")),
            Some(1_000_000)
        );
    }

    #[test]
    fn update_context_window_returns_none_when_event_has_no_authoritative_value() {
        // An assistant delta or intermediate event carries no context-window
        // info — the caller should keep its current value unchanged.
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some("s1".into()),
                usage: None,
                context_window: None,
                raw: json!({ "type": "stream_event" }),
            },
            RuntimeEventKind::AssistantMessage {
                message: crate::domain::agents::adapter::RuntimeAssistantMessage {
                    model: None,
                    content: vec![RuntimeContentBlock::Other],
                },
                parent_tool_use_id: None,
            },
        );

        assert_eq!(update_context_window(None, &event, None), None);
    }
}
