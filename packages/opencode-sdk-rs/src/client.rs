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
use crate::types::{ConfigProvidersResponse, Message, Session};

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
        let messages = body
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| parse_message_from(&value))
            .collect();
        Ok(messages)
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
        Ok(body
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| parse_session_from(&value))
            .collect())
    }

    /// `GET /config/providers` — opencode's resolved provider/model
    /// list from models.dev + on-disk config.
    ///
    /// Read-only / no token usage: this endpoint is a pure config
    /// listing and does not trigger upstream model API calls.
    pub async fn list_config_providers(&self) -> Result<ConfigProvidersResponse, SdkError> {
        let response = self
            .http
            .get(format!("{}/config/providers", self.base_url))
            .send()
            .await?;
        let body = ensure_success(response).await?;
        let parsed: ConfigProvidersResponse = serde_json::from_value(body)?;
        Ok(parsed)
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

#[cfg(test)]
mod tests {
    use super::OpenCodeClient;
    use axum::routing::get;
    use axum::Json;
    use serde_json::json;

    /// Boots a one-shot axum stub server bound to an OS-assigned port,
    /// answering `GET /config/providers` with the given fixture, and
    /// returns the port the client should talk to.
    async fn spawn_config_providers_stub(body: serde_json::Value) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = axum::Router::new().route(
            "/config/providers",
            get(move || {
                let body = body.clone();
                async move { Json(body) }
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        port
    }

    #[tokio::test]
    async fn list_config_providers_parses_stub_response() {
        let port = spawn_config_providers_stub(json!({
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet-4-5": {
                            "name": "Claude Sonnet 4.5",
                            "limit": { "context": 200000, "output": 64000 }
                        }
                    }
                }
            ],
            "default": { "anthropic": "claude-sonnet-4-5" }
        }))
        .await;

        let client = OpenCodeClient::new(port);
        let response = client.list_config_providers().await.expect("ok");
        assert_eq!(response.providers.len(), 1);
        assert_eq!(response.providers[0].id, "anthropic");
        assert_eq!(response.providers[0].models[0].id, "claude-sonnet-4-5");
        assert_eq!(
            response.default.get("anthropic").map(String::as_str),
            Some("claude-sonnet-4-5"),
        );
    }
}
