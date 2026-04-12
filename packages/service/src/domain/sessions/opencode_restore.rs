use std::collections::HashMap;

use super::models::AgentMessageRow;

pub fn should_hydrate_opencode_tool_calls(messages: &[AgentMessageRow]) -> bool {
    messages.iter().any(|message| {
        message.message_type == "tool_call"
            && parse_pending_placeholder(&message.content).unwrap_or(false)
    })
}

pub fn hydrate_opencode_tool_calls(
    messages: &mut [AgentMessageRow],
    provider_messages: &[opencode_sdk_rs::Message],
) -> bool {
    let tool_inputs = collect_tool_inputs(provider_messages);
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

fn collect_tool_inputs(
    provider_messages: &[opencode_sdk_rs::Message],
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

fn parse_pending_placeholder(content: &str) -> Option<bool> {
    let parsed = serde_json::from_str::<serde_json::Value>(content).ok()?;
    let object = parsed.as_object()?;
    let status = object.get("status")?.as_str()?;
    Some(object.len() == 1 && status == "pending")
}

#[cfg(test)]
mod tests {
    use super::{hydrate_opencode_tool_calls, should_hydrate_opencode_tool_calls};
    use crate::domain::sessions::models::AgentMessageRow;
    use serde_json::json;

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
}
