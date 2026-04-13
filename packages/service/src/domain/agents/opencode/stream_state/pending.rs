use std::collections::HashMap;

use super::subtasks::SubtaskState;

type MessageKey = (String, String);

pub(super) enum PendingMessageEvent {
    Part(opencode_sdk_rs::MessagePart),
    Delta {
        part_id: String,
        field: String,
        delta: String,
    },
}

pub(super) enum PendingSessionEvent {
    Message(opencode_sdk_rs::Message),
    Part {
        message_id: String,
        part: opencode_sdk_rs::MessagePart,
    },
    Delta {
        message_id: String,
        part_id: String,
        field: String,
        delta: String,
    },
    Finish,
}

pub(super) struct PendingState {
    message_roles: HashMap<MessageKey, opencode_sdk_rs::MessageRole>,
    pending_message_events: HashMap<MessageKey, Vec<PendingMessageEvent>>,
    pending_session_events: HashMap<String, Vec<PendingSessionEvent>>,
    subtasks: SubtaskState,
}

impl PendingState {
    pub(super) fn new() -> Self {
        Self {
            message_roles: HashMap::new(),
            pending_message_events: HashMap::new(),
            pending_session_events: HashMap::new(),
            subtasks: SubtaskState::new(),
        }
    }

    pub(super) fn register_message(
        &mut self,
        message: &opencode_sdk_rs::Message,
    ) -> Option<Vec<PendingMessageEvent>> {
        let key = message_key(&message.session_id, &message.id);
        let pending_events = self.pending_message_events.remove(&key);
        self.message_roles.insert(key, message.role.clone());
        pending_events
    }

    pub(super) fn message_role(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> Option<&opencode_sdk_rs::MessageRole> {
        self.message_roles.get(&message_key(session_id, message_id))
    }

    pub(super) fn buffer_message_event(
        &mut self,
        session_id: &str,
        message_id: &str,
        event: PendingMessageEvent,
    ) {
        self.pending_message_events
            .entry(message_key(session_id, message_id))
            .or_default()
            .push(event);
    }

    pub(super) fn buffer_session_message(&mut self, message: opencode_sdk_rs::Message) {
        self.pending_session_events
            .entry(message.session_id.clone())
            .or_default()
            .push(PendingSessionEvent::Message(message));
    }

    pub(super) fn buffer_session_part(
        &mut self,
        session_id: &str,
        message_id: &str,
        part: opencode_sdk_rs::MessagePart,
    ) {
        self.pending_session_events
            .entry(session_id.to_string())
            .or_default()
            .push(PendingSessionEvent::Part {
                message_id: message_id.to_string(),
                part,
            });
    }

    pub(super) fn buffer_session_delta(
        &mut self,
        session_id: &str,
        message_id: &str,
        part_id: &str,
        field: &str,
        delta: &str,
    ) {
        self.pending_session_events
            .entry(session_id.to_string())
            .or_default()
            .push(PendingSessionEvent::Delta {
                message_id: message_id.to_string(),
                part_id: part_id.to_string(),
                field: field.to_string(),
                delta: delta.to_string(),
            });
    }

    pub(super) fn buffer_session_finish(&mut self, session_id: &str) {
        self.pending_session_events
            .entry(session_id.to_string())
            .or_default()
            .push(PendingSessionEvent::Finish);
    }

    pub(super) fn take_session_events(
        &mut self,
        session_id: &str,
    ) -> Option<Vec<PendingSessionEvent>> {
        self.pending_session_events.remove(session_id)
    }

    pub(super) fn should_buffer_session(&self, root_session_id: &str, session_id: &str) -> bool {
        self.subtasks
            .should_buffer_session(root_session_id, session_id)
    }

    pub(super) fn register_child_session(
        &mut self,
        session: &opencode_sdk_rs::Session,
    ) -> Option<String> {
        self.subtasks.register_child_session(session)
    }

    pub(super) fn note_subtask_part(
        &mut self,
        session_id: &str,
        part: &opencode_sdk_rs::MessagePart,
    ) -> Option<String> {
        self.subtasks.note_subtask_part(session_id, part)
    }

    pub(super) fn parent_tool_use_id_for_session(&self, session_id: &str) -> Option<&str> {
        self.subtasks.parent_tool_use_id_for_session(session_id)
    }
}

fn message_key(session_id: &str, message_id: &str) -> MessageKey {
    (session_id.to_string(), message_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::LoopState;

    fn assistant_message(
        session_id: &str,
        id: &str,
        parts: Vec<opencode_sdk_rs::MessagePart>,
    ) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            id: id.to_string(),
            session_id: session_id.to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts,
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: true,
        }
    }

    #[test]
    fn child_part_events_are_not_dropped_before_message_role_arrives() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(
            assistant_message(
                "root",
                "msg_root",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "task_1".to_string(),
                    tool_id: "task_1".to_string(),
                    name: "Task".to_string(),
                    input: serde_json::json!({ "description": "Explore" }),
                }],
            ),
            &mut output,
        );
        state.on_session_updated(
            opencode_sdk_rs::Session {
                id: "child_1".to_string(),
                title: None,
                directory: "/tmp".to_string(),
                status: opencode_sdk_rs::SessionStatus::Active,
                parent_id: Some("root".to_string()),
                created_at: None,
                updated_at: None,
            },
            &mut output,
        );

        output.clear();
        state.on_part(
            "child_1",
            "msg_child",
            &opencode_sdk_rs::MessagePart::Text {
                id: "part_1".to_string(),
                text: "hello".to_string(),
            },
            &mut output,
        );
        assert!(output.is_empty());

        state.on_message(
            assistant_message("child_1", "msg_child", Vec::new()),
            &mut output,
        );

        assert!(!output.is_empty());
        assert!(output
            .iter()
            .all(|event| event.parent_tool_use_id() == Some("task_1")));
    }
}
