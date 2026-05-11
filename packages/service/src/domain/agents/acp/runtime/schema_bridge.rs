//! Compatibility helpers for ACP payloads that still need raw JSON because
//! Cadencr preserves provider extensions on top of official ACP schema types.

use agent_client_protocol::schema::{
    CreateTerminalRequest, KillTerminalRequest, PermissionOption, PermissionOptionKind,
    ReadTextFileRequest, ReleaseTerminalRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    TerminalOutputRequest, WaitForTerminalExitRequest, WriteTextFileRequest,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::domain::agents::adapter::RuntimePermissionDecision;

pub fn permission_response_value(
    decision: RuntimePermissionDecision,
    option_id: Option<&str>,
    feedback: Option<&str>,
) -> Value {
    let selected_id = option_id.unwrap_or_else(|| default_option_id(decision));
    let outcome =
        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(selected_id.to_string()));
    let mut value = to_value(RequestPermissionResponse::new(outcome));
    if let Some(text) = feedback.filter(|s| !s.is_empty()) {
        value["feedback"] = Value::String(text.to_string());
        value["_meta"] = serde_json::json!({ "feedback": text });
    }
    value
}

pub struct ResolvedPermissionOption {
    pub decision: RuntimePermissionDecision,
    pub option_id: Option<String>,
    pub name: Option<String>,
}

pub fn resolve_permission_option(option: &Value) -> Option<ResolvedPermissionOption> {
    if let Ok(option) = from_value::<PermissionOption>(option.clone()) {
        return decision_for_official_kind(option.kind).map(|decision| ResolvedPermissionOption {
            decision,
            option_id: Some(option.option_id.to_string()),
            name: Some(option.name),
        });
    }
    let decision = decision_for_kind_str(option.get("kind").and_then(Value::as_str)?)?;
    Some(ResolvedPermissionOption {
        decision,
        option_id: option
            .get("optionId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        name: option
            .get("name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

pub fn validate_known_server_request(method: &str, params: &Value) -> Result<(), String> {
    match method {
        "session/request_permission" => validate_permission_params(params),
        "fs/read_text_file" => validate_params::<ReadTextFileRequest>(method, params),
        "fs/write_text_file" => validate_params::<WriteTextFileRequest>(method, params),
        "terminal/create" => validate_terminal_create_params(method, params),
        "terminal/output" => validate_params::<TerminalOutputRequest>(method, params),
        "terminal/wait_for_exit" => validate_params::<WaitForTerminalExitRequest>(method, params),
        "terminal/kill" => validate_params::<KillTerminalRequest>(method, params),
        "terminal/release" => validate_params::<ReleaseTerminalRequest>(method, params),
        _ => Ok(()),
    }
}

fn validate_permission_params(params: &Value) -> Result<(), String> {
    if from_value::<RequestPermissionRequest>(params.clone()).is_ok() {
        return Ok(());
    }
    if params.get("toolCall").is_some() {
        return Ok(());
    }
    Err("session/request_permission: invalid ACP params: missing toolCall".to_string())
}

fn validate_terminal_create_params(method: &str, params: &Value) -> Result<(), String> {
    if validate_params::<CreateTerminalRequest>(method, params).is_ok() {
        return Ok(());
    }
    validate_terminal_create_compat(params)
        .map_err(|message| format!("{method}: invalid ACP params: {message}"))
}

fn validate_terminal_create_compat(params: &Value) -> Result<(), &'static str> {
    let object = params.as_object().ok_or("expected object")?;
    let command = object
        .get("command")
        .and_then(Value::as_str)
        .ok_or("missing string command")?;
    if command.trim().is_empty() {
        return Err("command must not be empty");
    }
    validate_optional_string_array(object.get("args"), "args")?;
    validate_optional_env(object.get("env"))?;
    validate_optional_string(object.get("cwd"), "cwd")?;
    validate_optional_u64(object.get("outputByteLimit"), "outputByteLimit")
}

fn validate_optional_string(value: Option<&Value>, name: &'static str) -> Result<(), &'static str> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(Value::String(_)) => Ok(()),
        Some(_) => Err(name),
    }
}

fn validate_optional_u64(value: Option<&Value>, name: &'static str) -> Result<(), &'static str> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Number(number)) if number.as_u64().is_some() => Ok(()),
        Some(_) => Err(name),
    }
}

fn validate_optional_string_array(
    value: Option<&Value>,
    name: &'static str,
) -> Result<(), &'static str> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Array(items)) if items.iter().all(Value::is_string) => Ok(()),
        Some(_) => Err(name),
    }
}

