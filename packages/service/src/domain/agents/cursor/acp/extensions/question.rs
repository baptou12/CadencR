use serde_json::{json, Value};

use crate::domain::agents::acp::runtime::provider_hooks::AcpExtensionRequest;
use crate::domain::agents::adapter::{
    RuntimeEventMetadata, RuntimePermissionDecision, RuntimePermissionRequest,
    RuntimePermissionResponse,
};

use super::{assistant_tool_event_with_id, gate_options, tool_call_id};

const FREEFORM_OPTION_ID: &str = "__freeform_other__";

pub(super) fn request(
    request_id: &str,
    params: &Value,
    metadata: RuntimeEventMetadata,
) -> AcpExtensionRequest {
    let tool_input = tool_input(params);
    let tool_call_id = tool_call_id(params, request_id);
    AcpExtensionRequest {
        permission: RuntimePermissionRequest {
            request_id: request_id.to_string(),
            tool_use_id: Some(tool_call_id.clone()),
            tool_name: "AskUserQuestion".to_string(),
            tool_input: tool_input.clone(),
            description: params
                .get("title")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            pattern: None,
            preview: None,
            options: gate_options("Submit answers"),
        },
        events: vec![assistant_tool_event_with_id(
            tool_call_id,
            "AskUserQuestion",
            tool_input,
            metadata,
        )],
    }
}

pub(super) fn response(params: &Value, response: &RuntimePermissionResponse) -> Value {
    if matches!(response.decision, RuntimePermissionDecision::Deny) {
        // Cursor's docs mention `cancelled`; interactive Reject maps to
        // `skipped` with an optional reason so Composer can continue.
        let outcome = if response.feedback.as_deref().is_some_and(|feedback| {
            feedback.eq_ignore_ascii_case("cancelled") || feedback.eq_ignore_ascii_case("cancel")
        }) {
            "cancelled"
        } else {
            "skipped"
        };
        return json!({
            "outcome": {
                "outcome": outcome,
                "reason": response.feedback.as_deref().unwrap_or("Question skipped by user"),
            }
        });
    }
    let answers = response
        .updated_input
        .as_ref()
        .map(|input| selected_answers(params, input))
        .unwrap_or_default();
    json!({ "outcome": { "outcome": "answered", "answers": answers } })
}

fn tool_input(params: &Value) -> Value {
    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .map(|questions| questions.iter().map(question_input).collect::<Vec<_>>())
        .unwrap_or_default();
    json!({ "questions": questions, "title": params.get("title") })
}

