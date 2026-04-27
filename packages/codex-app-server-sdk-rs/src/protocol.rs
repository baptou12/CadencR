use serde_json::{json, Value};

use crate::error::SdkError;
use crate::types::AppServerEvent;

pub(crate) enum InboundMessage {
    Event(AppServerEvent),
    Response {
        id: u64,
        result: Result<Value, SdkError>,
    },
    Ignore,
}

pub(crate) fn app_server_args(enable_features: &[String]) -> Vec<String> {
    let mut args = vec!["app-server".to_string()];
    for feature in enable_features {
        args.push("--enable".to_string());
        args.push(feature.clone());
    }
    args
}

pub(crate) fn mcp_server_status_list_params(cursor: Value) -> Value {
    json!({
        "cursor": cursor,
        "limit": 100,
        "detail": "toolsAndAuthOnly",
    })
}

pub(crate) fn decode_inbound_message(message: Value) -> InboundMessage {
    if let Some(method) = message.get("method").and_then(Value::as_str) {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        return if let Some(id) = message.get("id").filter(|id| !id.is_null()).cloned() {
            InboundMessage::Event(AppServerEvent::ServerRequest {
                id,
                method: method.to_string(),
                params,
            })
        } else {
            InboundMessage::Event(AppServerEvent::Notification {
                method: method.to_string(),
                params,
            })
        };
    }

    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return InboundMessage::Ignore;
    };

    let result = if let Some(error) = message.get("error") {
        Err(SdkError::Rpc {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(-32000),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown app-server error")
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

    use super::{
        app_server_args, decode_inbound_message, mcp_server_status_list_params, InboundMessage,
    };
    use crate::types::AppServerEvent;

    #[test]
    fn null_id_message_is_a_notification_not_server_request() {
        let InboundMessage::Event(AppServerEvent::Notification { method, params }) =
            decode_inbound_message(
                json!({ "id": null, "method": "turn/started", "params": { "ok": true } }),
            )
        else {
            panic!("expected notification");
        };
        assert_eq!(method, "turn/started");
        assert_eq!(params, json!({ "ok": true }));
    }

    #[test]
    fn mcp_status_params_request_tools_auth_detail_and_cursor() {
        assert_eq!(
            mcp_server_status_list_params(json!("next")),
            json!({
                "cursor": "next",
                "limit": 100,
                "detail": "toolsAndAuthOnly",
            })
        );
    }

    #[test]
    fn app_server_args_include_feature_flags() {
        assert_eq!(
            app_server_args(&["alpha".to_string(), "beta".to_string()]),
            vec!["app-server", "--enable", "alpha", "--enable", "beta"]
        );
    }

    #[test]
    fn rpc_error_message_decodes_to_response_error() {
        let InboundMessage::Response { id, result } = decode_inbound_message(json!({
            "id": 12,
            "error": { "code": -32001, "message": "nope" }
        })) else {
            panic!("expected response");
        };
        assert_eq!(id, 12);
        let error = result.expect_err("error result");
        assert!(error.to_string().contains("nope"));
    }
}
