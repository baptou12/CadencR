//! `session/set_config_option` plumbing.
//!
//! Implements the schema-correct path for switching model / thinking effort
//! mid-session: a JSON-RPC request `session/set_config_option` per option,
//! falling back to the legacy "ride along on the next prompt" behaviour when
//! the agent advertises `MethodNotFound (-32601)`.
//!
//! Once a fallback has been observed for a given session we flip an atomic
//! `supports_set_config_option` flag to false and stop trying — subsequent
//! `set_model` / `set_thinking_effort` calls just update the local state and
//! let `build_prompt_params` carry `model` / `_meta.thinkingEffort`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::domain::agents::acp::{AcpClient, AcpError};
use crate::domain::agents::adapter::RuntimeError;

const SET_CONFIG_OPTION_TIMEOUT: Duration = Duration::from_secs(15);

/// Set the active model for this session via `session/set_config_option`.
///
/// On success: updates `current_model`. On `MethodNotFound`: flips
/// `supports_set_config_option` to false, sets `current_model` so the legacy
/// fallback (ride-along on the next prompt) kicks in, and returns `Ok(())`.
pub async fn set_config_option_model(
    client: &AcpClient,
    session_id: &str,
    current_model: &Arc<RwLock<Option<String>>>,
    supports_flag: &Arc<AtomicBool>,
    new_model: &str,
) -> Result<(), RuntimeError> {
    set_config_option(
        client,
        session_id,
        current_model,
        supports_flag,
        "model",
        Some(new_model),
    )
    .await
}

/// Set the active thinking effort for this session via
/// `session/set_config_option`. `effort` is the raw provider string (e.g.
/// "low" / "medium" / "high"); `None` clears the override.
pub async fn set_config_option_thinking_effort(
    client: &AcpClient,
    session_id: &str,
    current_effort: &Arc<RwLock<Option<String>>>,
    supports_flag: &Arc<AtomicBool>,
    new_effort: Option<&str>,
) -> Result<(), RuntimeError> {
    set_config_option(
        client,
        session_id,
        current_effort,
        supports_flag,
        "thinkingEffort",
        new_effort,
    )
    .await
}

/// Shared body of `set_config_option_*`: short-circuit when the local value
/// already matches, otherwise send the request and update local state on
/// success or `MethodNotFound` fallback.
async fn set_config_option(
    client: &AcpClient,
    session_id: &str,
    current: &Arc<RwLock<Option<String>>>,
    supports_flag: &Arc<AtomicBool>,
    name: &str,
    new_value: Option<&str>,
) -> Result<(), RuntimeError> {
    if value_is_already_current(current, new_value).await {
        return Ok(());
    }
    let payload = new_value.map_or(Value::Null, |v| Value::String(v.to_string()));
    send_set_config_option(client, session_id, supports_flag, name, payload).await?;
    // Always update local state so the legacy fallback (and the FE) sees the
    // user's intent even when the agent doesn't acknowledge the option.
    *current.write().await = new_value.map(ToOwned::to_owned);
    Ok(())
}

/// Issue a `session/set_config_option` request. Returns `Ok(())` regardless
/// of whether the agent ack'd or returned `MethodNotFound` — the caller's
/// local state update is the ground truth either way. Other RPC errors
/// propagate.
async fn send_set_config_option(
    client: &AcpClient,
    session_id: &str,
    supports_flag: &Arc<AtomicBool>,
    name: &str,
    value: Value,
) -> Result<(), RuntimeError> {
    if !supports_flag.load(Ordering::SeqCst) {
        // Already known unsupported — skip the round trip entirely.
        return Ok(());
    }
    let params = json!({
        "sessionId": session_id,
        "configOption": { "name": name, "value": value },
    });
    match client
        .request_with_timeout(
            "session/set_config_option",
            params,
            SET_CONFIG_OPTION_TIMEOUT,
        )
        .await
    {
        Ok(_) => Ok(()),
        Err(AcpError::Rpc { code: -32601, .. }) => {
            // First time we see MethodNotFound: warn once. Subsequent calls
            // short-circuit at the top of the function before issuing a
            // request, so this only fires once per session.
            if supports_flag.swap(false, Ordering::SeqCst) {
                tracing::warn!(
                    config_option = name,
                    "ACP agent does not support session/set_config_option; \
                     falling back to legacy ride-along on session/prompt"
                );
            }
            Ok(())
        }
        Err(error) => Err(RuntimeError::new(format!(
            "session/set_config_option({name}) failed: {error}"
        ))),
    }
}

async fn value_is_already_current(
    current: &Arc<RwLock<Option<String>>>,
    new_value: Option<&str>,
) -> bool {
    current.read().await.as_deref() == new_value
}

#[cfg(test)]
mod tests {
    use super::{set_config_option_model, set_config_option_thinking_effort};
    use crate::domain::agents::acp::{AcpClient, AcpClientInfo};
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::sync::RwLock;

    fn build_in_memory_client() -> (
        AcpClient,
        tokio::io::DuplexStream,
        BufReader<tokio::io::DuplexStream>,
    ) {
        let (client_reads_stdout, agent_writes_stdout) = duplex(64 * 1024);
        let (agent_reads_stdin, client_writes_stdin) = duplex(64 * 1024);
        let client = AcpClient::spawn_with_streams(
            Box::new(client_writes_stdin),
            client_reads_stdout,
            tokio::io::empty(),
            AcpClientInfo::default(),
        );
        (
            client,
            agent_writes_stdout,
            BufReader::new(agent_reads_stdin),
        )
    }