fn question_input(question: &Value) -> Value {
    let options = question
        .get("options")
        .and_then(Value::as_array)
        .map(|options| {
            options
                .iter()
                .map(|option| {
                    json!({
                        "label": option.get("label").and_then(Value::as_str).unwrap_or(""),
                        "id": option.get("id"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "question": question.get("prompt").and_then(Value::as_str).unwrap_or(""),
        "id": question.get("id"),
        "options": options,
        "multiSelect": question.get("allowMultiple").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn selected_answers(params: &Value, updated_input: &Value) -> Vec<Value> {
    let answers = updated_input.get("answers").and_then(Value::as_object);
    let structured = updated_input
        .get("structured_answers")
        .and_then(Value::as_array);
    params
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, question)| {
            answer_for_question(
                question,
                answers,
                structured.and_then(|items| items.get(index)),
            )
        })
        .collect()
}

fn answer_for_question(
    question: &Value,
    answers: Option<&serde_json::Map<String, Value>>,
    structured: Option<&Value>,
) -> Value {
    let prompt = question.get("prompt").and_then(Value::as_str).unwrap_or("");
    let question_id = question.get("id").and_then(Value::as_str).unwrap_or(prompt);
    let structured_ids = structured
        .and_then(|answer| answer.get("selectedOptionIds"))
        .and_then(Value::as_array)
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let selected = if !structured_ids.is_empty() {
        structured_ids
    } else {
        answers
            .and_then(|answers| answers.get(prompt))
            .and_then(Value::as_str)
            .map(|answer| selected_option_ids(question, answer))
            .unwrap_or_default()
    };
    let free_text = answers
        .and_then(|answers| answers.get(prompt))
        .and_then(Value::as_str)
        .filter(|answer| {
            selected.is_empty()
                || option_id_for_label(
                    question
                        .get("options")
                        .and_then(Value::as_array)
                        .map(Vec::as_slice)
                        .unwrap_or_default(),
                    answer,
                )
                .is_none()
        });
    let mut payload = json!({
        "questionId": question_id,
        "selectedOptionIds": selected,
    });
    // Preserve free-text / "Other" answers when Cursor's freeform option is used.
    if let Some(free_text) = free_text {
        payload["freeformText"] = json!(free_text);
        if selected.is_empty() {
            payload["selectedOptionIds"] = json!([FREEFORM_OPTION_ID]);
        }
    }
    payload
}

fn selected_option_ids(question: &Value, answer: &str) -> Vec<String> {
    let options = question
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(id) = option_id_for_label(&options, answer) {
        return vec![id];
    }
    answer
        .split(", ")
        .filter(|label| !label.is_empty())
        .filter_map(|label| option_id_for_label(&options, label))
        .collect()
}

fn option_id_for_label(options: &[Value], label: &str) -> Option<String> {
    options.iter().find_map(|option| {
        (option.get("label").and_then(Value::as_str) == Some(label))
            .then(|| {
                option
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .flatten()
    })
}

#[cfg(test)]
mod tests {
    use super::{request, response};
    use crate::domain::agents::adapter::{
        RuntimeEventMetadata, RuntimePermissionDecision, RuntimePermissionResponse,
    };
    use serde_json::json;

    #[test]
    fn converts_question_shape_and_maps_labels_back_to_ids() {
        let params = json!({
            "questions": [{
                "id": "q1",
                "prompt": "Which mode?",
                "options": [
                    { "id": "agent", "label": "Agent" },
                    { "id": "plan", "label": "Plan" }
                ]
            }]
        });
        let request = request("request-1", &params, RuntimeEventMetadata::default());
        assert_eq!(request.permission.tool_name, "AskUserQuestion");
        assert_eq!(
            request.permission.tool_input["questions"][0]["question"],
            "Which mode?"
        );
        assert_eq!(request.permission.tool_input["questions"][0]["id"], "q1");
        let answer = RuntimePermissionResponse {
            request_id: "request-1".to_string(),
            decision: RuntimePermissionDecision::AllowOnce,
            option_id: None,
            feedback: None,
            updated_input: Some(json!({
                "answers": { "Which mode?": "Plan" },
                "structured_answers": [{
                    "questionId": "q1",
                    "selectedOptionIds": ["plan"]
                }]
            })),
        };
        let payload = response(&params, &answer);
        assert_eq!(
            payload["outcome"]["answers"][0]["selectedOptionIds"],
            json!(["plan"])
        );
    }

    #[test]
    fn empty_structured_answers_fall_back_to_free_text() {
        let params = json!({
            "questions": [{
                "id": "q1",
                "prompt": "Anything else?",
                "options": [{ "id": "yes", "label": "Yes" }]
            }]
        });
        let answer = RuntimePermissionResponse {
            request_id: "request-1".to_string(),
            decision: RuntimePermissionDecision::AllowOnce,
            option_id: None,
            feedback: None,
            updated_input: Some(json!({
                "answers": { "Anything else?": "custom note" },
                "structured_answers": [{
                    "questionId": "q1",
                    "selectedOptionIds": []
                }]
            })),
        };
        let payload = response(&params, &answer);
        assert_eq!(
            payload["outcome"]["answers"][0]["selectedOptionIds"],
            json!(["__freeform_other__"])
        );
        assert_eq!(
            payload["outcome"]["answers"][0]["freeformText"],
            "custom note"
        );
    }
}
