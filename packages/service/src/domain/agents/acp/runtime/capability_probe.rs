//! Shared ACP optional-method probing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::JsonRpcRequest;
use serde_json::Value;

use crate::domain::agents::acp::{AcpClient, AcpError};
use crate::domain::agents::adapter::RuntimeError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeResult {
    Supported,
    AlreadyUnsupported,
    NewlyUnsupported,
}

pub async fn request_optional_method_value(
    client: &AcpClient,
    method: &'static str,
    params: Value,
    timeout: Duration,
    supports_flag: &Arc<AtomicBool>,
) -> Result<(ProbeResult, Option<Value>), RuntimeError> {
    if !supports_flag.load(Ordering::Relaxed) {
        return Ok((ProbeResult::AlreadyUnsupported, None));
    }
    match client.request_with_timeout(method, params, timeout).await {
        Ok(value) => Ok((ProbeResult::Supported, Some(value))),
        Err(AcpError::Rpc { code: -32601, .. }) => {
            let result = if supports_flag.swap(false, Ordering::Relaxed) {
                ProbeResult::NewlyUnsupported
            } else {
                ProbeResult::AlreadyUnsupported
            };
            Ok((result, None))
        }
        Err(error) => Err(RuntimeError::new(format!("{method} failed: {error}"))),
    }
}

pub async fn request_optional_typed<Req>(
    client: &AcpClient,
    request: Req,
    timeout: Duration,
    supports_flag: &Arc<AtomicBool>,
) -> Result<ProbeResult, RuntimeError>
where
    Req: JsonRpcRequest,
    Req::Response: Send,
{
    let method = request.method().to_string();
    if !supports_flag.load(Ordering::Relaxed) {
        return Ok(ProbeResult::AlreadyUnsupported);
    }
    match client.send_request_typed(request, timeout).await {
        Ok(_) => Ok(ProbeResult::Supported),
        Err(AcpError::Rpc { code: -32601, .. }) => {
            let result = if supports_flag.swap(false, Ordering::Relaxed) {
                ProbeResult::NewlyUnsupported
            } else {
                ProbeResult::AlreadyUnsupported
            };
            Ok(result)
        }
        Err(error) => Err(RuntimeError::new(format!("{method} failed: {error}"))),
    }
}
