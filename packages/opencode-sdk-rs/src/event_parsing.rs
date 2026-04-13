use serde_json::Value;

use crate::parsing::{
    parse_message_from, parse_part_from, parse_permission_from, parse_question_from,
    parse_session_from,
};
use crate::types::{Session, SessionStatus, SseEvent};

pub fn parse_sse_event(raw: Value) -> SseEvent {
    let event_name = event_type(&raw).unwrap_or_default();
    let payload = raw
        .get("data")
        .or_else(|| raw.get("properties"))
        .cloned()
        .unwrap_or_else(|| raw.clone());

    match event_name.as_str() {
        "server.connected" => SseEvent::ServerConnected,
        "session.created" => parse_session_from(&payload)
            .map(SseEvent::SessionCreated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "session.updated" => parse_session_from(&payload)
            .map(SseEvent::SessionUpdated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "session.deleted" => maybe_string(&payload, &["session_id", "sessionID", "id"])
            .map(|session_id| SseEvent::SessionDeleted { session_id })
            .unwrap_or(SseEvent::Unknown(raw)),
        "session.status" => parse_session_status_event(&payload)
            .map(SseEvent::SessionUpdated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "session.idle" => parse_session_idle_event(&payload)
            .map(SseEvent::SessionUpdated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "message.created" => parse_message_from(&payload)
            .map(SseEvent::MessageCreated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "message.updated" => parse_message_from(&payload)
            .map(SseEvent::MessageUpdated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "message.part.delta" => parse_part_delta_event(&payload).unwrap_or(SseEvent::Unknown(raw)),
        "message.part.created" => {
            parse_part_event(&payload, true).unwrap_or(SseEvent::Unknown(raw))
        }
        "message.part.updated" => {
            parse_part_event(&payload, false).unwrap_or(SseEvent::Unknown(raw))
        }
        "permission.created" | "permission.asked" => parse_permission_from(&payload)
            .map(SseEvent::PermissionCreated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "permission.updated" => parse_status_event(&payload, &["status"])
            .map(|(id, status)| SseEvent::PermissionUpdated { id, status })
            .unwrap_or(SseEvent::Unknown(raw)),
        "permission.replied" => parse_status_event(&payload, &["reply"])
            .map(|(id, status)| SseEvent::PermissionUpdated { id, status })
            .unwrap_or(SseEvent::Unknown(raw)),
        "question.created" | "question.asked" => parse_question_from(&payload)
            .map(SseEvent::QuestionCreated)
            .unwrap_or(SseEvent::Unknown(raw)),
        "question.updated" => parse_status_event(&payload, &["status"])
            .map(|(id, status)| SseEvent::QuestionUpdated { id, status })
            .unwrap_or(SseEvent::Unknown(raw)),
        "question.replied" => maybe_string(&payload, &["request_id", "requestID", "id"])
            .map(|id| SseEvent::QuestionUpdated {
                id,
                status: "answered".to_string(),
            })
            .unwrap_or(SseEvent::Unknown(raw)),
        "question.rejected" => maybe_string(&payload, &["request_id", "requestID", "id"])
            .map(|id| SseEvent::QuestionUpdated {
                id,
                status: "rejected".to_string(),
            })
            .unwrap_or(SseEvent::Unknown(raw)),
        _ => SseEvent::Unknown(raw),
    }
}

fn parse_part_event(payload: &Value, created: bool) -> Option<SseEvent> {
    let session_id = maybe_string(payload, &["session_id", "sessionID"])?;
    let part = parse_part_from(payload.get("part")?);
    let message_id = maybe_string(payload, &["message_id", "messageID"]).or_else(|| {
        payload
            .get("part")
            .and_then(|part| maybe_string(part, &["messageID", "message_id"]))
    })?;

    Some(if created {
        SseEvent::PartCreated {
            session_id,
            message_id,
            part,
        }
    } else {
        SseEvent::PartUpdated {
            session_id,
            message_id,
            part,
        }
    })
}

fn parse_part_delta_event(payload: &Value) -> Option<SseEvent> {
    Some(SseEvent::PartDelta {
        session_id: maybe_string(payload, &["session_id", "sessionID"])?,
        message_id: maybe_string(payload, &["message_id", "messageID"])?,
        part_id: maybe_string(payload, &["part_id", "partID"])?,
        field: maybe_string(payload, &["field"])?,
        delta: maybe_string(payload, &["delta"])?,
    })
}

fn parse_status_event(payload: &Value, value_keys: &[&str]) -> Option<(String, String)> {
    let id = maybe_string(payload, &["id", "request_id", "requestID"])?;
    let status = maybe_string(payload, value_keys)?;
    Some((id, status))
}

fn parse_session_status_event(payload: &Value) -> Option<Session> {
    let id = maybe_string(payload, &["session_id", "sessionID"])?;
    let status = payload.get("status")?;
    Some(Session {
        id,
        title: None,
        directory: String::new(),
        status: parse_session_status(status),
        parent_id: None,
        created_at: None,
        updated_at: None,
    })
}

fn parse_session_idle_event(payload: &Value) -> Option<Session> {
    let id = maybe_string(payload, &["session_id", "sessionID"])?;
    Some(Session {
        id,
        title: None,
        directory: String::new(),
        status: SessionStatus::Idle,
        parent_id: None,
        created_at: None,
        updated_at: None,
    })
}

fn parse_session_status(candidate: &Value) -> SessionStatus {
    if let Some(raw) = maybe_string(candidate, &["status"]) {
        return SessionStatus::from_str(&raw);
    }
    if let Some(raw) = candidate
        .get("status")
        .and_then(|status| status.get("type"))
        .and_then(Value::as_str)
        .or_else(|| candidate.get("type").and_then(Value::as_str))
    {
        return SessionStatus::from_str(raw);
    }
    SessionStatus::Idle
}

fn event_type(value: &Value) -> Option<String> {
    maybe_string(value, &["type", "event", "name"])
}

fn maybe_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::parse_sse_event;
    use crate::types::{MessagePart, SessionStatus, SseEvent};
    use serde_json::json;

    #[test]
    fn parse_sse_event_supports_official_status_and_message_events() {
        let status = parse_sse_event(json!({
            "type": "session.status",
            "properties": {
                "sessionID": "ses_1",
                "status": { "type": "busy" }
            }
        }));
        match status {
            SseEvent::SessionUpdated(session) => {
                assert_eq!(session.id, "ses_1");
                assert!(matches!(session.status, SessionStatus::Active));
            }
            other => panic!("expected session update, got {other:?}"),
        }

        let message = parse_sse_event(json!({
            "type": "message.updated",
            "properties": {
                "sessionID": "ses_1",
                "info": {
                    "id": "msg_1",
                    "sessionID": "ses_1",
                    "role": "user",
                    "time": { "created": 123 }
                }
            }
        }));
        match message {
            SseEvent::MessageUpdated(message) => {
                assert_eq!(message.id, "msg_1");
                assert_eq!(message.session_id, "ses_1");
            }
            other => panic!("expected message update, got {other:?}"),
        }
    }

    #[test]
    fn parse_sse_event_supports_official_part_and_permission_events() {
        let delta = parse_sse_event(json!({
            "type": "message.part.delta",
            "properties": {
                "sessionID": "ses_1",
                "messageID": "msg_1",
                "partID": "prt_1",
                "field": "reasoning_content",
                "delta": "thinking"
            }
        }));
        match delta {
            SseEvent::PartDelta {
                message_id,
                part_id,
                field,
                delta,
                ..
            } => {
                assert_eq!(message_id, "msg_1");
                assert_eq!(part_id, "prt_1");
                assert_eq!(field, "reasoning_content");
                assert_eq!(delta, "thinking");
            }
            other => panic!("expected part delta, got {other:?}"),
        }

        let part = parse_sse_event(json!({
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_1",
                "part": {
                    "id": "prt_1",
                    "messageID": "msg_1",
                    "type": "tool",
                    "tool": "Bash",
                    "callID": "call_1",
                    "state": {
                        "status": "running",
                        "input": { "command": "git status" }
                    }
                }
            }
        }));
        match part {
            SseEvent::PartUpdated {
                message_id, part, ..
            } => {
                assert_eq!(message_id, "msg_1");
                assert!(matches!(part, MessagePart::ToolUse { .. }));
            }
            other => panic!("expected part update, got {other:?}"),
        }

        let reasoning_update = parse_sse_event(json!({
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_1",
                "part": {
                    "id": "prt_reason",
                    "messageID": "msg_1",
                    "type": "reasoning",
                    "text": "- inspect docs"
                }
            }
        }));
        match reasoning_update {
            SseEvent::PartUpdated {
                message_id, part, ..
            } => {
                assert_eq!(message_id, "msg_1");
                assert!(matches!(
                    part,
                    MessagePart::Thinking { thinking, .. } if thinking == "- inspect docs"
                ));
            }
            other => panic!("expected reasoning part update, got {other:?}"),
        }

        let permission = parse_sse_event(json!({
            "type": "permission.asked",
            "properties": {
                "id": "per_1",
                "sessionID": "ses_1",
                "permission": "bash",
                "patterns": ["git *"],
                "metadata": { "command": "git status" },
                "always": []
            }
        }));
        match permission {
            SseEvent::PermissionCreated(request) => {
                assert_eq!(request.tool_name, "bash");
                assert_eq!(request.tool_input["metadata"]["command"], "git status");
            }
            other => panic!("expected permission request, got {other:?}"),
        }
    }
}
