use super::LoopState;
use crate::domain::agents::adapter::RuntimeEvent;
use crate::domain::agents::opencode::events::user_message_event;

impl LoopState {
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
}
