use std::collections::{HashMap, HashSet};

pub(super) struct SubtaskState {
    child_parent_session_id: HashMap<String, String>,
    pending_subtasks_by_session: HashMap<String, HashSet<String>>,
    pending_child_sessions_by_parent: HashMap<String, HashSet<String>>,
    child_parent_tool_use_id: HashMap<String, String>,
}

impl SubtaskState {
    pub(super) fn new() -> Self {
        Self {
            child_parent_session_id: HashMap::new(),
            pending_subtasks_by_session: HashMap::new(),
            pending_child_sessions_by_parent: HashMap::new(),
            child_parent_tool_use_id: HashMap::new(),
        }
    }

    pub(super) fn should_buffer_session(&self, root_session_id: &str, session_id: &str) -> bool {
        session_id != root_session_id && !self.child_parent_tool_use_id.contains_key(session_id)
    }

    pub(super) fn register_child_session(
        &mut self,
        session: &opencode_sdk_rs::Session,
    ) -> Option<String> {
        let parent_session_id = session.parent_id.as_deref()?;
        self.child_parent_session_id
            .insert(session.id.clone(), parent_session_id.to_string());
        if self.child_parent_tool_use_id.contains_key(&session.id) {
            return Some(session.id.clone());
        }
        self.pending_child_sessions_by_parent
            .entry(parent_session_id.to_string())
            .or_default()
            .insert(session.id.clone());
        self.try_match_single_pending_pair(parent_session_id)
    }

    pub(super) fn note_subtask_part(
        &mut self,
        session_id: &str,
        part: &opencode_sdk_rs::MessagePart,
    ) -> Option<String> {
        let opencode_sdk_rs::MessagePart::ToolUse {
            id, name, input, ..
        } = part
        else {
            return None;
        };
        if !matches!(name.as_str(), "Task" | "Agent") {
            return None;
        }

        if let Some(child_session_id) = subtask_session_id(input) {
            self.child_parent_tool_use_id
                .insert(child_session_id.clone(), id.clone());
            self.remove_pending_subtask(session_id, id);
            self.remove_pending_child_session(&child_session_id);
            return Some(child_session_id);
        }

        self.pending_subtasks_by_session
            .entry(session_id.to_string())
            .or_default()
            .insert(id.clone());
        self.try_match_single_pending_pair(session_id)
    }

    pub(super) fn parent_tool_use_id_for_session(&self, session_id: &str) -> Option<&str> {
        self.child_parent_tool_use_id
            .get(session_id)
            .map(String::as_str)
    }

    pub(super) fn has_pending_subtasks_for_session(&self, session_id: &str) -> bool {
        self.pending_subtasks_by_session
            .get(session_id)
            .is_some_and(|pending| !pending.is_empty())
            || self
                .pending_child_sessions_by_parent
                .get(session_id)
                .is_some_and(|pending| !pending.is_empty())
    }

    fn remove_pending_subtask(&mut self, session_id: &str, tool_use_id: &str) {
        let Some(should_remove) =
            self.pending_subtasks_by_session
                .get_mut(session_id)
                .map(|pending| {
                    pending.remove(tool_use_id);
                    pending.is_empty()
                })
        else {
            return;
        };
        if should_remove {
            self.pending_subtasks_by_session.remove(session_id);
        }
    }

    fn remove_pending_child_session(&mut self, child_session_id: &str) {
        let Some(parent_session_id) = self.child_parent_session_id.get(child_session_id).cloned()
        else {
            return;
        };

        let Some(should_remove) = self
            .pending_child_sessions_by_parent
            .get_mut(&parent_session_id)
            .map(|pending| {
                pending.remove(child_session_id);
                pending.is_empty()
            })
        else {
            return;
        };

        if should_remove {
            self.pending_child_sessions_by_parent
                .remove(&parent_session_id);
        }
    }

