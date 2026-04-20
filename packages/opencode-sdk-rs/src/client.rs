mod commands;

pub use commands::parse_command_invocation;

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::client_payload::{
    build_permission_reply_payload, build_prompt_payload, build_question_reply_payload,
    parse_session_status_list,
};
use crate::error::SdkError;
use crate::parsing::{
    parse_message_from, parse_permission_from, parse_question_from, parse_session_from,
};
use crate::sse::SseStream;
use crate::types::{
    Message, ModelRef, PermissionReply, PermissionRequest, PromptOptions, PromptPart, Question,
    Session,
};

#[derive(Clone)]
pub struct OpenCodeClient {
    base_url: String,
    http: reqwest::Client,
}

impl OpenCodeClient {
    pub fn new(port: u16) -> Self {
        Self::with_base_url(format!("http://127.0.0.1:{port}"))
    }

    pub async fn init() -> Result<Self, SdkError> {
        let info = crate::process::OpenCodeServer::ensure_running().await?;
        Ok(Self::with_base_url(info.base_url))
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            http: reqwest::Client::new(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn health(&self) -> Result<(), SdkError> {
        let response = self
            .http
            .get(format!("{}/global/health", self.base_url))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn create_session(&self, directory: &str) -> Result<Session, SdkError> {
        let response = self
            .scoped_request(
                self.http.post(format!("{}/session", self.base_url)),
                directory,
            )
            .json(&serde_json::json!({}))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        parse_session_from(&body).ok_or_else(|| {
            SdkError::Protocol("create_session response does not contain a session".to_string())
        })
    }

    pub async fn get_session(&self, id: &str, directory: &str) -> Result<Session, SdkError> {
        let response = self
            .scoped_request(
                self.http.get(format!("{}/session/{id}", self.base_url)),
                directory,
            )
            .send()
            .await?;
        let body = ensure_success(response).await?;
        parse_session_from(&body).ok_or_else(|| {
            SdkError::Protocol("get_session response does not contain a session".to_string())
        })
    }

    pub async fn get_session_any(&self, id: &str) -> Result<Session, SdkError> {
        let response = self
            .http
            .get(format!("{}/session/{id}", self.base_url))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        parse_session_from(&body).ok_or_else(|| {
            SdkError::Protocol("get_session response does not contain a session".to_string())
        })
    }

    pub async fn list_sessions(&self, directory: &str) -> Result<Vec<Session>, SdkError> {
        let response = self
            .scoped_request(
                self.http.get(format!("{}/session/status", self.base_url)),
                directory,
            )
            .send()
            .await?;
        let body = ensure_success(response).await?;
        Ok(parse_session_status_list(&body))
    }

    pub async fn delete_session(&self, id: &str) -> Result<(), SdkError> {
        let response = self
            .http
            .delete(format!("{}/session/{id}", self.base_url))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn prompt_async(
        &self,
        session_id: &str,
        parts: Vec<PromptPart>,
        options: PromptOptions,
    ) -> Result<(), SdkError> {
        self.prompt_async_in_directory(session_id, None, parts, options)
            .await
    }

    pub async fn prompt_async_in_directory(
        &self,
        session_id: &str,
        directory: Option<&str>,
        parts: Vec<PromptPart>,
        options: PromptOptions,
    ) -> Result<(), SdkError> {
        let request = self.http.post(format!(
            "{}/session/{session_id}/prompt_async",
            self.base_url
        ));
        let response = self
            .maybe_scoped_request(request, directory)
            .json(&build_prompt_payload(parts, options))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn list_permissions(&self) -> Result<Vec<PermissionRequest>, SdkError> {
        let response = self
            .http
            .get(format!("{}/permission", self.base_url))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        let items = body
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| parse_permission_from(&item))
            .collect();
        Ok(items)
    }

    pub async fn reply_permission(
        &self,
        request_id: &str,
        reply: PermissionReply,
        message: Option<&str>,
    ) -> Result<(), SdkError> {
        self.reply_permission_in_directory(request_id, None, reply, message)
            .await
    }

    pub async fn reply_permission_in_directory(
        &self,
        request_id: &str,
        directory: Option<&str>,
        reply: PermissionReply,
        message: Option<&str>,
    ) -> Result<(), SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/permission/{request_id}/reply", self.base_url)),
                directory,
            )
            .json(&build_permission_reply_payload(reply, message))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn list_questions(&self) -> Result<Vec<Question>, SdkError> {
        let response = self
            .http
            .get(format!("{}/question", self.base_url))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        let items = body
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| parse_question_from(&item))
            .collect();
        Ok(items)
    }

    pub async fn reply_question(
        &self,
        request_id: &str,
        answers: Vec<Vec<String>>,
    ) -> Result<(), SdkError> {
        self.reply_question_in_directory(request_id, None, answers)
            .await
    }

    pub async fn reply_question_in_directory(
        &self,
        request_id: &str,
        directory: Option<&str>,
        answers: Vec<Vec<String>>,
    ) -> Result<(), SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/question/{request_id}/reply", self.base_url)),
                directory,
            )
            .json(&build_question_reply_payload(answers))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn reject_question(&self, request_id: &str) -> Result<(), SdkError> {
        self.reject_question_in_directory(request_id, None).await
    }

    pub async fn reject_question_in_directory(
        &self,
        request_id: &str,
        directory: Option<&str>,
    ) -> Result<(), SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/question/{request_id}/reject", self.base_url)),
                directory,
            )
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn abort_session(&self, session_id: &str) -> Result<(), SdkError> {
        self.abort_session_in_directory(session_id, None).await
    }

