use serde_json::{json, Value};

use super::helpers::maybe_string;
use crate::tool_input::{canonical_tool_name, tool_input_from_state};
use crate::types::MessagePart;

const THINKING_VALUE_KEYS: &[&str] = &[
    "thinking",
    "reasoning",
    "reasoning_text",
    "reasoningText",
    "reasoning_content",
    "reasoningContent",
    "text",
    "content",
];

pub fn parse_part_from(part: &Value) -> MessagePart {
    let part_type = maybe_string(part, &["type"]).unwrap_or_default();
    let id = maybe_string(part, &["id"]).unwrap_or_default();
    if is_thinking_part_type(&part_type) {
        return MessagePart::Thinking {
            id,
            thinking: thinking_content(part),
        };
    }
    match part_type.as_str() {
        "text" => MessagePart::Text {
            id,
            text: maybe_string(part, &["text", "content"]).unwrap_or_default(),
        },
        "step-finish" => MessagePart::StepFinish {
            id,
            reason: maybe_string(part, &["reason"]).unwrap_or_default(),
        },
        "tool" | "tool_use" | "tool-invocation" | "tool_call" => {
            let name = canonical_tool_name(
                maybe_string(part, &["tool", "name", "tool_name"]).unwrap_or_default(),
            );
            MessagePart::ToolUse {
                id: id.clone(),
                tool_id: maybe_string(part, &["callID", "tool_id", "toolID"]).unwrap_or(id),
                input: tool_input_from_state(part),
                name,
            }
        }
        "tool_result" => MessagePart::ToolResult {
            id,
            tool_use_id: maybe_string(part, &["tool_use_id", "toolUseID"]).unwrap_or_default(),
            is_error: part
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            content: part.get("content").cloned().unwrap_or(Value::Null),
        },
        "subtask" => MessagePart::ToolUse {
            id: id.clone(),
            tool_id: id,
            name: "Task".to_string(),
            input: json!({
                "description": maybe_string(part, &["description"]).unwrap_or_default(),
                "prompt": maybe_string(part, &["prompt"]).unwrap_or_default(),
                "agent": maybe_string(part, &["agent"]).unwrap_or_default(),
            }),
        },
        "agent" => MessagePart::ToolUse {
            id: id.clone(),
            tool_id: id,
            name: "Agent".to_string(),
            input: json!({
                "name": maybe_string(part, &["name"]).unwrap_or_default(),
            }),
        },
        _ => MessagePart::Other(part.clone()),
    }
}

fn is_thinking_part_type(part_type: &str) -> bool {
    matches!(part_type, "thinking" | "reasoning") || part_type.starts_with("reasoning_")
}

fn thinking_content(part: &Value) -> String {
    maybe_string(part, THINKING_VALUE_KEYS).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse_part_from;
    use crate::types::MessagePart;
    use serde_json::json;

    #[test]
    fn parse_part_from_supports_official_tool_part() {
        let part = parse_part_from(&json!({
            "id": "prt_1",
            "type": "tool",
            "tool": "bash",
            "callID": "call_1",
            "state": {
                "status": "completed",
                "input": { "command": "git status" },
                "output": "clean"
            }
        }));

        match part {
            MessagePart::ToolUse {
                tool_id,
                name,
                input,
                ..
            } => {
                assert_eq!(tool_id, "call_1");
                assert_eq!(name, "Bash");
                assert_eq!(input["command"], "git status");
                assert_eq!(input["output"], "clean");
                assert_eq!(input["status"], "completed");
            }
            other => panic!("expected tool part, got {other:?}"),
        }
    }

    #[test]
    fn parse_part_from_merges_apply_patch_args_from_output() {
        let part = parse_part_from(&json!({
            "id": "prt_2",
            "type": "tool",
            "tool": "apply_patch",
            "callID": "call_2",
            "state": {
                "status": "completed",
                "output": {
                    "args": {
                        "patchText": "*** Begin Patch\n*** Add File: toto.txt\n+hello\n*** End Patch\n"
                    }
                }
            }
        }));

        match part {
            MessagePart::ToolUse { name, input, .. } => {
                assert_eq!(name, "ApplyPatch");
                assert_eq!(
                    input["patch_text"],
                    "*** Begin Patch\n*** Add File: toto.txt\n+hello\n*** End Patch\n"
                );
                assert_eq!(input["status"], "completed");
            }
            other => panic!("expected tool part, got {other:?}"),
        }
    }

    #[test]
    fn parse_part_from_supports_official_subtask_part() {
        let part = parse_part_from(&json!({
            "id": "subtask_1",
            "type": "subtask",
            "description": "Search the codebase",
            "prompt": "Look for auth flow",
            "agent": "explore"
        }));

        match part {
            MessagePart::ToolUse {
                id,
                tool_id,
                name,
                input,
            } => {
                assert_eq!(id, "subtask_1");
                assert_eq!(tool_id, "subtask_1");
                assert_eq!(name, "Task");
                assert_eq!(
                    input,
                    json!({
                        "description": "Search the codebase",
                        "prompt": "Look for auth flow",
                        "agent": "explore"
                    })
                );
            }
            other => panic!("expected subtask to parse as ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn parse_part_from_supports_official_agent_part() {
        let part = parse_part_from(&json!({
            "id": "agent_1",
            "type": "agent",
            "name": "general"
        }));

        match part {
            MessagePart::ToolUse {
                id,
                tool_id,
                name,
                input,
            } => {
                assert_eq!(id, "agent_1");
                assert_eq!(tool_id, "agent_1");
                assert_eq!(name, "Agent");
                assert_eq!(input, json!({ "name": "general" }));
            }
            other => panic!("expected agent part to parse as ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn parse_part_from_supports_step_finish_part() {
        let part = parse_part_from(&json!({
            "id": "prt_finish",
            "type": "step-finish",
            "reason": "stop"
        }));

        match part {
            MessagePart::StepFinish { id, reason } => {
                assert_eq!(id, "prt_finish");
                assert_eq!(reason, "stop");
            }
            other => panic!("expected step-finish part, got {other:?}"),
        }
    }

    #[test]
    fn parse_part_from_treats_reasoning_text_variants_as_thinking() {
        let part = parse_part_from(&json!({
            "id": "prt_3",
            "type": "reasoning_text",
            "reasoningText": "- inspect stream state\n- keep markdown"
        }));

        match part {
            MessagePart::Thinking { id, thinking } => {
                assert_eq!(id, "prt_3");
                assert_eq!(thinking, "- inspect stream state\n- keep markdown");
            }
            other => panic!("expected reasoning_text to parse as Thinking, got {other:?}"),
        }
    }

    #[test]
    fn parse_part_from_ignores_reasoning_fields_when_type_is_text() {
        let part = parse_part_from(&json!({
            "id": "prt_4",
            "type": "text",
            "reasoning_content": "Let me think through this.",
            "text": "fallback text"
        }));

        match part {
            MessagePart::Text { text, .. } => {
                assert_eq!(text, "fallback text");
            }
            other => panic!("expected text part to remain Text, got {other:?}"),
        }
    }
}