    fn try_match_single_pending_pair(&mut self, parent_session_id: &str) -> Option<String> {
        let tool_use_id = self
            .pending_subtasks_by_session
            .get(parent_session_id)
            .filter(|pending| pending.len() == 1)
            .and_then(|pending| pending.iter().next().cloned());
        let child_session_id = self
            .pending_child_sessions_by_parent
            .get(parent_session_id)
            .filter(|pending| pending.len() == 1)
            .and_then(|pending| pending.iter().next().cloned());

        let (Some(tool_use_id), Some(child_session_id)) = (tool_use_id, child_session_id) else {
            return None;
        };

        self.remove_pending_subtask(parent_session_id, &tool_use_id);
        self.remove_pending_child_session(&child_session_id);
        self.child_parent_tool_use_id
            .insert(child_session_id.clone(), tool_use_id);
        Some(child_session_id)
    }
}

fn subtask_session_id(input: &serde_json::Value) -> Option<String> {
    input
        .get("subagent_session_id")
        .or_else(|| input.get("task_id"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
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
    fn child_session_events_inherit_parent_tool_use_id() {
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
            child_session(opencode_sdk_rs::SessionStatus::Active),
            &mut output,
        );

        output.clear();
        state.on_message(
            assistant_message(
                "child_1",
                "msg_child",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "read_1".to_string(),
                    tool_id: "call_1".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({ "file_path": "src/main.ts" }),
                }],
            ),
            &mut output,
        );

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].parent_tool_use_id(), Some("task_1"));
        assert_eq!(output[1].parent_tool_use_id(), Some("task_1"));
    }

    #[test]
    fn child_session_completion_does_not_emit_result() {
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
            child_session(opencode_sdk_rs::SessionStatus::Idle),
            &mut output,
        );

        assert!(!output.iter().any(|event| event.is_result()));
    }

    #[test]
    fn multiple_pending_subtasks_do_not_guess_child_parent_mapping() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(
            assistant_message(
                "root",
                "msg_root",
                vec![
                    opencode_sdk_rs::MessagePart::ToolUse {
                        id: "task_1".to_string(),
                        tool_id: "task_1".to_string(),
                        name: "Task".to_string(),
                        input: serde_json::json!({ "description": "Explore A" }),
                    },
                    opencode_sdk_rs::MessagePart::ToolUse {
                        id: "task_2".to_string(),
                        tool_id: "task_2".to_string(),
                        name: "Task".to_string(),
                        input: serde_json::json!({ "description": "Explore B" }),
                    },
                ],
            ),
            &mut output,
        );
        state.on_session_updated(
            child_session(opencode_sdk_rs::SessionStatus::Active),
            &mut output,
        );

        output.clear();
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
        assert!(output.is_empty());

        state.on_message(
            assistant_message(
                "root",
                "msg_root_update",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "task_2".to_string(),
                    tool_id: "task_2".to_string(),
                    name: "Task".to_string(),
                    input: serde_json::json!({
                        "description": "Explore B",
                        "subagent_session_id": "child_1",
                    }),
                }],
            ),
            &mut output,
        );

        let child_events = output
            .iter()
            .filter(|event| event.session_id() == Some("child_1"))
            .collect::<Vec<_>>();

        assert!(!child_events.is_empty());
        assert!(child_events
            .iter()
            .all(|event| event.parent_tool_use_id() == Some("task_2")));
    }

    #[test]
    fn reused_child_session_remaps_to_latest_task() {
        let mut state = LoopState::new("root".to_string(), Some("openai/gpt-5.4".to_string()));
        let mut output = Vec::new();

        state.on_message(
            assistant_message(
                "root",
                "msg_root_1",
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
            child_session(opencode_sdk_rs::SessionStatus::Active),
            &mut output,
        );

        output.clear();
        state.on_message(
            assistant_message(
                "root",
                "msg_root_2",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "task_2".to_string(),
                    tool_id: "task_2".to_string(),
                    name: "Task".to_string(),
                    input: serde_json::json!({
                        "description": "Resume",
                        "task_id": "child_1",
                        "subagent_session_id": "child_1",
                    }),
                }],
            ),
            &mut output,
        );

        output.clear();
        state.on_message(
            assistant_message(
                "child_1",
                "msg_child_2",
                vec![opencode_sdk_rs::MessagePart::ToolUse {
                    id: "read_2".to_string(),
                    tool_id: "call_2".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({ "file_path": "src/lib.rs" }),
                }],
            ),
            &mut output,
        );

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].parent_tool_use_id(), Some("task_2"));
        assert_eq!(output[1].parent_tool_use_id(), Some("task_2"));
    }
}
