//! Helpers for assembling the JSON payload of `session/prompt` and for
//! emitting the matching turn-result envelope. Split out of `session.rs`
//! so each module stays under the 400-line ceiling.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, RwLock};

use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeUsage,
};
use crate::domain::agents::opencode::acp::input::acp_prompt_blocks_from_content;

/// Assemble the JSON payload for `session/prompt`. Mirrors the HTTP path's
/// `PromptOptions` flow: model + thinking effort travel with every prompt
/// so `set_model`/`set_thinking_effort` actually take effect mid-session.
pub(super) fn build_prompt_params(
    session_id: &str,
    prompt: Vec<Value>,
    model: Option<&str>,
    effort: Option<&str>,
) -> Value {
    let mut params = json!({ "sessionId": session_id, "prompt": prompt });
    if let Some(model) = model {
        params["model"] = Value::String(model.to_string());
    }
    if let Some(effort) = effort {
        // Use the standard ACP `_meta` extension slot so OpenCode (and any
        // future ACP-only tooling) can read it without special-casing.
        params["_meta"] = json!({ "thinkingEffort": effort });
    }
    params
}

/// Send the very first `session/prompt` for a freshly-spawned ACP session.
///
/// Runs detached from `spawn_acp_session` so the caller can return before the
/// agent finishes its turn. Mirrors `OpenCodeAcpSession::stream_input` but
/// avoids requiring the session struct (which is `!Send` at this point in
/// its construction).
pub(super) async fn drive_initial_prompt(
    client: &AcpClient,
    session_id_lock: &Arc<RwLock<Option<String>>>,
    current_model_lock: &Arc<RwLock<Option<String>>>,
    current_effort_lock: &Arc<RwLock<Option<String>>>,
    content: Value,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> Result<(), RuntimeError> {
    let session_id = session_id_lock
        .read()
        .await
        .clone()
        .ok_or_else(|| RuntimeError::new("ACP session_id missing for initial prompt"))?;
    let prompt = acp_prompt_blocks_from_content(content);
    let model = current_model_lock.read().await.clone();
    let effort = current_effort_lock.read().await.clone();
    let params = build_prompt_params(&session_id, prompt, model.as_deref(), effort.as_deref());
    let response = client
        .request_with_timeout(
            "session/prompt",
            params,
            std::time::Duration::from_secs(60 * 60),
        )
        .await
        .map_err(|e| RuntimeError::new(format!("session/prompt failed: {e}")))?;
    if let Some(reason) = response.get("stopReason").and_then(Value::as_str) {
        emit_turn_result(tx, Some(session_id), None, reason, &response).await;
    }
    Ok(())
}

/// Forward a `RuntimeEventKind::Result` envelope to the message channel
/// when the agent reports a `stopReason`. Mirrors the HTTP path's
/// `events::result_event` so usage-state and turn-completion logic
/// downstream of `RuntimeMessageRx` keep firing on ACP.
pub(super) async fn emit_turn_result(
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    session_id: Option<String>,
    context_window: Option<u64>,
    stop_reason: &str,
    response: &Value,
) {
    let usage = parse_prompt_response_usage(response);
    let raw = json!({
        "type": "result",
        "session_id": session_id.clone(),
        "stop_reason": stop_reason,
        "transport": "acp",
        "usage": response.get("usage").cloned().unwrap_or(Value::Null),
    });
    let metadata = RuntimeEventMetadata {
        session_id,
        usage,
        context_window,
        raw,
    };
    let event = RuntimeEvent::new(metadata, RuntimeEventKind::Result);
    if let Err(error) = tx.send(Ok(event)).await {
        tracing::debug!(%error, "failed to forward ACP turn result; channel closed");
    }
}

/// Pull the per-turn usage carried by the `session/prompt` response.
///
/// Wire shape (observed against `opencode acp` 1.14):
/// `usage: { totalTokens, inputTokens, outputTokens, thoughtTokens }`.
/// We fold `thoughtTokens` into `output_tokens` so reasoning tokens are
/// billed against the assistant turn — matching the HTTP path, which adds
/// `tokens.reasoning` to its output total.
fn parse_prompt_response_usage(response: &Value) -> Option<RuntimeUsage> {
    let usage = response.get("usage")?;
    let input = usage
        .get("inputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("outputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let reasoning = usage
        .get("thoughtTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if input == 0 && output == 0 && reasoning == 0 {
        return None;
    }
    Some(RuntimeUsage {
        input_tokens: input,
        output_tokens: output.saturating_add(reasoning),
    })
}

#[cfg(test)]
mod tests {
    use super::{build_prompt_params, emit_turn_result};
    use serde_json::json;
    use tokio::sync::mpsc;

    #[test]
    fn build_prompt_params_omits_optional_fields_when_unset() {
        let params = build_prompt_params("s-1", vec![json!({ "type": "text" })], None, None);
        assert_eq!(params["sessionId"], "s-1");
        assert!(params["prompt"].is_array());
        assert!(params.get("model").is_none());
        assert!(params.get("_meta").is_none());
    }

    #[test]
    fn build_prompt_params_attaches_model_when_present() {
        let params = build_prompt_params("s-1", vec![], Some("openai/gpt-5.5"), None);
        assert_eq!(params["model"], "openai/gpt-5.5");
    }

    #[test]
    fn build_prompt_params_attaches_thinking_effort_under_meta() {
        let params = build_prompt_params("s-1", vec![], None, Some("high"));
        assert_eq!(params["_meta"]["thinkingEffort"], "high");
        assert!(params.get("model").is_none());
    }

    #[tokio::test]
    async fn emit_turn_result_sends_a_result_event() {
        let (tx, mut rx) = mpsc::channel(4);
        emit_turn_result(
            &tx,
            Some("s-1".into()),
            Some(123_456),
            "end_turn",
            &json!({}),
        )
        .await;
        let event = rx.recv().await.unwrap().unwrap();
        assert!(event.is_result());
        assert_eq!(event.raw_json()["stop_reason"], "end_turn");
        assert_eq!(event.raw_json()["transport"], "acp");
    }

    #[tokio::test]
    async fn emit_turn_result_silently_drops_when_channel_closed() {
        let (tx, rx) = mpsc::channel::<
            Result<
                crate::domain::agents::adapter::RuntimeEvent,
                crate::domain::agents::adapter::RuntimeError,
            >,
        >(1);
        drop(rx);
        // Should not panic; the helper logs at debug and returns.
        emit_turn_result(&tx, None, None, "cancelled", &json!({})).await;
    }

    #[tokio::test]
    async fn emit_turn_result_carries_usage_from_response() {
        let (tx, mut rx) = mpsc::channel(4);
        emit_turn_result(
            &tx,
            Some("s-1".into()),
            Some(200_000),
            "end_turn",
            &json!({
                "usage": {
                    "totalTokens": 10_669,
                    "inputTokens": 10_653,
                    "outputTokens": 3,
                    "thoughtTokens": 13,
                }
            }),
        )
        .await;
        let event = rx.recv().await.unwrap().unwrap();
        let usage = event.usage().expect("usage should be carried on result");
        assert_eq!(usage.input_tokens, 10_653);
        // thoughtTokens fold into output tokens.
        assert_eq!(usage.output_tokens, 16);
    }

    #[test]
    fn parse_prompt_response_usage_returns_none_when_absent() {
        assert!(super::parse_prompt_response_usage(&json!({})).is_none());
    }

    #[test]
    fn parse_prompt_response_usage_skips_all_zero_payloads() {
        let result = super::parse_prompt_response_usage(&json!({
            "usage": { "totalTokens": 0, "inputTokens": 0, "outputTokens": 0, "thoughtTokens": 0 }
        }));
        assert!(result.is_none());
    }
}