    pub async fn abort_session_in_directory(
        &self,
        session_id: &str,
        directory: Option<&str>,
    ) -> Result<(), SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/session/{session_id}/abort", self.base_url)),
                directory,
            )
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn get_providers_config(&self) -> Result<Value, SdkError> {
        let response = self
            .http
            .get(format!("{}/config/providers", self.base_url))
            .send()
            .await?;
        ensure_success(response).await
    }

    pub async fn get_providers(&self) -> Result<Vec<Value>, SdkError> {
        let body = self.get_providers_config().await?;
        Ok(body
            .as_array()
            .cloned()
            .or_else(|| body.get("providers").and_then(Value::as_array).cloned())
            .unwrap_or_default())
    }

    pub async fn list_messages(&self, session_id: &str) -> Result<Vec<Message>, SdkError> {
        let response = self
            .http
            .get(format!("{}/session/{session_id}/message", self.base_url))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        let messages = body
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| parse_message_from(&value))
            .collect();
        Ok(messages)
    }

    pub async fn summarize_session_in_directory(
        &self,
        session_id: &str,
        directory: Option<&str>,
        model_ref: &ModelRef,
        auto: bool,
    ) -> Result<(), SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/session/{session_id}/summarize", self.base_url)),
                directory,
            )
            .json(&serde_json::json!({
                "providerID": model_ref.provider_id,
                "modelID": model_ref.model_id,
                "auto": auto,
            }))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn list_children_in_directory(
        &self,
        session_id: &str,
        directory: Option<&str>,
    ) -> Result<Vec<Session>, SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .get(format!("{}/session/{session_id}/children", self.base_url)),
                directory,
            )
            .send()
            .await?;
        let body = ensure_success(response).await?;
        Ok(body
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| parse_session_from(&value))
            .collect())
    }

    pub async fn list_children(&self, session_id: &str) -> Result<Vec<Session>, SdkError> {
        self.list_children_in_directory(session_id, None).await
    }

    pub fn event_stream(&self) -> Result<SseStream, SdkError> {
        self.event_stream_for_directory(None)
    }

    pub fn event_stream_for_directory(
        &self,
        directory: Option<&str>,
    ) -> Result<SseStream, SdkError> {
        let request =
            self.maybe_scoped_request(self.http.get(format!("{}/event", self.base_url)), directory);
        SseStream::connect(request)
    }

    fn scoped_request(
        &self,
        req: reqwest::RequestBuilder,
        directory: &str,
    ) -> reqwest::RequestBuilder {
        self.maybe_scoped_request(req, Some(directory))
    }

    fn maybe_scoped_request(
        &self,
        req: reqwest::RequestBuilder,
        directory: Option<&str>,
    ) -> reqwest::RequestBuilder {
        match directory {
            Some(directory) => req
                .query(&[("directory", directory)])
                .header("x-opencode-directory", directory),
            None => req,
        }
    }
}

async fn ensure_success(response: reqwest::Response) -> Result<Value, SdkError> {
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(SdkError::HttpStatus {
            status: status.as_u16(),
            body,
        });
    }
    if body.trim().is_empty() || status == StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    deserialize_json(&body)
}

fn deserialize_json<T: DeserializeOwned>(raw: &str) -> Result<T, SdkError> {
    serde_json::from_str(raw).map_err(SdkError::from)
}
