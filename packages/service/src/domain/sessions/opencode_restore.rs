use std::collections::{HashMap, HashSet};

use super::models::AgentMessageRow;

struct SyntheticRowFields {
    message_type: String,
    content: String,
    tool_name: Option<String>,
    tool_use_id: Option<String>,
    model: Option<String>,
}

pub fn should_hydrate_opencode_tool_calls(messages: &[AgentMessageRow]) -> bool {
    messages.iter().any(|message| {
        message.message_type == "tool_call"
            && parse_pending_placeholder(&message.content).unwrap_or(false)
    })
}

#[cfg(test)]
pub fn hydrate_opencode_tool_calls(
    messages: &mut [AgentMessageRow],
    provider_messages: &[opencode_sdk_rs::Message],
) -> bool {
    let tool_inputs = collect_tool_inputs(provider_messages);
    hydrate_opencode_tool_calls_with_inputs(messages, &tool_inputs)
}

pub fn hydrate_opencode_tool_calls_with_children(
    messages: &mut [AgentMessageRow],
    provider_messages: &[opencode_sdk_rs::Message],
    child_messages_by_session: &HashMap<String, Vec<opencode_sdk_rs::Message>>,
) -> bool {
    let tool_inputs = collect_tool_inputs(
        provider_messages
            .iter()
            .chain(child_messages_by_session.values().flatten()),
    );
    hydrate_opencode_tool_calls_with_inputs(messages, &tool_inputs)
}

fn hydrate_opencode_tool_calls_with_inputs(
    messages: &mut [AgentMessageRow],
    tool_inputs: &HashMap<String, serde_json::Value>,
) -> bool {
    let mut changed = false;

    for message in messages.iter_mut() {
        if message.message_type != "tool_call" {
            continue;
        }
        if !parse_pending_placeholder(&message.content).unwrap_or(false) {
            continue;
        }
        let Some(tool_use_id) = message.tool_use_id.as_deref() else {
            continue;
        };
        let Some(input) = tool_inputs.get(tool_use_id) else {
            continue;
        };
        let serialized = serde_json::to_string(input).unwrap_or_default();
        if serialized == message.content {
            continue;
        }
        message.content = serialized;
        changed = true;
    }

    changed
}

pub fn should_hydrate_opencode_child_sessions(messages: &[AgentMessageRow]) -> bool {
    let task_tool_use_ids: HashSet<&str> = messages
        .iter()
        .filter(|message| {
            message.message_type == "tool_call"
                && matches!(message.tool_name.as_deref(), Some("Task") | Some("Agent"))
        })
        .filter_map(|message| message.tool_use_id.as_deref())
        .collect();

    task_tool_use_ids.iter().any(|tool_use_id| {
        !messages
            .iter()
            .any(|message| message.parent_tool_use_id.as_deref() == Some(*tool_use_id))
    })
}

pub fn synthesize_opencode_child_rows(
    existing_messages: &[AgentMessageRow],
    provider_messages: &[opencode_sdk_rs::Message],
    child_messages_by_session: &HashMap<String, Vec<opencode_sdk_rs::Message>>,
) -> Vec<AgentMessageRow> {
    let existing_parent_ids: HashSet<&str> = existing_messages
        .iter()
        .filter_map(|message| message.parent_tool_use_id.as_deref())
        .collect();
    let task_session_map = collect_task_session_ids(provider_messages);
    let mut synthetic_rows = Vec::new();
    let mut next_id = -1_i64;

    for (tool_use_id, child_session_id) in task_session_map {
        if existing_parent_ids.contains(tool_use_id.as_str()) {
            continue;
        }
        let Some(child_messages) = child_messages_by_session.get(&child_session_id) else {
            continue;
        };
        for message in child_messages {
            if !matches!(message.role, opencode_sdk_rs::MessageRole::Assistant) {
                continue;
            }
            for part in &message.parts {
                let Some(fields) = synthetic_row_from_part(message, part) else {
                    continue;
                };
                synthetic_rows.push(AgentMessageRow {
                    id: next_id,
                    session_id: existing_messages
                        .first()
                        .map(|message| message.session_id)
                        .unwrap_or_default(),
                    content: fields.content,
                    message_type: fields.message_type,
                    tool_name: fields.tool_name,
                    tool_use_id: fields.tool_use_id,
                    parent_tool_use_id: Some(tool_use_id.clone()),
                    created_at: message.created_at.clone(),
                    model: fields.model,
                });
                next_id -= 1;
            }
        }
    }

    synthetic_rows
}

fn collect_tool_inputs<'a>(
    provider_messages: impl IntoIterator<Item = &'a opencode_sdk_rs::Message>,
) -> HashMap<String, serde_json::Value> {
    let mut inputs = HashMap::new();
    for message in provider_messages {
        for part in &message.parts {
            if let opencode_sdk_rs::MessagePart::ToolUse { id, input, .. } = part {
                inputs.insert(id.clone(), input.clone());
            }
        }
    }
    inputs
}

