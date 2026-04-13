use super::LoopState;
use crate::domain::agents::adapter::RuntimeEvent;

impl LoopState {
    pub(super) fn finish_or_defer_session(
        &mut self,
        session_id: &str,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if self.has_blocking_descendant(session_id)
            || self.has_pending_tool_uses(session_id)
            || self.has_pending_subtasks(session_id)
        {
            self.pending_finishes.insert(session_id.to_string());
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
                self.finish_or_defer_session(&parent_id, output);
            }
        }
    }

    /// Force-finish all pending sessions. Used when the SSE source closes
    /// to prevent deadlocked turns that would otherwise wait forever.
    pub(in crate::domain::agents::opencode) fn force_flush_pending(
        &mut self,
        output: &mut Vec<RuntimeEvent>,
    ) {
        let pending: Vec<String> = self.pending_finishes.iter().cloned().collect();
        for session_id in pending {
            self.finish_session(&session_id, output);
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

    fn has_blocking_descendant(&self, session_id: &str) -> bool {
        self.active_sessions
            .iter()
            .chain(self.pending_finishes.iter())
            .any(|descendant| {
                descendant != session_id && self.is_descendant_of(descendant, session_id)
            })
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

    fn user_message_with_tool_result(
        session_id: &str,
        id: &str,
        tool_use_id: &str,
    ) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            id: id.to_string(),
            session_id: session_id.to_string(),
            role: opencode_sdk_rs::MessageRole::User,
            parts: vec![opencode_sdk_rs::MessagePart::ToolResult {
                id: format!("result_{id}"),
                tool_use_id: tool_use_id.to_string(),
                is_error: false,
                content: serde_json::json!("tool output"),
            }],
            created_at: None,
            model: None,
            tokens: None,
            finished: true,
        }
    }

    fn user_message_with_text(session_id: &str, id: &str, text: &str) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            id: id.to_string(),
            session_id: session_id.to_string(),
            role: opencode_sdk_rs::MessageRole::User,
            parts: vec![opencode_sdk_rs::MessagePart::Text {
                id: format!("text_{id}"),
                text: text.to_string(),
            }],
            created_at: None,
            model: None,
            tokens: None,
            finished: true,
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

        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 0);

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
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 1);
        assert!(output.last().is_some_and(|event| event.is_result()));

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
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 0);
    }

    #[test]
    fn root_idle_waits_for_regular_tool_result_before_finishing() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(
            assistant_message(
                "root",
                "msg_root",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "tool_1".to_string(),
                    tool_id: "call_1".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({ "file_path": "src/main.rs" }),
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

        state.on_message(
            user_message_with_tool_result("root", "msg_tool_result", "tool_1"),
            &mut output,
        );
        state.on_message(
            assistant_message(
                "root",
                "msg_root_2",
                vec![opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "final summary".to_string(),
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
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 0);
    }

    #[test]
    fn finished_assistant_after_question_answer_finishes_without_session_update() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(
            assistant_message(
                "root",
                "msg_root",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "question_1".to_string(),
                    tool_id: "question_1".to_string(),
                    name: "question".to_string(),
                    input: serde_json::json!({ "question": "What next?" }),
                }],
            ),
            &mut output,
        );

        output.clear();
        state.on_message(
            user_message_with_text("root", "msg_answer", "Explore backend"),
            &mut output,
        );
        state.on_message(
            assistant_message(
                "root",
                "msg_root_2",
                vec![opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "Stopping here as requested.".to_string(),
                }],
            ),
            &mut output,
        );

        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 1);
        assert!(output.last().is_some_and(|event| event.is_result()));

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
        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 0);
    }

    #[test]
    fn step_finish_stop_part_finishes_root_without_session_update() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(
            opencode_sdk_rs::Message {
                id: "msg_root".to_string(),
                session_id: "root".to_string(),
                role: opencode_sdk_rs::MessageRole::Assistant,
                parts: Vec::new(),
                created_at: None,
                model: Some("openai/gpt-5.4".to_string()),
                tokens: None,
                finished: false,
            },
            &mut output,
        );

        state.on_part(
            "root",
            "msg_root",
            &opencode_sdk_rs::MessagePart::Text {
                id: "text_1".to_string(),
                text: "Perfect - stopping here.".to_string(),
            },
            &mut output,
        );
        state.on_part(
            "root",
            "msg_root",
            &opencode_sdk_rs::MessagePart::StepFinish {
                id: "finish_1".to_string(),
                reason: "stop".to_string(),
            },
            &mut output,
        );

        assert_eq!(output.iter().filter(|event| event.is_result()).count(), 1);
        assert!(output.last().is_some_and(|event| event.is_result()));
    }
}
