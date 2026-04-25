use cli_discovery::{parse_version_string, VersionKey};
use reqwest::StatusCode;
use serde::Deserialize;

use crate::error::SdkError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServerHealth {
    pub version: Option<VersionKey>,
}

#[derive(Debug, Deserialize)]
struct HealthResponse {
    healthy: Option<bool>,
    version: Option<String>,
}

pub(crate) async fn fetch_server_health(base_url: &str) -> Result<ServerHealth, SdkError> {
    let response = reqwest::get(format!("{base_url}/global/health")).await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(SdkError::HttpStatus {
            status: status.as_u16(),
            body,
        });
    }

    parse_health_body(status, &body)
}

fn parse_health_body(status: StatusCode, body: &str) -> Result<ServerHealth, SdkError> {
    if body.trim().is_empty() || status == StatusCode::NO_CONTENT {
        return Ok(ServerHealth { version: None });
    }

    let response: HealthResponse = serde_json::from_str(body)?;
    if response.healthy == Some(false) {
        return Err(SdkError::Protocol(
            "OpenCode health check reported unhealthy".to_string(),
        ));
    }
    let version = match response.version {
        Some(raw) => Some(parse_version_string(&raw).ok_or_else(|| {
            SdkError::Protocol(format!(
                "OpenCode health check returned invalid version: {raw}"
            ))
        })?),
        None => None,
    };
    Ok(ServerHealth { version })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_health_body_extracts_version() {
        let health =
            parse_health_body(StatusCode::OK, r#"{"healthy":true,"version":"1.14.24"}"#).unwrap();
        assert_eq!(health.version, Some(VersionKey(1, 14, 24)));
    }

    #[test]
    fn parse_health_body_allows_missing_version() {
        let health = parse_health_body(StatusCode::OK, r#"{"healthy":true}"#).unwrap();
        assert_eq!(health.version, None);
    }

    #[test]
    fn parse_health_body_rejects_invalid_version() {
        let err = parse_health_body(StatusCode::OK, r#"{"healthy":true,"version":"latest"}"#)
            .unwrap_err();
        assert!(err.to_string().contains("invalid version"));
    }
}
