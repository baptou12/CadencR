use crate::domain::agents::adapter::{RuntimeEvent, RuntimePermissionRequest};
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
    runtime_event: &RuntimeEvent,
    current_context_window: u64,
) -> Option<u64> {
    let Some(init) = runtime_event.init() else {
        return None;
    };

    let next_context_window = init.context_window.unwrap_or_else(|| {
        init.model
            .as_deref()
            .map(crate::domain::usage::context_window_for_model)
            .unwrap_or(current_context_window)
    });

    Some(next_context_window)
}

pub(crate) async fn persist_usage(
    runtime_event: &RuntimeEvent,
    db_session_id: i64,
    write_pool: &sqlx::SqlitePool,
) -> Option<(u64, u64)> {
    let Some(usage) = runtime_event.usage() else {
        return None;
    };

    if usage.is_zero() {
        return None;
    }

    crate::domain::ws_session::persistence::WsSessionPersistence::update_token_usage(
        write_pool,
        db_session_id,
        usage.input_tokens,
        usage.output_tokens,
    )
    .await;

    Some((usage.input_tokens, usage.output_tokens))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        capture_runtime_session_id, permission_request_payload,
        workflow_permission_request_payload, update_context_window,
    };
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
        RuntimeInitEvent, RuntimePermissionDecision, RuntimePermissionOption,
        RuntimePermissionRequest,
    };
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

        assert_eq!(capture_runtime_session_id(&event, &mut needs_capture), Some("sess-123".into()));
        assert_eq!(capture_runtime_session_id(&event, &mut needs_capture), None);
    }

    #[test]
    fn update_context_window_prefers_init_value() {
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: None,
                usage: None,
                raw: json!({ "type": "init" }),
            },
            RuntimeEventKind::Init(RuntimeInitEvent {
                model: Some("claude-opus-4-6".into()),
                mcp_servers: vec![],
                context_window: Some(123_456),
            }),
        );

        assert_eq!(update_context_window(&event, 10), Some(123_456));
    }
}
