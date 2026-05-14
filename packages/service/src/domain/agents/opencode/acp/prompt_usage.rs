use serde_json::Value;

use crate::domain::agents::adapter::RuntimeUsage;

/// OpenCode's ACP `session/prompt` response usage mirrors its `usage_update`
/// occupancy signal when the separate notification is missing.
pub(super) fn prompt_response_usage(response: &Value) -> Option<RuntimeUsage> {
    let usage = response.get("usage")?;
    let input_tokens = usage.get("inputTokens").and_then(Value::as_u64)?;
    let cached_read_tokens = usage
        .get("cachedReadTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    context_usage(input_tokens, cached_read_tokens)
}

pub(in crate::domain::agents::opencode::acp) fn context_usage(
    input_tokens: u64,
    cached_read_tokens: u64,
) -> Option<RuntimeUsage> {
    let usage = RuntimeUsage {
        input_tokens: input_tokens.saturating_add(cached_read_tokens),
        output_tokens: 0,
    };
    (!usage.is_zero()).then_some(usage)
}

#[cfg(test)]
mod tests {
    use super::prompt_response_usage;
    use serde_json::json;

    #[test]
    fn prompt_response_usage_uses_input_plus_cached_read() {
        let parsed = prompt_response_usage(&json!({
            "usage": {
                "inputTokens": 10_000,
                "outputTokens": 250,
                "cachedReadTokens": 2_500,
                "cachedWriteTokens": 100,
            }
        }))
        .expect("usage parses");
        assert_eq!(parsed.input_tokens, 12_500);
        assert_eq!(parsed.output_tokens, 0);
    }

    #[test]
    fn prompt_response_usage_ignores_missing_or_zero_input() {
        assert!(prompt_response_usage(&json!({})).is_none());
        assert!(prompt_response_usage(&json!({ "usage": { "inputTokens": 0 } })).is_none());
    }
}
