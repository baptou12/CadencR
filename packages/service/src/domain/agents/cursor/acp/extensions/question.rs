use serde_json::{json, Value};

use crate::domain::agents::acp::runtime::provider_hooks::AcpExtensionRequest;
use crate::domain::agents::adapter::{
    RuntimeEventMetadata, RuntimePermissionDecision, RuntimePermissionRequest,
    RuntimePermissionResponse,
};

use super::{assistant_tool_event_with_id, gate_options, tool_call_id};

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
        return json!({
            "outcome": {
                "outcome": "skipped",
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
    if let Some(structured) = updated_input
        .get("structured_answers")
        .and_then(Value::as_array)
    {
        return structured.iter().filter_map(structured_answer).collect();
    }
    let answers = updated_input.get("answers").and_then(Value::as_object);
    params
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|question| answer_for_question(question, answers))
        .collect()
}

fn structured_answer(answer: &Value) -> Option<Value> {
    Some(json!({
        "questionId": answer.get("questionId")?.as_str()?,
        "selectedOptionIds": answer.get("selectedOptionIds")?.as_array()?,
    }))
}

fn answer_for_question(
    question: &Value,
    answers: Option<&serde_json::Map<String, Value>>,
) -> Value {
    let prompt = question.get("prompt").and_then(Value::as_str).unwrap_or("");
    let selected = answers
        .and_then(|answers| answers.get(prompt))
        .and_then(Value::as_str)
        .map(|answer| selected_option_ids(question, answer))
        .unwrap_or_default();
    json!({
        "questionId": question.get("id").and_then(Value::as_str).unwrap_or(prompt),
        "selectedOptionIds": selected,
    })
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
}
