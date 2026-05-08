use serde_json::Value;

use crate::domain::agents::acp::error::AcpError;
use crate::domain::agents::acp::types::AcpEvent;

/// Result of decoding one inbound JSON-RPC frame from the agent.
///
/// `Event` covers both fire-and-forget notifications and server-initiated
/// requests (the agent asking *us* to do something — file read, permission
/// elicitation, terminal command). `Response` is the answer to a request we
/// previously sent. `Ignore` covers malformed but non-fatal frames (e.g. a
/// stray `result` with no id).
pub(crate) enum InboundMessage {
    Event(AcpEvent),
    Response {
        id: u64,
        result: Result<Value, AcpError>,
    },
    Ignore,
}

/// Classify one parsed JSON message into an `InboundMessage`.
///
/// Three shapes flow over the wire:
/// 1. `{ "method": "...", "params": ... }`  → notification (no `id`)
/// 2. `{ "id": <int|str>, "method": "...", "params": ... }` → server request
/// 3. `{ "id": <int>, "result": ... }` or `{ "id": <int>, "error": ... }` → response
///
/// JSON-RPC allows `id: null` to mean "notification", so we treat null ids
/// the same as missing ids. Server requests use string or integer ids that
/// we echo back verbatim when responding.
pub(crate) fn decode_inbound_message(message: Value) -> InboundMessage {
    if let Some(method) = message.get("method").and_then(Value::as_str) {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        return if let Some(id) = message.get("id").filter(|id| !id.is_null()).cloned() {
            InboundMessage::Event(AcpEvent::ServerRequest {
                id,
                method: method.to_string(),
                params,
            })
        } else {
            InboundMessage::Event(AcpEvent::Notification {
                method: method.to_string(),
                params,
            })
        };
    }

    // Responses use integer ids (we generate them sequentially via AtomicU64).
    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return InboundMessage::Ignore;
    };

    let result = if let Some(error) = message.get("error") {
        Err(AcpError::Rpc {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(-32000),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown ACP error")
                .to_string(),
        })
    } else {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    };
    InboundMessage::Response { id, result }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{decode_inbound_message, InboundMessage};
    use crate::domain::agents::acp::types::AcpEvent;

    #[test]
    fn notification_has_no_id() {
        let InboundMessage::Event(AcpEvent::Notification { method, params }) =
            decode_inbound_message(
                json!({ "method": "session/update", "params": { "sessionUpdate": "agent_message_chunk" } }),
            )
        else {
            panic!("expected notification");
        };
        assert_eq!(method, "session/update");
        assert_eq!(params["sessionUpdate"], "agent_message_chunk");
    }

    #[test]
    fn null_id_is_treated_as_notification() {
        let InboundMessage::Event(AcpEvent::Notification { method, .. }) =
            decode_inbound_message(json!({ "id": null, "method": "session/cancel", "params": {} }))
        else {
            panic!("expected notification");
        };
        assert_eq!(method, "session/cancel");
    }

    #[test]
    fn string_id_with_method_is_a_server_request() {
        let InboundMessage::Event(AcpEvent::ServerRequest { id, method, params }) =
            decode_inbound_message(json!({
                "id": "perm-1",
                "method": "session/request_permission",
                "params": { "sessionId": "s1" },
            }))
        else {
            panic!("expected server request");
        };
        assert_eq!(id, json!("perm-1"));
        assert_eq!(method, "session/request_permission");
        assert_eq!(params["sessionId"], "s1");
    }

    #[test]
    fn integer_id_with_method_is_also_a_server_request() {
        let InboundMessage::Event(AcpEvent::ServerRequest { id, .. }) = decode_inbound_message(
            json!({ "id": 42, "method": "fs/read_text_file", "params": {} }),
        ) else {
            panic!("expected server request");
        };
        assert_eq!(id, json!(42));
    }

    #[test]
    fn integer_id_without_method_is_a_response() {
        let InboundMessage::Response { id, result } =
            decode_inbound_message(json!({ "id": 7, "result": { "ok": true } }))
        else {
            panic!("expected response");
        };
        assert_eq!(id, 7);
        assert_eq!(result.unwrap(), json!({ "ok": true }));
    }

    #[test]
    fn rpc_error_decodes_into_response_error() {
        let InboundMessage::Response { id, result } = decode_inbound_message(json!({
            "id": 12,
            "error": { "code": -32601, "message": "method not found" },
        })) else {
            panic!("expected response");
        };
        assert_eq!(id, 12);
        let err = result.expect_err("error result");
        assert!(err.to_string().contains("method not found"));
    }

    #[test]
    fn missing_id_and_method_is_ignored() {
        assert!(matches!(
            decode_inbound_message(json!({ "result": "stray" })),
            InboundMessage::Ignore
        ));
    }
}