fn collect_task_session_ids(
    provider_messages: &[opencode_sdk_rs::Message],
) -> HashMap<String, String> {
    let mut sessions = HashMap::new();
    for message in provider_messages {
        for part in &message.parts {
            let opencode_sdk_rs::MessagePart::ToolUse {
                id, name, input, ..
            } = part
            else {
                continue;
            };
            if !matches!(name.as_str(), "Task" | "Agent") {
                continue;
            }
            let Some(child_session_id) = input
                .get("subagent_session_id")
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            sessions.insert(id.clone(), child_session_id.to_string());
        }
    }
    sessions
}

fn synthetic_row_from_part(
    message: &opencode_sdk_rs::Message,
    part: &opencode_sdk_rs::MessagePart,
) -> Option<SyntheticRowFields> {
    let model = message.model.clone();
    match part {
        opencode_sdk_rs::MessagePart::Text { text, .. } => Some(SyntheticRowFields {
            message_type: "text".to_string(),
            content: text.clone(),
            tool_name: None,
            tool_use_id: None,
            model,
        }),
        opencode_sdk_rs::MessagePart::Thinking { thinking, .. } => Some(SyntheticRowFields {
            message_type: "thinking".to_string(),
            content: thinking.clone(),
            tool_name: None,
            tool_use_id: None,
            model: None,
        }),
        opencode_sdk_rs::MessagePart::ToolUse {
            id, name, input, ..
        } => Some(SyntheticRowFields {
            message_type: "tool_call".to_string(),
            content: serde_json::to_string(input).unwrap_or_default(),
            tool_name: Some(name.clone()),
            tool_use_id: Some(id.clone()),
            model: None,
        }),
        opencode_sdk_rs::MessagePart::ToolResult {
            tool_use_id,
            is_error,
            content,
            ..
        } => Some(SyntheticRowFields {
            message_type: if *is_error {
                "tool_error".to_string()
            } else {
                "tool_result".to_string()
            },
            content: serialize_tool_result_content(content),
            tool_name: None,
            tool_use_id: Some(tool_use_id.clone()),
            model: None,
        }),
        opencode_sdk_rs::MessagePart::Other(_) => None,
    }
}

fn serialize_tool_result_content(content: &serde_json::Value) -> String {
    content
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| serde_json::to_string(content).unwrap_or_default())
}

fn parse_pending_placeholder(content: &str) -> Option<bool> {
    let parsed = serde_json::from_str::<serde_json::Value>(content).ok()?;
    let object = parsed.as_object()?;
    let status = object.get("status")?.as_str()?;
    Some(object.len() == 1 && status == "pending")
}

#[cfg(test)]
mod tests {
    use super::{
        hydrate_opencode_tool_calls, should_hydrate_opencode_child_sessions,
        should_hydrate_opencode_tool_calls, synthesize_opencode_child_rows,
    };
    use crate::domain::sessions::models::AgentMessageRow;
    use serde_json::json;
    use std::collections::HashMap;

    fn tool_call_row(id: i64, tool_use_id: &str, content: &str) -> AgentMessageRow {
        AgentMessageRow {
            id,
            session_id: 1,
            content: content.to_string(),
            message_type: "tool_call".to_string(),
            tool_name: Some("Read".to_string()),
            tool_use_id: Some(tool_use_id.to_string()),
            parent_tool_use_id: None,
            created_at: None,
            model: None,
        }
    }

