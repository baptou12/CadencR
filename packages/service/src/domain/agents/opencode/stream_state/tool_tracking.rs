use super::LoopState;
use crate::domain::agents::adapter::RuntimeEvent;
use crate::domain::agents::opencode::events::user_message_event;

impl LoopState {
    pub(in crate::domain::agents::opencode) fn note_permission_request(
        &mut self,
        request: &opencode_sdk_rs::PermissionRequest,
    ) {
        let Some(call_id) = request.call_id.as_ref() else {
            return;
        };
        self.pending_permission_tool_use_ids.insert(
            request.id.clone(),
            (request.session_id.clone(), call_id.clone()),
        );
    }

    pub(in crate::domain::agents::opencode) fn resolve_permission_update(
        &mut self,
        request_id: &str,
        status: &str,
        output: &mut Vec<RuntimeEvent>,
    ) {
        let Some((session_id, call_id)) = self.pending_permission_tool_use_ids.remove(request_id)
        else {
            return;
        };
        if !permission_update_rejected(status) {
            return;
        }

        self.clear_pending_tool_use(&session_id, &call_id);
        self.finish_or_defer_session(&session_id, output);
        self.finish_ready_ancestors(&session_id, output);
    }

    pub(super) fn handle_user_message(
        &mut self,
        message: &opencode_sdk_rs::Message,
        output: &mut Vec<RuntimeEvent>,
    ) {
        self.resolve_tool_results(message);
        output.push(user_message_event(
            message,
            self.parent_tool_use_id_for_session(&message.session_id)
                .as_deref(),
        ));
    }

    pub(super) fn note_subtasks_from_message(
        &mut self,
        message: &opencode_sdk_rs::Message,
        output: &mut Vec<RuntimeEvent>,
    ) {
        for part in &message.parts {
            self.note_subtask_part(&message.session_id, part, output);
        }
    }

    pub(super) fn note_subtask_part(
        &mut self,
        session_id: &str,
        part: &opencode_sdk_rs::MessagePart,
        output: &mut Vec<RuntimeEvent>,
    ) {
        self.note_regular_tool_part(session_id, part);
        if let Some(child_session_id) = self.pending.note_subtask_part(session_id, part) {
            self.flush_pending_session_events(&child_session_id, output);
        }
    }

    fn note_regular_tool_part(&mut self, session_id: &str, part: &opencode_sdk_rs::MessagePart) {
        let opencode_sdk_rs::MessagePart::ToolUse { id, .. } = part else {
            return;
        };
        if !part.expects_tool_result() {
            return;
        }
        self.pending_tool_use_ids
            .entry(session_id.to_string())
            .or_default()
            .insert(id.clone());
    }

    fn resolve_tool_results(&mut self, message: &opencode_sdk_rs::Message) {
        let Some(pending_tool_use_ids) = self.pending_tool_use_ids.get_mut(&message.session_id)
        else {
            return;
        };
        for part in &message.parts {
            let opencode_sdk_rs::MessagePart::ToolResult { tool_use_id, .. } = part else {
                continue;
            };
            pending_tool_use_ids.remove(tool_use_id);
        }
        if pending_tool_use_ids.is_empty() {
            self.pending_tool_use_ids.remove(&message.session_id);
        }
    }

    fn clear_pending_tool_use(&mut self, session_id: &str, tool_use_id: &str) {
        let Some(pending_tool_use_ids) = self.pending_tool_use_ids.get_mut(session_id) else {
            return;
        };
        pending_tool_use_ids.remove(tool_use_id);
        if pending_tool_use_ids.is_empty() {
            self.pending_tool_use_ids.remove(session_id);
        }
    }
}

fn permission_update_rejected(status: &str) -> bool {
    matches!(status, "reject" | "rejected" | "deny" | "denied")
}

#[cfg(test)]
mod tests {
    use super::super::LoopState;

    fn assistant_message_with_read_tool() -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            id: "msg_1".to_string(),
            session_id: "root".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: vec![opencode_sdk_rs::MessagePart::ToolUse {
                id: "call_1".to_string(),
                tool_id: "call_1".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({ "file_path": "/etc/hosts" }),
            }],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: true,
        }
    }

    fn idle_root_session() -> opencode_sdk_rs::Session {
        opencode_sdk_rs::Session {
            id: "root".to_string(),
            title: None,
            directory: "/tmp".to_string(),
            status: opencode_sdk_rs::SessionStatus::Idle,
            parent_id: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn rejected_permission_clears_pending_tool_use_and_finishes_turn() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(assistant_message_with_read_tool(), &mut output);
        output.clear();

        state.note_permission_request(&opencode_sdk_rs::PermissionRequest {
            id: "perm_1".to_string(),
            session_id: "root".to_string(),
            call_id: Some("call_1".to_string()),
            tool_name: "Read".to_string(),
            tool_input: serde_json::json!({}),
            description: None,
        });
        state.on_session_updated(idle_root_session(), &mut output);
        assert!(!output.iter().any(|event| event.is_result()));

        state.resolve_permission_update("perm_1", "reject", &mut output);

        assert!(output.iter().any(|event| event.is_result()));
    }
}