    async fn read_one_request(reader: &mut BufReader<tokio::io::DuplexStream>) -> Value {
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        serde_json::from_str(line.trim()).unwrap()
    }

    async fn reply_ok(stdout: &mut tokio::io::DuplexStream, id: u64, result: Value) {
        let frame = format!("{}\n", json!({ "id": id, "result": result }));
        stdout.write_all(frame.as_bytes()).await.unwrap();
    }

    async fn reply_error(stdout: &mut tokio::io::DuplexStream, id: u64, code: i64, message: &str) {
        let frame = format!(
            "{}\n",
            json!({ "id": id, "error": { "code": code, "message": message } })
        );
        stdout.write_all(frame.as_bytes()).await.unwrap();
    }

    #[tokio::test]
    async fn set_model_issues_set_config_option_and_updates_state() {
        let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
        let current_model = Arc::new(RwLock::new(Some("old-model".to_string())));
        let supports = Arc::new(AtomicBool::new(true));
        let task = tokio::spawn({
            let client = client.clone();
            let current_model = Arc::clone(&current_model);
            let supports = Arc::clone(&supports);
            async move {
                set_config_option_model(&client, "s-1", &current_model, &supports, "new-model")
                    .await
            }
        });
        let parsed = read_one_request(&mut agent_stdin).await;
        assert_eq!(parsed["method"], "session/set_config_option");
        assert_eq!(parsed["params"]["sessionId"], "s-1");
        assert_eq!(parsed["params"]["configOption"]["name"], "model");
        assert_eq!(parsed["params"]["configOption"]["value"], "new-model");
        let id = parsed["id"].as_u64().unwrap();
        reply_ok(&mut agent_stdout, id, json!({})).await;
        task.await.unwrap().unwrap();
        assert_eq!(
            current_model.read().await.as_deref(),
            Some("new-model"),
            "current_model should update on success"
        );
        assert!(
            supports.load(Ordering::SeqCst),
            "supports flag stays true on success"
        );
    }

    #[tokio::test]
    async fn method_not_found_flips_supports_flag_and_returns_ok() {
        let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
        let current_model = Arc::new(RwLock::new(Some("old-model".to_string())));
        let supports = Arc::new(AtomicBool::new(true));
        let task = tokio::spawn({
            let client = client.clone();
            let current_model = Arc::clone(&current_model);
            let supports = Arc::clone(&supports);
            async move {
                set_config_option_model(&client, "s-1", &current_model, &supports, "new-model")
                    .await
            }
        });
        let parsed = read_one_request(&mut agent_stdin).await;
        let id = parsed["id"].as_u64().unwrap();
        reply_error(&mut agent_stdout, id, -32601, "method not found").await;
        task.await.unwrap().expect("MethodNotFound is not an error");
        assert!(
            !supports.load(Ordering::SeqCst),
            "supports flag should flip to false"
        );
        assert_eq!(
            current_model.read().await.as_deref(),
            Some("new-model"),
            "local state still updates so the legacy fallback can carry it"
        );
    }

    #[tokio::test]
    async fn already_current_short_circuits_without_request() {
        let (client, _agent_stdout, mut agent_stdin) = build_in_memory_client();
        let current_model = Arc::new(RwLock::new(Some("same-model".to_string())));
        let supports = Arc::new(AtomicBool::new(true));
        set_config_option_model(&client, "s-1", &current_model, &supports, "same-model")
            .await
            .unwrap();
        // No request should have been emitted; reading should time out.
        let mut buf = String::new();
        let read_result =
            tokio::time::timeout(Duration::from_millis(50), agent_stdin.read_line(&mut buf)).await;
        assert!(
            read_result.is_err(),
            "no-op set should not emit a request, got: {buf}"
        );
    }

    #[tokio::test]
    async fn supports_false_skips_round_trip_but_still_updates_state() {
        let (client, _agent_stdout, mut agent_stdin) = build_in_memory_client();
        let current_effort = Arc::new(RwLock::new(Some("low".to_string())));
        let supports = Arc::new(AtomicBool::new(false));
        set_config_option_thinking_effort(&client, "s-1", &current_effort, &supports, Some("high"))
            .await
            .unwrap();
        assert_eq!(current_effort.read().await.as_deref(), Some("high"));
        let mut buf = String::new();
        let read_result =
            tokio::time::timeout(Duration::from_millis(50), agent_stdin.read_line(&mut buf)).await;
        assert!(read_result.is_err(), "should not have written a frame");
    }

    #[tokio::test]
    async fn set_thinking_effort_carries_value_under_thinking_effort_name() {
        let (client, mut agent_stdout, mut agent_stdin) = build_in_memory_client();
        let current_effort = Arc::new(RwLock::new(None));
        let supports = Arc::new(AtomicBool::new(true));
        let task = tokio::spawn({
            let client = client.clone();
            let current_effort = Arc::clone(&current_effort);
            let supports = Arc::clone(&supports);
            async move {
                set_config_option_thinking_effort(
                    &client,
                    "s-1",
                    &current_effort,
                    &supports,
                    Some("high"),
                )
                .await
            }
        });
        let parsed = read_one_request(&mut agent_stdin).await;
        assert_eq!(parsed["params"]["configOption"]["name"], "thinkingEffort");
        assert_eq!(parsed["params"]["configOption"]["value"], "high");
        let id = parsed["id"].as_u64().unwrap();
        reply_ok(&mut agent_stdout, id, json!({})).await;
        task.await.unwrap().unwrap();
        assert_eq!(current_effort.read().await.as_deref(), Some("high"));
    }
}