    #[test]
    fn detects_placeholder_rows_that_need_hydration() {
        let messages = vec![
            tool_call_row(1, "prt_1", r#"{"status":"pending"}"#),
            tool_call_row(2, "prt_2", r#"{"file_path":"src/main.rs"}"#),
        ];

        assert!(should_hydrate_opencode_tool_calls(&messages));
    }

    #[test]
    fn replaces_pending_placeholder_with_provider_tool_input() {
        let mut messages = vec![
            tool_call_row(1, "prt_1", r#"{"status":"pending"}"#),
            tool_call_row(2, "prt_2", r#"{"file_path":"already/set.rs"}"#),
        ];
        let provider_messages = vec![opencode_sdk_rs::Message {
            id: "msg_1".to_string(),
            session_id: "ses_1".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: vec![
                opencode_sdk_rs::MessagePart::ToolUse {
                    id: "prt_1".to_string(),
                    tool_id: "call_1".to_string(),
                    name: "Read".to_string(),
                    input: json!({
                        "file_path": "packages/service/src/main.rs",
                        "status": "completed",
                    }),
                },
                opencode_sdk_rs::MessagePart::ToolUse {
                    id: "prt_2".to_string(),
                    tool_id: "call_2".to_string(),
                    name: "Read".to_string(),
                    input: json!({
                        "file_path": "should/not/override.rs",
                        "status": "completed",
                    }),
                },
            ],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: true,
        }];

        let changed = hydrate_opencode_tool_calls(&mut messages, &provider_messages);

        assert!(changed);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&messages[0].content).unwrap(),
            json!({
                "file_path": "packages/service/src/main.rs",
                "status": "completed",
            })
        );
        assert_eq!(messages[1].content, r#"{"file_path":"already/set.rs"}"#);
    }

    #[test]
    fn hydrates_restored_bash_output_and_completed_status() {
        let mut messages = vec![tool_call_row(1, "prt_bash", r#"{"status":"pending"}"#)];
        messages[0].tool_name = Some("Bash".to_string());
        let provider_messages = vec![opencode_sdk_rs::Message {
            id: "msg_1".to_string(),
            session_id: "ses_1".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: vec![opencode_sdk_rs::MessagePart::ToolUse {
                id: "prt_bash".to_string(),
                tool_id: "call_bash".to_string(),
                name: "Bash".to_string(),
                input: json!({
                    "command": "pnpm lint",
                    "status": "completed",
                    "output": "ok\n",
                }),
            }],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: true,
        }];

        let changed = hydrate_opencode_tool_calls(&mut messages, &provider_messages);

        assert!(changed);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&messages[0].content).unwrap(),
            json!({
                "command": "pnpm lint",
                "status": "completed",
                "output": "ok\n",
            })
        );
    }

    #[test]
    fn does_not_request_hydration_when_no_placeholders_remain() {
        let messages = vec![
            tool_call_row(
                1,
                "prt_1",
                r#"{"file_path":"packages/service/src/main.rs","status":"completed"}"#,
            ),
            tool_call_row(
                2,
                "prt_2",
                r#"{"pattern":"*.rs","path":"packages/service/src"}"#,
            ),
        ];

        assert!(!should_hydrate_opencode_tool_calls(&messages));
    }

    #[test]
    fn detects_task_rows_missing_child_session_content() {
        let messages = vec![tool_call_row(1, "prt_task", r#"{"status":"completed"}"#)];
        let mut task = messages[0].clone();
        task.tool_name = Some("Task".to_string());

        assert!(should_hydrate_opencode_child_sessions(&[task]));
    }

    #[test]
    fn synthesizes_child_rows_from_provider_messages() {
        let existing_messages = vec![AgentMessageRow {
            id: 1,
            session_id: 7,
            content: r#"{"description":"Inspect","subagent_session_id":"ses_child"}"#.to_string(),
            message_type: "tool_call".to_string(),
            tool_name: Some("Task".to_string()),
            tool_use_id: Some("prt_task".to_string()),
            parent_tool_use_id: None,
            created_at: Some("2026-04-12 21:00:00".to_string()),
            model: None,
        }];
        let provider_messages = vec![opencode_sdk_rs::Message {
            id: "msg_root".to_string(),
            session_id: "ses_root".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: vec![opencode_sdk_rs::MessagePart::ToolUse {
                id: "prt_task".to_string(),
                tool_id: "call_task".to_string(),
                name: "Task".to_string(),
                input: json!({
                    "description": "Inspect",
                    "subagent_session_id": "ses_child",
                    "status": "completed"
                }),
            }],
            created_at: Some("2026-04-12 21:00:00".to_string()),
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: true,
        }];
        let child_messages_by_session = HashMap::from([(
            "ses_child".to_string(),
            vec![opencode_sdk_rs::Message {
                id: "msg_child".to_string(),
                session_id: "ses_child".to_string(),
                role: opencode_sdk_rs::MessageRole::Assistant,
                parts: vec![
                    opencode_sdk_rs::MessagePart::ToolUse {
                        id: "prt_read".to_string(),
                        tool_id: "call_read".to_string(),
                        name: "Read".to_string(),
                        input: json!({ "file_path": "src/main.ts", "status": "completed" }),
                    },
                    opencode_sdk_rs::MessagePart::Text {
                        id: "prt_text".to_string(),
                        text: "Done".to_string(),
                    },
                ],
                created_at: Some("2026-04-12 21:00:01".to_string()),
                model: Some("openai/gpt-5.4".to_string()),
                tokens: None,
                finished: true,
            }],
        )]);

        let synthesized = synthesize_opencode_child_rows(
            &existing_messages,
            &provider_messages,
            &child_messages_by_session,
        );

        assert_eq!(synthesized.len(), 2);
        assert_eq!(
            synthesized[0].parent_tool_use_id.as_deref(),
            Some("prt_task")
        );
        assert_eq!(synthesized[0].tool_name.as_deref(), Some("Read"));
        assert_eq!(synthesized[1].message_type, "text");
        assert_eq!(synthesized[1].content, "Done");
    }
}
