//! Minimal REST client for the OpenCode subprocess's embedded HTTP backend.
//!
//! Every `opencode acp --hostname --port` subprocess Cadencr spawns also
//! serves an HTTP backend on the same port. The ACP wire silently drops
//! sub-agent (`Task` / `Agent`) child-session events, so the
//! `upstream_workaround::subagent_listener` polls this backend for them
//! via the two methods below — `list_children_in_directory` to discover
//! child sessions and `list_messages` to tail their parts.
//!
//! Surface is intentionally tiny. New methods get added only when a new
//! workaround needs them. This is **not** a general-purpose OpenCode HTTP
//! client; the legacy long-lived-server transport that used to live here
//! has been retired.

use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::SdkError;
use crate::parsing::{parse_message_from, parse_session_from};
use crate::types::{Message, Session};

#[derive(Clone)]
pub struct OpenCodeClient {
    base_url: String,
    http: reqwest::Client,
}

impl OpenCodeClient {
    pub fn new(port: u16) -> Self {
        Self::with_base_url(format!("http://127.0.0.1:{port}"))
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

    /// `GET /session/{id}/message` — cumulative message snapshot for a
    /// session.
    ///
    /// Load-bearing for the ACP sub-agent workaround: the polling
    /// listener in `cadencr-service`'s
    /// `opencode/acp/upstream_workaround/subagent_listener.rs` uses this
    /// to tail child-session messages OpenCode silently drops from the
    /// ACP wire.
    pub async fn list_messages(&self, session_id: &str) -> Result<Vec<Message>, SdkError> {
        let response = self
            .http
            .get(format!("{}/session/{session_id}/message", self.base_url))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        parse_array(body, "message", parse_message_from)
    }

    /// `GET /session/{id}/children` — direct sub-sessions of a parent.
    ///
    /// Load-bearing for the ACP sub-agent workaround — see the note on
    /// `list_messages`. The polling listener calls this to discover
    /// child sessions OpenCode never registers with the ACP wire.
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
        parse_array(body, "session", parse_session_from)
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

fn parse_array<T>(
    body: Value,
    item_name: &str,
    parse: impl Fn(&Value) -> Option<T>,
) -> Result<Vec<T>, SdkError> {
    let array = body.as_array().ok_or_else(|| {
        SdkError::Protocol(format!("expected {item_name} list response to be an array"))
    })?;
    array
        .iter()
        .enumerate()
        .map(|(index, value)| {
            parse(value).ok_or_else(|| {
                SdkError::Protocol(format!("malformed {item_name} at response index {index}"))
            })
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::{parse_array, OpenCodeClient};
    use axum::extract::State;
    use axum::http::{HeaderMap, StatusCode, Uri};
    use axum::response::IntoResponse;
    use axum::routing::get;
    use axum::Router;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;

    #[derive(Clone)]
    struct ServerState {
        body: Arc<str>,
        status: StatusCode,
        requests: Arc<Mutex<Vec<String>>>,
    }

    async fn test_client(
        body: &str,
        status: StatusCode,
    ) -> (OpenCodeClient, Arc<Mutex<Vec<String>>>) {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = ServerState {
            body: Arc::from(body),
            status,
            requests: Arc::clone(&requests),
        };
        let app = Router::new()
            .route("/session/{id}/message", get(record_request))
            .route("/session/{id}/children", get(record_request))
            .with_state(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (OpenCodeClient::with_base_url(base_url), requests)
    }

    async fn record_request(
        State(state): State<ServerState>,
        uri: Uri,
        headers: HeaderMap,
    ) -> impl IntoResponse {
        let header = headers
            .get("x-opencode-directory")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        state
            .requests
            .lock()
            .unwrap()
            .push(format!("{uri} header={header}"));
        (state.status, state.body.to_string())
    }

    #[test]
    fn parse_array_rejects_non_array_response() {
        let error = parse_array::<()>(json!({ "not": "array" }), "message", |_| Some(()))
            .expect_err("non-array response should error");
        assert!(error.to_string().contains("expected message list response"));
    }

    #[test]
    fn parse_array_rejects_malformed_items() {
        let error = parse_array::<()>(json!([{}]), "session", |_| None)
            .expect_err("malformed item should error");
        assert!(error
            .to_string()
            .contains("malformed session at response index 0"));
    }

    #[test]
    fn parse_array_returns_all_parsed_items() {
        let parsed = parse_array(json!([1, 2]), "number", |value| value.as_i64())
            .expect("valid array should parse");
        assert_eq!(parsed, vec![1, 2]);
    }

    #[tokio::test]
    async fn list_messages_errors_on_non_array_response() {
        let (client, _requests) = test_client(r#"{"not":"array"}"#, StatusCode::OK).await;
        let error = client.list_messages("ses_1").await.unwrap_err();
        assert!(error
            .to_string()
            .contains("expected message list response to be an array"));
    }

    #[tokio::test]
    async fn list_messages_errors_on_malformed_item() {
        let (client, _requests) = test_client("[{}]", StatusCode::OK).await;
        let error = client.list_messages("ses_1").await.unwrap_err();
        assert!(error
            .to_string()
            .contains("malformed message at response index 0"));
    }

    #[tokio::test]
    async fn list_children_sends_directory_scope_and_errors_on_malformed_item() {
        let (client, requests) = test_client("[{}]", StatusCode::OK).await;
        let error = client
            .list_children_in_directory("ses_1", Some("/tmp/project"))
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("malformed session at response index 0"));
        let requests = requests.lock().unwrap();
        assert!(requests[0].contains("/session/ses_1/children?directory=%2Ftmp%2Fproject"));
        assert!(requests[0].contains("header=/tmp/project"));
    }

    #[tokio::test]
    async fn non_success_response_includes_status_and_body() {
        let (client, _requests) = test_client("bad gateway", StatusCode::BAD_GATEWAY).await;
        let error = client.list_messages("ses_1").await.unwrap_err();
        assert!(error.to_string().contains("http status 502"));
        assert!(error.to_string().contains("bad gateway"));
    }
}
