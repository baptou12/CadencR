//! Per-turn `Result` envelope emission and `session/prompt` usage parsing.
//! Sibling of [`super::turn_lifecycle`]; split out so neither file exceeds
//! the 400-line ceiling once W4's tests land.

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeUsage,
};

/// Forward a `RuntimeEventKind::Result` envelope to the message channel
/// when the agent reports a `stopReason`.
pub async fn emit_turn_result(
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
/// billed against the assistant turn.
pub(super) fn parse_prompt_response_usage(response: &Value) -> Option<RuntimeUsage> {
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
    use super::{emit_turn_result, parse_prompt_response_usage};
    use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};
    use serde_json::json;
    use tokio::sync::mpsc;

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
        let (tx, rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
        drop(rx);
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
        assert_eq!(usage.output_tokens, 16);
    }

    #[test]
    fn parse_prompt_response_usage_returns_none_when_absent() {
        assert!(parse_prompt_response_usage(&json!({})).is_none());
    }

    #[test]
    fn parse_prompt_response_usage_skips_all_zero_payloads() {
        let result = parse_prompt_response_usage(&json!({
            "usage": { "totalTokens": 0, "inputTokens": 0, "outputTokens": 0, "thoughtTokens": 0 }
        }));
        assert!(result.is_none());
    }
}
