use serde_json::{json, Value};

pub fn build_question_tool_input(question: &opencode_sdk_rs::Question) -> Value {
    let questions = question
        .questions
        .iter()
        .map(|item| {
            json!({
                "question": item.question,
                "header": item.header,
                "options": item.options.as_ref().map(|options| {
                    options
                        .iter()
                        .map(|option| json!({
                            "label": option.label,
                            "description": option.description,
                        }))
                        .collect::<Vec<Value>>()
                }),
                "multiSelect": item.multiple,
            })
        })
        .collect::<Vec<Value>>();

    if let Some(first) = question.questions.first() {
        json!({
            "question": first.question,
            "options": first.options.as_ref().map(|options| {
                options
                    .iter()
                    .map(|option| json!({
                        "label": option.label,
                        "description": option.description,
                    }))
                    .collect::<Vec<Value>>()
            }),
            "multiSelect": first.multiple,
            "questions": questions,
        })
    } else {
        json!({ "questions": questions })
    }
}

pub fn extract_question_answers(
    updated_input: Option<&Value>,
    feedback: Option<&str>,
) -> Vec<Vec<String>> {
    // Delegate to the shared extractor so OpenCode and the ws_session
    // persistence path stay in lockstep (both must understand legacy `[]`,
    // legacy `{ "0": ... }`, and the canonical `{ [questionText]: string }`
    // shape from `AskUserQuestionOutput`). If extraction fails or yields no
    // real content, fall back to the user's feedback (or "Approved").
    updated_input
        .and_then(crate::domain::ws_session::question_answers::extract_answer_lists)
        .filter(|lists| lists.iter().any(|group| !group.is_empty()))
        .unwrap_or_else(|| vec![vec![feedback.unwrap_or("Approved").to_string()]])
}

#[cfg(test)]
mod tests {
    use super::{build_question_tool_input, extract_question_answers};
    use opencode_sdk_rs::{Question, QuestionItem, QuestionOption};
    use serde_json::json;

    #[test]
    fn build_question_tool_input_preserves_multi_question_shape() {
        let tool_input = build_question_tool_input(&Question {
            id: "que_1".to_string(),
            session_id: "ses_1".to_string(),
            questions: vec![
                QuestionItem {
                    question: "First?".to_string(),
                    header: Some("One".to_string()),
                    options: Some(vec![QuestionOption {
                        label: "A".to_string(),
                        description: Some("alpha".to_string()),
                    }]),
                    multiple: false,
                },
                QuestionItem {
                    question: "Second?".to_string(),
                    header: Some("Two".to_string()),
                    options: None,
                    multiple: false,
                },
            ],
        });

        assert_eq!(tool_input["questions"][0]["question"], "First?");
        assert_eq!(tool_input["questions"][0]["options"][0]["label"], "A");
        assert_eq!(tool_input["questions"][1]["question"], "Second?");
    }

    #[test]
    fn extract_question_answers_parses_structured_multi_question_response() {
        let answers = extract_question_answers(
            Some(&json!({
                "questions": [
                    { "question": "First?" },
                    { "question": "Second?" }
                ],
                "answers": [
                    ["Alpha"],
                    ["Beta"]
                ]
            })),
            None,
        );

        assert_eq!(
            answers,
            vec![vec!["Alpha".to_string()], vec!["Beta".to_string()]]
        );
    }

    #[test]
    fn extract_question_answers_keeps_legacy_object_answers_compatible() {
        let answers = extract_question_answers(
            Some(&json!({
                "question": "Only?",
                "answers": { "0": "Legacy answer" }
            })),
            None,
        );

        assert_eq!(answers, vec![vec!["Legacy answer".to_string()]]);
    }

    #[test]
    fn extract_question_answers_handles_question_text_keyed_map() {
        // OpenCode must accept the canonical `AskUserQuestionOutput` shape
        // produced by the frontend (question text → comma-separated answer).
        let answers = extract_question_answers(
            Some(&json!({
                "questions": [
                    { "question": "First?" },
                    { "question": "Second?" }
                ],
                "answers": {
                    "First?": "Alpha",
                    "Second?": "Beta, Gamma"
                }
            })),
            None,
        );

        assert_eq!(
            answers,
            vec![vec!["Alpha".to_string()], vec!["Beta, Gamma".to_string()],]
        );
    }

    #[test]
    fn extract_question_answers_falls_back_when_payload_is_empty() {
        let answers = extract_question_answers(None, Some("Manual reply"));
        assert_eq!(answers, vec![vec!["Manual reply".to_string()]]);
    }
}
