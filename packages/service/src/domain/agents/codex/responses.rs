use serde_json::{json, Value};

use super::permissions::{
    available_decisions, supports_accept_for_session, DECISION_CANCEL, DECISION_DECLINE,
};
use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionResponse};

pub(super) fn response_value(
    method: &str,
    params: &Value,
    response: &RuntimePermissionResponse,
) -> Value {
    match method {
        "mcpServer/elicitation/request" => elicitation_response(response),
        "item/tool/requestUserInput" => user_input_response(params, response),
        "item/permissions/requestApproval" => permissions_response(params, response),
        _ => approval_response(params, response),
    }
}

fn approval_response(params: &Value, response: &RuntimePermissionResponse) -> Value {
    let decision = match response.decision {
        RuntimePermissionDecision::AllowOnce => "accept",
        RuntimePermissionDecision::AllowFuture if supports_accept_for_session(params) => {
            "acceptForSession"
        }
        RuntimePermissionDecision::AllowFuture => "accept",
        RuntimePermissionDecision::Deny => deny_decision(params),
    };
    json!({ "decision": decision })
}

fn deny_decision(params: &Value) -> &'static str {
    if !params.get("availableDecisions").is_some() {
        return "decline";
    }
    let mut has_cancel = false;
    for decision in available_decisions(params) {
        if decision == DECISION_DECLINE {
            return "decline";
        }
        has_cancel |= decision == DECISION_CANCEL;
    }
    if has_cancel {
        "cancel"
    } else {
        "decline"
    }
}

fn elicitation_response(response: &RuntimePermissionResponse) -> Value {
    match response.decision {
        RuntimePermissionDecision::Deny => {
            json!({ "action": "decline", "content": null, "_meta": null })
        }
        _ => json!({
            "action": "accept",
            "content": response.updated_input.clone().unwrap_or_else(|| json!({ "approved": true })),
            "_meta": null,
        }),
    }
}

fn user_input_response(params: &Value, response: &RuntimePermissionResponse) -> Value {
    let Some(raw_answers) = response
        .updated_input
        .as_ref()
        .and_then(|input| input.get("answers"))
    else {
        return json!({ "answers": {} });
    };
    json!({ "answers": codex_question_answers(params, raw_answers) })
}

fn codex_question_answers(params: &Value, raw_answers: &Value) -> Value {
    if raw_answers
        .as_object()
        .is_some_and(|object| object.values().any(|value| value.get("answers").is_some()))
    {
        return raw_answers.clone();
    }

    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut mapped = serde_json::Map::new();
    for (index, question) in questions.iter().enumerate() {
        let Some(question_id) = question.get("id").and_then(Value::as_str) else {
            continue;
        };
        mapped.insert(
            question_id.to_string(),
            json!({ "answers": answer_values(raw_answers, index, question_id) }),
        );
    }
    Value::Object(mapped)
}

fn answer_values(raw_answers: &Value, index: usize, question_id: &str) -> Vec<String> {
    let index_key = index.to_string();
    let value = raw_answers
        .get(question_id)
        .or_else(|| raw_answers.get(index_key.as_str()))
        .or_else(|| raw_answers.as_array().and_then(|items| items.get(index)));
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect(),
        Some(Value::String(answer)) => vec![answer.clone()],
        _ => Vec::new(),
    }
}

fn permissions_response(params: &Value, response: &RuntimePermissionResponse) -> Value {
    if matches!(response.decision, RuntimePermissionDecision::Deny) {
        return json!({ "permissions": {}, "scope": "turn" });
    }
    let scope = match response.decision {
        RuntimePermissionDecision::AllowFuture => "session",
        _ => "turn",
    };
    json!({
        "permissions": params.get("permissions").cloned().unwrap_or(Value::Null),
        "scope": scope,
    })
}

#[cfg(test)]
mod tests {
    use super::response_value;
    use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionResponse};
    use serde_json::{json, Value};

    #[test]
    fn denied_user_input_uses_codex_answer_shape() {
        let response = RuntimePermissionResponse {
            request_id: "question".to_string(),
            decision: RuntimePermissionDecision::Deny,
            feedback: None,
            updated_input: None,
        };
        let value = response_value("item/tool/requestUserInput", &Value::Null, &response);
        assert_eq!(value, json!({ "answers": {} }));
    }

    #[test]
    fn user_input_answers_are_keyed_by_codex_question_ids() {
        let response = RuntimePermissionResponse {
            request_id: "question".to_string(),
            decision: RuntimePermissionDecision::AllowOnce,
            feedback: None,
            updated_input: Some(json!({ "answers": [["yes"], ["no"]] })),
        };
        let params = json!({
            "questions": [
                { "id": "q1", "question": "First?" },
                { "id": "q2", "question": "Second?" }
            ]
        });

        let value = response_value("item/tool/requestUserInput", &params, &response);
        assert_eq!(
            value,
            json!({ "answers": { "q1": { "answers": ["yes"] }, "q2": { "answers": ["no"] } } })
        );
    }

    #[test]
    fn user_input_answers_accept_already_keyed_codex_shape() {
        let response = RuntimePermissionResponse {
            request_id: "question".to_string(),
            decision: RuntimePermissionDecision::AllowOnce,
            feedback: None,
            updated_input: Some(json!({
                "answers": {
                    "q1": { "answers": ["already mapped"] }
                }
            })),
        };
        let params = json!({ "questions": [{ "id": "q1", "question": "First?" }] });

        let value = response_value("item/tool/requestUserInput", &params, &response);
        assert_eq!(
            value,
            json!({ "answers": { "q1": { "answers": ["already mapped"] } } })
        );
    }

    #[test]
    fn permission_approval_uses_session_scope_for_allow_future() {
        let response = RuntimePermissionResponse {
            request_id: "permissions".to_string(),
            decision: RuntimePermissionDecision::AllowFuture,
            feedback: None,
            updated_input: None,
        };
        let params = json!({ "permissions": { "write": true } });

        let value = response_value("item/permissions/requestApproval", &params, &response);
        assert_eq!(
            value,
            json!({ "permissions": { "write": true }, "scope": "session" })
        );
    }

    #[test]
    fn command_deny_declines_without_cancelling_turn() {
        let response = RuntimePermissionResponse {
            request_id: "command".to_string(),
            decision: RuntimePermissionDecision::Deny,
            feedback: Some("Skip it".to_string()),
            updated_input: None,
        };

        let value = response_value(
            "item/commandExecution/requestApproval",
            &Value::Null,
            &response,
        );
        assert_eq!(value, json!({ "decision": "decline" }));
    }

    #[test]
    fn command_deny_uses_cancel_only_when_decline_is_unavailable() {
        let response = RuntimePermissionResponse {
            request_id: "command".to_string(),
            decision: RuntimePermissionDecision::Deny,
            feedback: None,
            updated_input: None,
        };

        let value = response_value(
            "item/commandExecution/requestApproval",
            &json!({ "availableDecisions": ["accept", "cancel"] }),
            &response,
        );
        assert_eq!(value, json!({ "decision": "cancel" }));
    }

    #[test]
    fn allow_future_falls_back_to_accept_when_session_decision_is_unavailable() {
        let response = RuntimePermissionResponse {
            request_id: "approval".to_string(),
            decision: RuntimePermissionDecision::AllowFuture,
            feedback: None,
            updated_input: None,
        };

        let value = response_value(
            "item/commandExecution/requestApproval",
            &json!({ "availableDecisions": ["accept", "decline"] }),
            &response,
        );

        assert_eq!(value, json!({ "decision": "accept" }));
    }
}
