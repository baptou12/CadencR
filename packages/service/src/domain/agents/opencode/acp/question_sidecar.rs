use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use tokio::time::sleep;

use crate::domain::agents::adapter::RuntimeError;

const DIRECTORY_QUERY: &str = "directory";
const DIRECTORY_HEADER: &str = "x-opencode-directory";
const QUESTION_REPLY_ACTION: &str = "reply";
const QUESTION_REJECT_ACTION: &str = "reject";
const QUESTION_LOOKUP_RETRIES: usize = 10;
const QUESTION_LOOKUP_DELAY: Duration = Duration::from_millis(100);
const QUESTION_HTTP_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub(super) struct QuestionSidecar {
    base_url: String,
    directory: String,
    http: reqwest::Client,
}

impl QuestionSidecar {
    pub(super) fn new(port: u16, directory: &Path) -> Self {
        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            directory: directory.to_string_lossy().to_string(),
            http: reqwest::Client::builder()
                .timeout(QUESTION_HTTP_TIMEOUT)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    pub(super) async fn reply_tool_call(
        &self,
        tool_call_id: &str,
        answers: Vec<Vec<String>>,
    ) -> Result<(), RuntimeError> {
        let question_id = self.find_question_id(tool_call_id).await?;
        self.post_question_action(&question_id, QUESTION_REPLY_ACTION, Some(answers))
            .await
    }

    pub(super) async fn reject_tool_call(&self, tool_call_id: &str) -> Result<(), RuntimeError> {
        let question_id = self.find_question_id(tool_call_id).await?;
        self.post_question_action(&question_id, QUESTION_REJECT_ACTION, None)
            .await
    }

    async fn find_question_id(&self, tool_call_id: &str) -> Result<String, RuntimeError> {
        let mut last_error = None;
        for attempt in 0..QUESTION_LOOKUP_RETRIES {
            match self.list_questions().await {
                Ok(questions) => {
                    if let Some(question_id) = question_id_for_tool_call(&questions, tool_call_id) {
                        return Ok(question_id);
                    }
                }
                Err(error) => last_error = Some(error.to_string()),
            }
            if attempt + 1 < QUESTION_LOOKUP_RETRIES {
                sleep(QUESTION_LOOKUP_DELAY).await;
            }
        }
        let suffix = last_error
            .as_deref()
            .map(|error| format!("; last lookup error: {error}"))
            .unwrap_or_default();
        Err(RuntimeError::new(format!(
            "OpenCode ACP question id not found for tool call {tool_call_id}{suffix}"
        )))
    }

    async fn list_questions(&self) -> Result<Value, RuntimeError> {
        let response = self
            .scoped(self.http.get(format!("{}/question", self.base_url)))
            .send()
            .await
            .map_err(|error| RuntimeError::new(format!("list ACP questions failed: {error}")))?;
        response_json(response, "list ACP questions").await
    }

    async fn post_question_action(
        &self,
        question_id: &str,
        action: &str,
        answers: Option<Vec<Vec<String>>>,
    ) -> Result<(), RuntimeError> {
        let url = format!("{}/question/{question_id}/{action}", self.base_url);
        let mut request = self.scoped(self.http.post(url));
        if let Some(answers) = answers {
            request = request.json(&serde_json::json!({ "answers": answers }));
        }
        let response = request.send().await.map_err(|error| {
            RuntimeError::new(format!("OpenCode ACP question {action} failed: {error}"))
        })?;
        ensure_success(response, "OpenCode ACP question response").await
    }

    fn scoped(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .query(&[(DIRECTORY_QUERY, self.directory.as_str())])
            .header(DIRECTORY_HEADER, self.directory.as_str())
    }
}

async fn ensure_success(response: reqwest::Response, context: &str) -> Result<(), RuntimeError> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.map_err(|error| {
        RuntimeError::new(format!("{context} response body read failed: {error}"))
    })?;
    Err(RuntimeError::new(format!(
        "{context} returned HTTP {}: {body}",
        status.as_u16()
    )))
}

async fn response_json(response: reqwest::Response, context: &str) -> Result<Value, RuntimeError> {
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        RuntimeError::new(format!("{context} response body read failed: {error}"))
    })?;
    if !status.is_success() {
        return Err(RuntimeError::new(format!(
            "{context} returned HTTP {}: {body}",
            status.as_u16()
        )));
    }
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body)
        .map_err(|error| RuntimeError::new(format!("{context} returned invalid JSON: {error}")))
}

pub(super) fn question_id_for_tool_call(questions: &Value, tool_call_id: &str) -> Option<String> {
    questions.as_array()?.iter().find_map(|question| {
        let call_id = question
            .get("tool")
            .and_then(|tool| tool.get("callID").or_else(|| tool.get("callId")))
            .and_then(Value::as_str)?;
        if call_id == tool_call_id {
            question
                .get("id")
                .or_else(|| question.get("requestID"))
                .or_else(|| question.get("request_id"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::question_id_for_tool_call;
    use serde_json::json;

    #[test]
    fn finds_question_id_by_acp_tool_call_id() {
        let questions = json!([
            {
                "id": "que_1",
                "sessionID": "ses_1",
                "tool": {
                    "messageID": "msg_1",
                    "callID": "call_1"
                },
                "questions": [{ "question": "Pick one" }]
            }
        ]);

        assert_eq!(
            question_id_for_tool_call(&questions, "call_1").as_deref(),
            Some("que_1")
        );
    }

    #[test]
    fn accepts_alternate_question_and_call_id_fields() {
        let questions = json!([
            {
                "request_id": "que_snake",
                "tool": { "callId": "call_snake" },
                "questions": [{ "question": "Pick one" }]
            },
            {
                "requestID": "que_camel",
                "tool": { "callID": "call_camel" },
                "questions": [{ "question": "Pick two" }]
            }
        ]);

        assert_eq!(
            question_id_for_tool_call(&questions, "call_snake").as_deref(),
            Some("que_snake")
        );
        assert_eq!(
            question_id_for_tool_call(&questions, "call_camel").as_deref(),
            Some("que_camel")
        );
    }
}
