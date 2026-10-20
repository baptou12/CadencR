//! One request to a tab's backend: its bounds, and the handle a request
//! reusing a running backend goes through.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use super::models::{PluginBackendRequest, PluginBackendResponse};
use super::process::Running;
use crate::domain::plugin_tabs::exec::request_timeout;
use crate::domain::plugin_tabs::managed::storage::ManagedFacts;
use crate::error::AppError;

const MAX_METHOD_CHARS: usize = 128;
pub(super) const MAX_PARAMS_BYTES: usize = 1024 * 1024;

/// A backend [`super::BackendSupervisor::running`] found, for one request.
pub struct RunningBackend(Arc<Running>);

impl RunningBackend {
    pub(super) fn new(running: Arc<Running>) -> Self {
        Self(running)
    }

    /// The tab folder it runs from.
    pub fn plugin_dir(&self) -> &Path {
        &self.0.plugin_dir
    }

    /// The version and signed facts of the marketplace revision it runs;
    /// `None` for a local tab.
    pub fn managed(&self) -> Option<(&str, &ManagedFacts)> {
        let running = &self.0;
        running
            .managed
            .as_ref()
            .map(|facts| (running.plugin_version.as_str(), facts))
    }

    /// Relay `request` to it.
    pub async fn request(
        &self,
        request: PluginBackendRequest,
    ) -> Result<PluginBackendResponse, AppError> {
        let timeout = check_request(&request)?;
        self.0.call(&request.method, request.params, timeout).await
    }
}

pub(super) fn check_request(request: &PluginBackendRequest) -> Result<Duration, AppError> {
    let method_chars = request.method.chars().count();
    if method_chars == 0 || method_chars > MAX_METHOD_CHARS {
        return Err(AppError::BadRequest(format!(
            "method must be 1–{MAX_METHOD_CHARS} characters"
        )));
    }
    let params_bytes = serde_json::to_vec(&request.params).map_or(usize::MAX, |bytes| bytes.len());
    if params_bytes > MAX_PARAMS_BYTES {
        return Err(AppError::BadRequest(format!(
            "params must be at most {} KiB of JSON",
            MAX_PARAMS_BYTES / 1024
        )));
    }
    request_timeout(request.timeout_ms)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    fn request(method: &str, params: Value, timeout_ms: Option<u64>) -> PluginBackendRequest {
        PluginBackendRequest {
            method: method.into(),
            params,
            timeout_ms,
        }
    }

    #[test]
    fn requests_are_bounded() {
        assert_eq!(
            check_request(&request("list", json!({}), None)).ok(),
            Some(crate::domain::plugin_tabs::exec::DEFAULT_TIMEOUT)
        );
        for bad in [
            request("", Value::Null, None),
            request(&"m".repeat(129), Value::Null, None),
            request("m", json!("x".repeat(MAX_PARAMS_BYTES)), None),
            request("m", Value::Null, Some(0)),
            request("m", Value::Null, Some(120_001)),
        ] {
            assert!(check_request(&bad).is_err());
        }
    }
}
