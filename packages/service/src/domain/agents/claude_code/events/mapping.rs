use serde_json::Value;
use tracing::warn;

use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeContentDelta, RuntimeStreamEvent, RuntimeUserContentBlock,
    RuntimeUserMessage,
};

/// Every `(model id, context window)` the CLI reported on a `result` payload.
/// Empty for any other event — only `result` carries `modelUsage`.
pub(in crate::domain::agents::claude_code) fn model_usage_windows(
    raw: &Value,
) -> impl Iterator<Item = (&str, u64)> {
    raw.get("modelUsage")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(model, entry)| {
            let window = entry.get("contextWindow").and_then(Value::as_u64)?;
            (window > 0).then_some((model.as_str(), window))
        })
}

pub(in crate::domain::agents::claude_code) fn context_window_for_model_from_raw(
    raw: &Value,
    model: &str,
) -> Option<u64> {
    let mut windows = model_usage_windows(raw).peekable();
    windows.peek()?;

    let mut only: Option<u64> = None;
    let mut single = true;
    for (entry_model, window) in windows {
        if entry_model == model {
            return Some(window);
        }
        single &= only.is_none();
        only = Some(window);
    }

    // No exact hit: a lone entry is unambiguous (the turn ran one model, and
    // the caller's id is an alias for it). Two or more and we cannot tell.
    single.then_some(only).flatten()
}

/// Model families whose context window is 1,000,000 tokens *natively* — the
/// maximum is also the default, so there is no 1M beta to opt into and the CLI
/// never affixes the `[1m]` marker. Verified against the CLI: passing
/// `--model claude-fable-5[1m]` makes it report `claude-fable-5` back on init,
/// and its `result.modelUsage` entry reads `"contextWindow": 1000000`.
const NATIVE_1M_MODEL_FAMILIES: &[&str] = &["claude-fable-5"];

/// Early context-window hint from the init message's *resolved* model id, used
/// to scale the live usage bar before the turn's authoritative
/// `Result.modelUsage.contextWindow` arrives (init carries no window field).
///
/// Recognizes the `[1m]` marker (the 1M-context beta) and the families in
/// [`NATIVE_1M_MODEL_FAMILIES`], both 1,000,000 tokens on every backend.
/// Anything else returns `None` and defers to the CLI: we never guess a size
/// that could be wrong for a custom/proxy/Bedrock-pinned model.
///
/// `contains` for the marker because Bedrock/Vertex ids affix region/routing
/// (`us.anthropic.…-sonnet-4-5[1m]`). Family matching strips those same affixes
/// but then demands a whole-id match, so a hypothetical `claude-fable-5-mini`
/// is not silently claimed to be 1M.
pub(in crate::domain::agents::claude_code) fn init_model_context_window(
    model: &str,
) -> Option<u64> {
    let bare = model.rsplit(['/', ':']).next().unwrap_or(model);
    let bare = bare.strip_suffix("[1m]").unwrap_or(bare);
    let native_1m = NATIVE_1M_MODEL_FAMILIES
        .iter()
        .any(|family| bare == *family || bare.ends_with(&format!(".{family}")));
    (model.contains("[1m]") || native_1m).then_some(1_000_000)
}

/// Human-readable text for an API-error assistant message: the joined text
/// blocks (e.g. "API Error: 529 Overloaded…"). Falls back to the synthetic
/// `error` category string, then a generic message, when the CLI sent no text.
pub(super) fn api_error_text(
    content: &[claude_agent_sdk_rs::types::ContentBlock],
    error: Option<&str>,
) -> String {
    let text = content
        .iter()
        .filter_map(|block| match block {
            claude_agent_sdk_rs::types::ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        error
            .unwrap_or("The agent reported an API error.")
            .to_string()
    } else {
        text
    }
}

/// The `type` tag of a raw wire payload, for drop-trace logging.
pub(super) fn raw_type(raw: &Value) -> &str {
    raw.get("type")
        .and_then(Value::as_str)
        .unwrap_or("<missing>")
}

pub(super) fn map_content_block(
    block: &claude_agent_sdk_rs::types::ContentBlock,
) -> RuntimeContentBlock {
    match block {
        claude_agent_sdk_rs::types::ContentBlock::Text { text } => {
            RuntimeContentBlock::Text { text: text.clone() }
        }
        claude_agent_sdk_rs::types::ContentBlock::Thinking { thinking, .. } => {
            RuntimeContentBlock::Thinking {
                thinking: thinking.clone(),
            }
        }
        claude_agent_sdk_rs::types::ContentBlock::ToolUse { id, name, input } => {
            RuntimeContentBlock::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            }
        }
        // Modeled but intentionally not rendered as assistant content.
        claude_agent_sdk_rs::types::ContentBlock::ToolResult { .. } => RuntimeContentBlock::Other,
        // A block type the SDK doesn't model. Its content can't render, but it
        // must never vanish without a trace (the "stopped mid-message with no
        // reason" class) — log exactly what the CLI sent.
        claude_agent_sdk_rs::types::ContentBlock::Other(raw) => {
            warn!(
                block_type = raw_type(raw),
                "claude adapter: unmodeled content block dropped from rendering"
            );
            RuntimeContentBlock::Other
        }
    }
}