fn validate_optional_env(value: Option<&Value>) -> Result<(), &'static str> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Array(items)) if items.iter().all(is_env_entry) => Ok(()),
        Some(Value::Object(map)) if map.values().all(Value::is_string) => Ok(()),
        Some(_) => Err("env"),
    }
}

fn is_env_entry(value: &Value) -> bool {
    value.get("name").and_then(Value::as_str).is_some()
        && value.get("value").and_then(Value::as_str).is_some()
}

pub fn default_option_id(decision: RuntimePermissionDecision) -> &'static str {
    match decision {
        RuntimePermissionDecision::AllowOnce => "allow_once",
        RuntimePermissionDecision::AllowFuture => "allow_always",
        RuntimePermissionDecision::AllowForSession => "allow_for_session",
        RuntimePermissionDecision::Deny => "reject_once",
    }
}

fn decision_for_official_kind(kind: PermissionOptionKind) -> Option<RuntimePermissionDecision> {
    match kind {
        PermissionOptionKind::AllowOnce => Some(RuntimePermissionDecision::AllowOnce),
        PermissionOptionKind::AllowAlways => Some(RuntimePermissionDecision::AllowFuture),
        PermissionOptionKind::RejectOnce | PermissionOptionKind::RejectAlways => {
            Some(RuntimePermissionDecision::Deny)
        }
        _ => None,
    }
}

fn decision_for_kind_str(kind: &str) -> Option<RuntimePermissionDecision> {
    match kind {
        "allow_once" => Some(RuntimePermissionDecision::AllowOnce),
        "allow_always" => Some(RuntimePermissionDecision::AllowFuture),
        "allow_for_session" => Some(RuntimePermissionDecision::AllowForSession),
        "reject_once" | "reject_always" => Some(RuntimePermissionDecision::Deny),
        _ => None,
    }
}

fn to_value<T: Serialize>(payload: T) -> Value {
    serde_json::to_value(payload).expect("official ACP schema value should serialize")
}

fn from_value<T: DeserializeOwned>(value: Value) -> serde_json::Result<T> {
    serde_json::from_value(value)
}

fn validate_params<T: DeserializeOwned>(method: &str, params: &Value) -> Result<(), String> {
    from_value::<T>(params.clone())
        .map(|_| ())
        .map_err(|error| format!("{method}: invalid ACP params: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        permission_response_value, resolve_permission_option, validate_known_server_request,
    };
    use agent_client_protocol::schema::RequestPermissionResponse;
    use serde_json::json;

    use crate::domain::agents::adapter::RuntimePermissionDecision;

    #[test]
    fn permission_response_uses_official_schema_for_selected_outcome() {
        let value = permission_response_value(
            RuntimePermissionDecision::AllowOnce,
            Some("allow_once"),
            None,
        );
        let parsed: RequestPermissionResponse = serde_json::from_value(value.clone()).unwrap();

        assert_eq!(value["outcome"]["outcome"], "selected");
        assert_eq!(value["outcome"]["optionId"], "allow_once");
        assert!(parsed.meta.is_none());
    }

    #[test]
    fn permission_option_kind_preserves_allow_session_extension() {
        let value = json!({ "optionId": "session", "name": "Allow for session", "kind": "allow_for_session" });
        let option = resolve_permission_option(&value).unwrap();

        assert_eq!(option.decision, RuntimePermissionDecision::AllowForSession);
        assert_eq!(option.option_id.as_deref(), Some("session"));
    }

    #[test]
    fn server_request_validation_accepts_schema_clean_fs_read() {
        let result = validate_known_server_request(
            "fs/read_text_file",
            &json!({ "sessionId": "s-1", "path": "/tmp/file.txt", "line": 1, "limit": 5 }),
        );

        assert!(result.is_ok());
    }

    #[test]
    fn server_request_validation_rejects_malformed_terminal_request() {
        let result =
            validate_known_server_request("terminal/output", &json!({ "terminalId": "t-1" }));

        assert!(result.unwrap_err().contains("terminal/output"));
    }

    #[test]
    fn server_request_validation_accepts_handler_compatible_terminal_create() {
        let result = validate_known_server_request(
            "terminal/create",
            &json!({
                "command": "sh",
                "args": ["-c", "echo ok"],
                "env": { "ACP_PARITY": "ok" },
                "outputByteLimit": 64
            }),
        );

        assert!(result.is_ok());
    }
}
