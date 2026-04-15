mod helpers;
mod part_parsing;

use serde_json::{json, Value};

use self::helpers::{maybe_string, maybe_timestamp, nested_object, parse_session_status};
pub use self::part_parsing::parse_part_from;
use crate::types::{
    Message, MessagePart, MessageRole, PermissionRequest, Question, QuestionItem, QuestionOption,
    Session, TokenCacheUsage, TokenUsage,
};

pub fn parse_session_from(payload: &Value) -> Option<Session> {
    let candidate = nested_object(payload, &["session", "info"]).unwrap_or(payload);
    let id = maybe_string(candidate, &["id", "session_id", "sessionID"])
        .or_else(|| maybe_string(payload, &["session_id", "sessionID"]))?;

    Some(Session {
        id,
        title: maybe_string(candidate, &["title"]),
        directory: maybe_string(candidate, &["directory", "cwd"]).unwrap_or_default(),
        status: parse_session_status(candidate),
        parent_id: maybe_string(candidate, &["parent_id", "parentID"]),
        created_at: maybe_timestamp(
            candidate,
            &["created_at", "createdAt"],
            &["time", "created"],
        ),
        updated_at: maybe_timestamp(
            candidate,
            &["updated_at", "updatedAt"],
            &["time", "updated"],
        ),
    })
}

pub fn parse_message_from(payload: &Value) -> Option<Message> {
    let candidate = nested_object(payload, &["message", "info"]).unwrap_or(payload);
    let id = maybe_string(candidate, &["id"])?;
    let session_id = maybe_string(candidate, &["session_id", "sessionID"])
        .or_else(|| maybe_string(payload, &["session_id", "sessionID"]))?;
    let role = MessageRole::from_str(&maybe_string(candidate, &["role"]).unwrap_or_default());
    let parts = payload
        .get("parts")
        .and_then(Value::as_array)
        .or_else(|| candidate.get("parts").and_then(Value::as_array))
        .map(|items| {
            items
                .iter()
                .map(parse_part_from)
                .collect::<Vec<MessagePart>>()
        })
        .or_else(|| {
            candidate
                .get("content")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(parse_part_from)
                        .collect::<Vec<MessagePart>>()
                })
        })
        .or_else(|| {
            candidate
                .get("content")
                .and_then(Value::as_str)
                .map(|text| {
                    vec![MessagePart::Text {
                        id: format!("{id}-text"),
                        text: text.to_string(),
                    }]
                })
        })
        .unwrap_or_default();

    let tokens = parse_token_usage(candidate);

    Some(Message {
        id,
        session_id,
        role,
        parts,
        created_at: maybe_timestamp(
            candidate,
            &["created_at", "createdAt"],
            &["time", "created"],
        ),
        model: maybe_model(candidate),
        tokens,
        finished: message_finished(candidate),
    })
}

fn maybe_model(value: &Value) -> Option<String> {
    if let Some(model) = maybe_string(value, &["model"]) {
        return Some(model);
    }
    let provider = maybe_string(value, &["providerID", "provider_id", "providerId"])?;
    let model = maybe_string(value, &["modelID", "model_id", "modelId"])?;
    Some(format!("{provider}/{model}"))
}

fn parse_token_usage(value: &Value) -> Option<TokenUsage> {
    let tokens = value.get("tokens")?;
    let cache = tokens.get("cache");
    let usage = TokenUsage {
        total: maybe_u64(tokens.get("total")),
        input: maybe_u64(tokens.get("input")).unwrap_or(0),
        output: maybe_u64(tokens.get("output")).unwrap_or(0),
        reasoning: maybe_u64(tokens.get("reasoning")).unwrap_or(0),
        cache: TokenCacheUsage {
            read: cache
                .and_then(|item| maybe_u64(item.get("read")))
                .unwrap_or(0),
            write: cache
                .and_then(|item| maybe_u64(item.get("write")))
                .unwrap_or(0),
        },
    };
    // Zero-token payloads mean "no usage data yet" — filter them out so
    // downstream code never overwrites real usage with zeros.
    if usage.is_zero() {
        None
    } else {
        Some(usage)
    }
}

fn maybe_u64(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
}

