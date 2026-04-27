use serde_json::Value;

use crate::error::SdkError;
use crate::types::{CodexModel, ThreadHandle, TurnHandle};

pub(crate) fn parse_model(value: &Value) -> Option<CodexModel> {
    let id = value.get("id").and_then(Value::as_str)?.to_string();
    let supported_efforts = value
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("reasoningEffort").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    Some(CodexModel {
        id,
        label: value
            .get("displayName")
            .and_then(Value::as_str)
            .or_else(|| value.get("model").and_then(Value::as_str))
            .unwrap_or("Codex model")
            .to_string(),
        description: value
            .get("description")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        supported_efforts,
        default_effort: value
            .get("defaultReasoningEffort")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        context_window: None,
        is_default: value
            .get("isDefault")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub(crate) fn parse_thread_handle(result: &Value) -> Result<ThreadHandle, SdkError> {
    let id = result
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .or_else(|| result.get("threadId").and_then(Value::as_str))
        .ok_or_else(|| SdkError::Protocol("thread response missing id".to_string()))?;
    Ok(ThreadHandle { id: id.to_string() })
}

pub(crate) fn parse_turn_handle(result: &Value) -> Result<TurnHandle, SdkError> {
    let turn = result
        .get("turn")
        .ok_or_else(|| SdkError::Protocol("turn response missing turn".to_string()))?;
    let id = turn
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| SdkError::Protocol("turn response missing id".to_string()))?;
    Ok(TurnHandle {
        id: id.to_string(),
        status: turn
            .get("status")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_model, parse_thread_handle, parse_turn_handle};

    #[test]
    fn parses_model_thread_and_turn_handles() {
        let model = parse_model(&json!({
            "id": "gpt-5.4",
            "displayName": "GPT-5.4",
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": [
                { "reasoningEffort": "low" },
                { "reasoningEffort": "high" },
                { "reasoningEffort": "max" }
            ],
            "isDefault": true
        }))
        .expect("model");
        let thread = parse_thread_handle(&json!({ "thread": { "id": "thread_1" } })).unwrap();
        let turn = parse_turn_handle(&json!({ "turn": { "id": "turn_1" } })).unwrap();

        assert_eq!(model.supported_efforts, vec!["low", "high", "max"]);
        assert_eq!(model.default_effort.as_deref(), Some("high"));
        assert!(model.is_default);
        assert_eq!(thread.id, "thread_1");
        assert_eq!(turn.id, "turn_1");
    }
}
