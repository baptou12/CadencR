use serde_json::{Map, Value};

use crate::types::{PermissionReply, PromptOptions, PromptPart, Session, SessionStatus};

pub fn build_prompt_payload(parts: Vec<PromptPart>, options: PromptOptions) -> Value {
    let mut payload = Map::new();
    payload.insert(
        "parts".to_string(),
        Value::Array(
            parts
                .into_iter()
                .map(PromptPart::into_value)
                .collect::<Vec<Value>>(),
        ),
    );

    if let Some(model) = options.model {
        payload.insert("model".to_string(), serde_json::json!(model));
    }
    if let Some(agent) = options.agent {
        payload.insert("agent".to_string(), Value::String(agent));
    }
    if let Some(system) = options.system {
        payload.insert("system".to_string(), Value::String(system));
    }

    Value::Object(payload)
}

pub fn build_permission_reply_payload(reply: PermissionReply, message: Option<&str>) -> Value {
    let mut payload = Map::new();
    let reply = match reply {
        PermissionReply::Once => "once",
        PermissionReply::Always => "always",
        PermissionReply::Reject => "reject",
    };
    payload.insert("reply".to_string(), Value::String(reply.to_string()));
    if let Some(message) = message {
        payload.insert("message".to_string(), Value::String(message.to_string()));
    }
    Value::Object(payload)
}

pub fn build_question_reply_payload(answers: Vec<Vec<String>>) -> Value {
    serde_json::json!({ "answers": answers })
}

pub fn parse_session_status_list(body: &Value) -> Vec<Session> {
    body.as_object()
        .map(|entries| {
            entries
                .iter()
                .map(|(session_id, status)| Session {
                    id: session_id.clone(),
                    title: None,
                    directory: String::new(),
                    status: SessionStatus::from_str(
                        status.get("type").and_then(Value::as_str).unwrap_or("idle"),
                    ),
                    parent_id: None,
                    created_at: None,
                    updated_at: None,
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        build_permission_reply_payload, build_prompt_payload, build_question_reply_payload,
        parse_session_status_list,
    };
    use crate::types::{PermissionReply, PromptOptions, PromptPart, SessionStatus};

    #[test]
    fn build_prompt_payload_omits_absent_optional_fields() {
        let payload = build_prompt_payload(
            vec![PromptPart::Text {
                text: "Hi".to_string(),
            }],
            PromptOptions::default(),
        );

        assert_eq!(payload["parts"][0]["type"], "text");
        assert_eq!(payload["parts"][0]["text"], "Hi");
        assert!(payload.get("model").is_none());
        assert!(payload.get("agent").is_none());
        assert!(payload.get("system").is_none());
    }

    #[test]
    fn build_prompt_payload_includes_present_optional_fields() {
        let payload = build_prompt_payload(
            vec![PromptPart::Text {
                text: "Hi".to_string(),
            }],
            PromptOptions {
                model: Some(crate::types::ModelRef {
                    provider_id: "openai".to_string(),
                    model_id: "gpt-5.3-codex".to_string(),
                }),
                agent: Some("build".to_string()),
                system: Some("system prompt".to_string()),
            },
        );

        assert_eq!(payload["model"]["providerID"], "openai");
        assert_eq!(payload["model"]["modelID"], "gpt-5.3-codex");
        assert_eq!(payload["agent"], "build");
        assert_eq!(payload["system"], "system prompt");
    }

    #[test]
    fn build_prompt_payload_serializes_file_parts() {
        let payload = build_prompt_payload(
            vec![PromptPart::File {
                mime: "image/png".to_string(),
                filename: None,
                url: "data:image/png;base64,abc123".to_string(),
            }],
            PromptOptions::default(),
        );

        assert_eq!(payload["parts"][0]["type"], "file");
        assert_eq!(payload["parts"][0]["mime"], "image/png");
        assert!(payload["parts"][0].get("filename").is_none());
        assert_eq!(payload["parts"][0]["url"], "data:image/png;base64,abc123");
    }

    #[test]
    fn build_permission_reply_payload_omits_absent_message() {
        let payload = build_permission_reply_payload(PermissionReply::Once, None);

        assert_eq!(payload["reply"], "once");
        assert!(payload.get("message").is_none());
    }

    #[test]
    fn build_question_reply_payload_wraps_answers_in_nested_arrays() {
        let payload =
            build_question_reply_payload(vec![vec!["A".to_string()], vec!["B".to_string()]]);

        assert_eq!(payload["answers"][0][0], "A");
        assert_eq!(payload["answers"][1][0], "B");
    }

    #[test]
    fn parse_session_status_list_supports_official_status_map() {
        let sessions = parse_session_status_list(&serde_json::json!({
            "ses_1": { "type": "busy" },
            "ses_2": { "type": "idle" }
        }));

        assert_eq!(sessions.len(), 2);
        assert!(sessions
            .iter()
            .any(|session| matches!(session.status, SessionStatus::Active)));
        assert!(sessions
            .iter()
            .any(|session| matches!(session.status, SessionStatus::Idle)));
    }
}
