//! OpenCode question-tool answer extraction.
//!
//! `build_question_tool_input` and the rest of the question-construction
//! helpers were HTTP-transport-only and have been removed; the ACP path
//! consumes the OpenCode question shape directly via the `question_sidecar`
//! and `events_tool_call_question` modules. Only the answer extractor
//! survives here because the adapter still needs it to translate the
//! frontend's reply back into OpenCode's expected `Vec<Vec<String>>` shape.

use serde_json::Value;

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
    use super::extract_question_answers;

    // The structured-shape extraction is exercised by
    // `domain::ws_session::question_answers::extract_answer_lists` in its
    // own test module — no need to duplicate the parser fixture here.
    // These two cases just pin the fallback contract owned by this wrapper.

    #[test]
    fn extract_question_answers_falls_back_to_feedback_when_extraction_yields_nothing() {
        let answers = extract_question_answers(None, Some("custom feedback"));
        assert_eq!(answers, vec![vec!["custom feedback".to_string()]]);
    }

    #[test]
    fn extract_question_answers_uses_default_label_when_neither_input_nor_feedback() {
        let answers = extract_question_answers(None, None);
        assert_eq!(answers, vec![vec!["Approved".to_string()]]);
    }
}
