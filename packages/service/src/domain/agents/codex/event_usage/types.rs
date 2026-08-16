use std::collections::{HashMap, HashSet, VecDeque};

use serde_json::Value;

use crate::domain::agents::adapter::RuntimeTokenUsageEntry;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TokenBreakdown {
    pub(super) input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    pub(super) output_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
}

impl TokenBreakdown {
    pub(super) fn parse(value: &Value) -> Option<Self> {
        let input_tokens = value.get("inputTokens")?.as_u64()?;
        let output_tokens = value.get("outputTokens")?.as_u64()?;
        Some(Self {
            input_tokens,
            cached_input_tokens: value
                .get("cachedInputTokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cache_write_input_tokens: value
                .get("cacheWriteInputTokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output_tokens,
            reasoning_output_tokens: value
                .get("reasoningOutputTokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            total_tokens: value
                .get("totalTokens")
                .and_then(Value::as_u64)
                .unwrap_or_else(|| input_tokens.saturating_add(output_tokens)),
        })
    }

    pub(super) fn entry(&self) -> RuntimeTokenUsageEntry {
        RuntimeTokenUsageEntry {
            model_id: None,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
        }
    }

    pub(super) fn replay_id(&self, turn_id: &str) -> String {
        format!(
            "codex-turn-usage:{turn_id}:{}:{}:{}:{}:{}:{}",
            self.input_tokens,
            self.cached_input_tokens,
            self.cache_write_input_tokens,
            self.output_tokens,
            self.reasoning_output_tokens,
            self.total_tokens,
        )
    }
}

#[derive(Debug, Clone)]
pub(super) struct PendingRawUsage {
    pub(super) response_id: String,
    pub(super) usage: TokenBreakdown,
}

#[derive(Default)]
struct PendingTurnUsage {
    turn_id: String,
    response_ids: HashSet<String>,
    responses: VecDeque<PendingRawUsage>,
}

#[derive(Default)]
pub(in crate::domain::agents::codex) struct PendingUsageBuffer {
    by_thread: HashMap<String, PendingTurnUsage>,
}

impl PendingUsageBuffer {
    pub(super) fn push(&mut self, thread_id: &str, turn_id: &str, response: PendingRawUsage) {
        let pending = self
            .by_thread
            .entry(thread_id.to_string())
            .or_insert_with(|| PendingTurnUsage {
                turn_id: turn_id.to_string(),
                ..PendingTurnUsage::default()
            });
        if pending.turn_id != turn_id {
            *pending = PendingTurnUsage {
                turn_id: turn_id.to_string(),
                ..PendingTurnUsage::default()
            };
        }
        if pending.response_ids.insert(response.response_id.clone()) {
            pending.responses.push_back(response);
        }
    }

    pub(super) fn pop_response(
        &mut self,
        thread_id: &str,
        turn_id: &str,
    ) -> Option<PendingRawUsage> {
        let pending = self.by_thread.get_mut(thread_id)?;
        if pending.turn_id != turn_id {
            self.by_thread.remove(thread_id);
            return None;
        }
        pending.responses.pop_front()
    }

    pub(super) fn take_turn(
        &mut self,
        thread_id: &str,
        turn_id: &str,
    ) -> VecDeque<PendingRawUsage> {
        self.by_thread
            .remove(thread_id)
            .filter(|pending| pending.turn_id == turn_id)
            .map(|pending| pending.responses)
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(super) fn is_empty(&self) -> bool {
        self.by_thread
            .values()
            .all(|pending| pending.responses.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::{PendingRawUsage, PendingUsageBuffer, TokenBreakdown};
    use serde_json::json;

    fn response(id: &str, input_tokens: u64) -> PendingRawUsage {
        PendingRawUsage {
            response_id: id.to_string(),
            usage: TokenBreakdown::parse(&json!({
                "inputTokens": input_tokens,
                "outputTokens": 1
            }))
            .unwrap(),
        }
    }

    #[test]
    fn pending_usage_is_fifo_and_deduplicated_per_turn() {
        let mut pending = PendingUsageBuffer::default();
        pending.push("thread", "turn", response("first", 10));
        pending.push("thread", "turn", response("first", 10));
        pending.push("thread", "turn", response("second", 20));

        assert_eq!(
            pending.pop_response("thread", "turn").unwrap().response_id,
            "first"
        );
        assert_eq!(
            pending.pop_response("thread", "turn").unwrap().response_id,
            "second"
        );
        assert!(pending.pop_response("thread", "turn").is_none());
    }

    #[test]
    fn a_new_turn_replaces_stale_usage_for_the_same_thread() {
        let mut pending = PendingUsageBuffer::default();
        pending.push("thread", "stale", response("stale", 10));
        pending.push("thread", "current", response("current", 20));

        assert_eq!(
            pending
                .pop_response("thread", "current")
                .unwrap()
                .response_id,
            "current"
        );
        assert!(pending.take_turn("thread", "stale").is_empty());
    }
}
