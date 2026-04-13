use super::LoopState;
use crate::domain::agents::adapter::RuntimeEvent;

impl LoopState {
    pub(super) fn finish_or_defer_session(
        &mut self,
        session_id: &str,
        status: &opencode_sdk_rs::SessionStatus,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if self
            .active_sessions
            .iter()
            .any(|active| self.is_descendant_of(active, session_id))
        {
            self.pending_finishes.insert(session_id.to_string());
            if matches!(status, opencode_sdk_rs::SessionStatus::Idle) {
                self.deferred_idle_finishes.insert(session_id.to_string());
            }
            return;
        }
        if matches!(status, opencode_sdk_rs::SessionStatus::Idle)
            && self.deferred_idle_finishes.contains(session_id)
        {
            return;
        }
        self.finish_session(session_id, output);
    }

    pub(super) fn finish_ready_ancestors(
        &mut self,
        session_id: &str,
        output: &mut Vec<RuntimeEvent>,
    ) {
        let mut current = self.session_parents.get(session_id).cloned();
        while let Some(parent_id) = current {
            current = self.session_parents.get(&parent_id).cloned();
            if self.pending_finishes.contains(&parent_id) {
                let status = if self.deferred_idle_finishes.contains(&parent_id) {
                    opencode_sdk_rs::SessionStatus::Idle
                } else {
                    opencode_sdk_rs::SessionStatus::Completed
                };
                self.finish_or_defer_session(&parent_id, &status, output);
            }
        }
    }

    fn is_descendant_of(&self, session_id: &str, ancestor_id: &str) -> bool {
        let mut current = self.session_parents.get(session_id);
        while let Some(parent_id) = current {
            if parent_id == ancestor_id {
                return true;
            }
            current = self.session_parents.get(parent_id);
        }
        false
    }
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

    fn child_session(status: opencode_sdk_rs::SessionStatus) -> opencode_sdk_rs::Session {
        opencode_sdk_rs::Session {
            id: "child_1".to_string(),
            title: None,
            directory: "/tmp".to_string(),
            status,
            parent_id: Some("root".to_string()),
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn root_finish_waits_for_active_child_session() {
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
                    input: serde_json::json!({
                        "description": "Explore",
                        "subagent_session_id": "child_1",
                    }),
                }],
            ),
            &mut output,
        );
        state.on_session_updated(
            child_session(opencode_sdk_rs::SessionStatus::Active),
            &mut output,
        );
        state.on_message(
            assistant_message(
                "child_1",
                "msg_child",
                vec![opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "working".to_string(),
                }],
            ),
            &mut output,
        );

        output.clear();
        state.on_session_updated(
            opencode_sdk_rs::Session {
                id: "root".to_string(),
                title: None,
                directory: "/tmp".to_string(),
                status: opencode_sdk_rs::SessionStatus::Idle,
                parent_id: None,
                created_at: None,
                updated_at: None,
            },
            &mut output,
        );
        assert!(!output.iter().any(|event| event.is_result()));

        state.on_session_updated(
            child_session(opencode_sdk_rs::SessionStatus::Idle),
            &mut output,
        );
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 0);

        state.on_message(
            assistant_message(
                "root",
                "msg_root_2",
                vec![opencode_sdk_rs::MessagePart::Text {
                    id: "text_2".to_string(),
                    text: "final summary".to_string(),
                }],
            ),
            &mut output,
        );
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 0);

        state.on_session_updated(
            opencode_sdk_rs::Session {
                id: "root".to_string(),
                title: None,
                directory: "/tmp".to_string(),
                status: opencode_sdk_rs::SessionStatus::Idle,
                parent_id: None,
                created_at: None,
                updated_at: None,
            },
            &mut output,
        );
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 1);
        assert!(output.last().is_some_and(|event| event.is_result()));
    }
}