pub(super) fn map_stream_event(event: &claude_agent_sdk_rs::StreamEventData) -> RuntimeStreamEvent {
    match event {
        claude_agent_sdk_rs::StreamEventData::MessageStart { message } => {
            RuntimeStreamEvent::MessageStart {
                model: Some(message.model.clone()),
                input_tokens: message
                    .usage
                    .as_ref()
                    .map(|usage| usage.total_input_tokens()),
            }
        }
        claude_agent_sdk_rs::StreamEventData::ContentBlockStart {
            index,
            content_block,
        } => RuntimeStreamEvent::ContentBlockStart {
            index: u64::from(*index),
            block: map_content_block(content_block),
        },
        claude_agent_sdk_rs::StreamEventData::ContentBlockDelta { index, delta } => {
            match delta {
                claude_agent_sdk_rs::types::ContentDelta::TextDelta { text } => {
                    RuntimeStreamEvent::ContentBlockDelta {
                        index: u64::from(*index),
                        delta: RuntimeContentDelta::Text { text: text.clone() },
                    }
                }
                claude_agent_sdk_rs::types::ContentDelta::ThinkingDelta { thinking } => {
                    RuntimeStreamEvent::ContentBlockDelta {
                        index: u64::from(*index),
                        delta: RuntimeContentDelta::Thinking {
                            thinking: thinking.clone(),
                        },
                    }
                }
                claude_agent_sdk_rs::types::ContentDelta::InputJsonDelta { partial_json } => {
                    RuntimeStreamEvent::ContentBlockDelta {
                        index: u64::from(*index),
                        delta: RuntimeContentDelta::InputJson {
                            partial_json: partial_json.clone(),
                        },
                    }
                }
                // An unknown delta type carries nothing we can render; treat the
                // whole event as `Other` rather than fabricating a delta — but
                // log it: a CLI that starts streaming a new delta type would
                // otherwise look like text that just stops mid-message.
                claude_agent_sdk_rs::types::ContentDelta::Other(raw) => {
                    warn!(
                        delta_type = raw_type(raw),
                        index,
                        "claude adapter: unmodeled content delta dropped from the live stream"
                    );
                    RuntimeStreamEvent::Other
                }
            }
        }
        claude_agent_sdk_rs::StreamEventData::ContentBlockStop { index } => {
            RuntimeStreamEvent::ContentBlockStop {
                index: u64::from(*index),
            }
        }
        // Modeled and intentionally unmapped: turn accounting comes from the
        // `Result` message, not these envelope markers.
        claude_agent_sdk_rs::StreamEventData::MessageDelta { .. }
        | claude_agent_sdk_rs::StreamEventData::MessageStop => RuntimeStreamEvent::Other,
        // A stream event type the SDK doesn't model — log what was dropped.
        claude_agent_sdk_rs::StreamEventData::Other(raw) => {
            warn!(
                event_type = raw_type(raw),
                "claude adapter: unmodeled stream event dropped"
            );
            RuntimeStreamEvent::Other
        }
    }
}

pub(super) fn map_user_message(message: &Value) -> RuntimeUserMessage {
    let content = message
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    if item.get("type").and_then(Value::as_str) == Some("tool_result") {
                        RuntimeUserContentBlock::ToolResult {
                            tool_use_id: item
                                .get("tool_use_id")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned),
                            is_error: item
                                .get("is_error")
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                            content: item.get("content").cloned().unwrap_or(Value::Null),
                        }
                    } else {
                        RuntimeUserContentBlock::Other
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    RuntimeUserMessage { content }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{context_window_for_model_from_raw, init_model_context_window};

    #[test]
    fn init_model_context_window_resolves_1m_beta_marker() {
        assert_eq!(
            init_model_context_window("claude-opus-5[1m]"),
            Some(1_000_000)
        );
        assert_eq!(
            init_model_context_window("us.anthropic.claude-sonnet-5[1m]"),
            Some(1_000_000)
        );
    }

    #[test]
    fn init_model_context_window_resolves_natively_1m_families_without_marker() {
        // The CLI strips `[1m]` for Fable because 1M is its default, so the
        // marker check alone left the whole turn without a window.
        assert_eq!(init_model_context_window("claude-fable-5"), Some(1_000_000));
        assert_eq!(
            init_model_context_window("us.anthropic.claude-fable-5"),
            Some(1_000_000)
        );
    }

    #[test]
    fn init_model_context_window_defers_for_unmarked_models() {
        assert_eq!(init_model_context_window("claude-opus-5"), None);
        assert_eq!(init_model_context_window("claude-haiku-4-5"), None);
        assert_eq!(init_model_context_window("my-proxy/custom-model"), None);
    }

    #[test]
    fn init_model_context_window_does_not_claim_1m_for_family_lookalikes() {
        // A narrower sibling or a proxy's own variant is not the family.
        assert_eq!(init_model_context_window("claude-fable-5-mini"), None);
        assert_eq!(
            init_model_context_window("myproxy/claude-fable-5-cheap"),
            None
        );
    }

    #[test]
    pub(in crate::domain::agents::claude_code) fn context_window_for_model_from_raw_uses_single_entry_for_default_alias(
    ) {
        let raw = json!({
            "type": "result",
            "modelUsage": {
                "claude-opus-4-7[1m]": { "contextWindow": 1_000_000 }
            }
        });

        assert_eq!(
            context_window_for_model_from_raw(&raw, "default"),
            Some(1_000_000)
        );
    }
}