fn message_finished(value: &Value) -> bool {
    maybe_string(value, &["finish"]).is_some()
        || value
            .get("time")
            .and_then(|time| time.get("completed"))
            .is_some()
}

pub fn parse_permission_from(payload: &Value) -> Option<PermissionRequest> {
    let candidate = nested_object(payload, &["permission"]).unwrap_or(payload);
    let tool_name = maybe_string(candidate, &["tool_name", "tool"])
        .or_else(|| maybe_string(candidate, &["permission"]))
        .unwrap_or_default();
    let tool_input = if candidate.get("permission").is_some()
        || candidate.get("patterns").is_some()
        || candidate.get("metadata").is_some()
        || candidate.get("always").is_some()
        || candidate.get("tool").is_some()
    {
        json!({
            "permission": candidate.get("permission").cloned().unwrap_or(Value::Null),
            "patterns": candidate.get("patterns").cloned().unwrap_or_else(|| json!([])),
            "metadata": candidate.get("metadata").cloned().unwrap_or_else(|| json!({})),
            "always": candidate.get("always").cloned().unwrap_or_else(|| json!([])),
            "tool": candidate.get("tool").cloned().unwrap_or(Value::Null),
        })
    } else {
        candidate
            .get("tool_input")
            .cloned()
            .or_else(|| candidate.get("input").cloned())
            .unwrap_or_else(|| json!({}))
    };

    Some(PermissionRequest {
        id: maybe_string(candidate, &["id", "request_id", "requestID"])?,
        session_id: maybe_string(candidate, &["session_id", "sessionID"])?,
        call_id: maybe_string(candidate, &["call_id", "callID"]).or_else(|| {
            candidate
                .get("tool")
                .and_then(|tool| maybe_string(tool, &["call_id", "callID"]))
        }),
        tool_name,
        tool_input,
        description: maybe_string(candidate, &["description"]).or_else(|| {
            candidate
                .get("metadata")
                .and_then(|metadata| metadata.get("description"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        }),
    })
}

pub fn parse_question_from(payload: &Value) -> Option<Question> {
    let candidate = nested_object(payload, &["question"]).unwrap_or(payload);
    let questions = candidate
        .get("questions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(parse_question_item)
                .collect::<Vec<QuestionItem>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| vec![parse_question_item(candidate)]);

    Some(Question {
        id: maybe_string(candidate, &["id", "request_id", "requestID"])?,
        session_id: maybe_string(candidate, &["session_id", "sessionID"])?,
        questions,
    })
}

fn parse_question_item(value: &Value) -> QuestionItem {
    QuestionItem {
        question: maybe_string(value, &["question", "text"]).unwrap_or_default(),
        header: maybe_string(value, &["header"]),
        options: parse_question_options(value.get("options")),
        multiple: value
            .get("multiple")
            .and_then(Value::as_bool)
            .or_else(|| value.get("multiSelect").and_then(Value::as_bool))
            .unwrap_or(false),
    }
}

fn parse_question_options(value: Option<&Value>) -> Option<Vec<QuestionOption>> {
    let items = value?.as_array()?;
    Some(
        items
            .iter()
            .map(|item| {
                if let Some(label) = item.as_str() {
                    return QuestionOption {
                        label: label.to_string(),
                        description: None,
                    };
                }

                QuestionOption {
                    label: maybe_string(item, &["label"]).unwrap_or_default(),
                    description: maybe_string(item, &["description"]),
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::{parse_message_from, parse_permission_from, parse_question_from};
    use serde_json::json;

    #[test]
    fn parse_message_from_supports_official_message_wrapper() {
        let message = parse_message_from(&json!({
            "info": {
                "id": "msg_1",
                "sessionID": "ses_1",
                "role": "assistant",
                "providerID": "openai",
                "modelID": "gpt-5.3-codex",
                "tokens": {
                    "total": 37,
                    "input": 20,
                    "output": 10,
                    "reasoning": 5,
                    "cache": { "read": 1, "write": 1 }
                },
                "time": { "created": 123 }
            },
            "parts": [
                { "id": "prt_1", "type": "reasoning", "text": "thinking" },
                { "id": "prt_2", "type": "text", "text": "OK" }
            ]
        }))
        .unwrap();

        assert_eq!(message.id, "msg_1");
        assert_eq!(message.session_id, "ses_1");
        assert_eq!(message.parts.len(), 2);
        assert_eq!(message.created_at.as_deref(), Some("123"));
        assert_eq!(message.model.as_deref(), Some("openai/gpt-5.3-codex"));
        let tokens = message.tokens.expect("expected token usage");
        assert_eq!(tokens.total, Some(37));
        assert_eq!(tokens.input, 20);
        assert_eq!(tokens.output, 10);
        assert_eq!(tokens.reasoning, 5);
        assert_eq!(tokens.cache.read, 1);
        assert_eq!(tokens.cache.write, 1);
        assert_eq!(tokens.total_input(), 22);
        assert!(!message.finished);
    }

    #[test]
    fn parse_message_from_marks_finished_messages() {
        let message = parse_message_from(&json!({
            "info": {
                "id": "msg_1",
                "sessionID": "ses_1",
                "role": "assistant",
                "providerID": "openai",
                "modelID": "gpt-5.3-codex",
                "finish": "stop",
                "time": { "created": 123, "completed": 456 }
            }
        }))
        .unwrap();

        assert!(message.finished);
    }
    #[test]
    fn parse_permission_from_supports_official_permission_shape() {
        let request = parse_permission_from(&json!({
            "id": "per_1",
            "sessionID": "ses_1",
            "permission": "bash",
            "patterns": ["git *"],
            "metadata": { "command": "git status" },
            "always": ["git status"],
            "tool": { "callID": "call_1" }
        }))
        .unwrap();

        assert_eq!(request.tool_name, "bash");
        assert_eq!(request.call_id.as_deref(), Some("call_1"));
        assert_eq!(request.tool_input["metadata"]["command"], "git status");
        assert_eq!(request.tool_input["patterns"][0], "git *");
    }

    #[test]
    fn parse_question_from_supports_official_question_shape() {
        let question = parse_question_from(&json!({
            "id": "que_1",
            "sessionID": "ses_1",
            "questions": [
                {
                    "question": "Pick one",
                    "header": "Choice",
                    "options": [
                        { "label": "A", "description": "first" },
                        { "label": "B", "description": "second" }
                    ],
                    "multiple": false
                }
            ]
        }))
        .unwrap();

        assert_eq!(question.questions.len(), 1);
        assert_eq!(question.questions[0].question, "Pick one");
        assert_eq!(question.questions[0].header.as_deref(), Some("Choice"));
        assert_eq!(
            question.questions[0].options.as_ref().unwrap()[0].label,
            "A"
        );
    }

    #[test]
    fn zero_token_usage_is_filtered_out() {
        let message = parse_message_from(&json!({
            "id": "msg_1", "sessionID": "ses_1", "role": "assistant",
            "tokens": { "input": 0, "output": 0 }
        }))
        .unwrap();
        assert!(
            message.tokens.is_none(),
            "all-zero tokens should be filtered"
        );
    }

    #[test]
    fn empty_tokens_object_is_filtered_out() {
        let message = parse_message_from(&json!({
            "id": "msg_1", "sessionID": "ses_1", "role": "assistant",
            "tokens": {}
        }))
        .unwrap();
        assert!(
            message.tokens.is_none(),
            "empty tokens object should be filtered"
        );
    }

    #[test]
    fn nonzero_input_tokens_are_preserved() {
        let message = parse_message_from(&json!({
            "id": "msg_1", "sessionID": "ses_1", "role": "assistant",
            "tokens": { "input": 10, "output": 5 }
        }))
        .unwrap();
        let tokens = message.tokens.expect("should have tokens");
        assert_eq!(tokens.input, 10);
        assert_eq!(tokens.output, 5);
    }

    #[test]
    fn cache_only_tokens_are_preserved() {
        let message = parse_message_from(&json!({
            "id": "msg_1", "sessionID": "ses_1", "role": "assistant",
            "tokens": { "input": 0, "output": 0, "cache": { "read": 100 } }
        }))
        .unwrap();
        let tokens = message
            .tokens
            .expect("cache-only tokens should be preserved");
        assert_eq!(tokens.cache.read, 100);
    }
}
