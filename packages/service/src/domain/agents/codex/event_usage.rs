use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeTokenUsage,
};
use crate::domain::agents::codex::event_state::IndexState;

mod context;
mod types;

pub(super) use self::types::PendingUsageBuffer;
use self::types::{PendingRawUsage, TokenBreakdown};

pub(super) fn usage_events(params: Value, index_state: &mut IndexState) -> Vec<RuntimeEvent> {
    let context_event = context::event(&params);
    let accounting_event = token_usage_accounting_event(&params, index_state);
    std::iter::once(context_event)
        .chain(accounting_event)
        .collect()
}

/// Buffer Codex's exact upstream response usage until the matching cumulative
/// snapshot supplies a replay-stable identity. Resumed threads do not emit
/// `rawResponse/completed`, so the snapshot path also has an exact-`last`
/// fallback.
pub(super) fn capture_raw_response_usage(params: &Value, index_state: &mut IndexState) {
    let Some(response_id) = params.get("responseId").and_then(Value::as_str) else {
        return;
    };
    let Some(turn_id) = params.get("turnId").and_then(Value::as_str) else {
        return;
    };
    let Some(usage) = params.get("usage").and_then(TokenBreakdown::parse) else {
        return;
    };
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("codex");
    index_state.pending_raw_usage.push(
        thread_id,
        turn_id,
        PendingRawUsage {
            response_id: response_id.to_string(),
            usage,
        },
    );
}

fn token_usage_accounting_event(
    params: &Value,
    index_state: &mut IndexState,
) -> Option<RuntimeEvent> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("codex");
    let turn_id = params.get("turnId").and_then(Value::as_str)?;
    let token_usage = params.get("tokenUsage")?;
    let last = TokenBreakdown::parse(token_usage.get("last")?)?;
    let total = TokenBreakdown::parse(token_usage.get("total")?)?;
    let replay_id = total.replay_id(turn_id);
    let pending = index_state
        .pending_raw_usage
        .pop_response(thread_id, turn_id);
    let usage = match pending {
        Some(pending) => RuntimeTokenUsage::correlated_response_delta(
            format!("codex-response:{}", pending.response_id),
            replay_id,
            vec![pending.usage.entry()],
        ),
        None => RuntimeTokenUsage::response_delta(replay_id, vec![last.entry()]),
    };
    Some(accounting_event(thread_id, turn_id, usage))
}

pub(super) fn flush_raw_response_usage_events(
    params: &Value,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("codex");
    let turn_id = params
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    index_state
        .pending_raw_usage
        .take_turn(thread_id, turn_id)
        .into_iter()
        .map(|pending| {
            let usage = RuntimeTokenUsage::response_delta(
                format!("codex-response:{}", pending.response_id),
                vec![pending.usage.entry()],
            );
            accounting_event(thread_id, turn_id, usage)
        })
        .collect()
}

fn accounting_event(thread_id: &str, turn_id: &str, usage: RuntimeTokenUsage) -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(thread_id.to_string()),
            usage: None,
            context_window: None,
            raw: serde_json::json!({
                "type": "usage_accounting",
                "session_id": thread_id,
                "turn_id": turn_id,
            }),
        },
        RuntimeEventKind::UsageAccounting,
    )
    .with_token_usage(Some(usage))
}

#[cfg(test)]
mod tests {
    use super::{capture_raw_response_usage, flush_raw_response_usage_events, usage_events};
    use crate::domain::agents::adapter::RuntimeTokenUsage;
    use crate::domain::agents::codex::event_state::IndexState;
    use serde_json::json;

    #[test]
    fn raw_response_and_normalized_snapshot_become_one_correlated_event() {
        let mut state = IndexState::default();
        capture_raw_response_usage(
            &json!({
                "threadId": "thread",
                "turnId": "turn",
                "responseId": "resp_123",
                "usage": {
                    "inputTokens": 12_345,
                    "cachedInputTokens": 10_000,
                    "outputTokens": 678,
                    "reasoningOutputTokens": 456,
                    "totalTokens": 13_023
                }
            }),
            &mut state,
        );
        let events = usage_events(
            json!({
                "threadId": "thread",
                "turnId": "turn",
                "tokenUsage": {
                    "last": {
                        "inputTokens": 12_346, "cachedInputTokens": 0,
                        "outputTokens": 678, "reasoningOutputTokens": 456,
                        "totalTokens": 13_023
                    },
                    "total": {
                        "inputTokens": 12_345, "cachedInputTokens": 10_000,
                        "outputTokens": 678, "reasoningOutputTokens": 456,
                        "totalTokens": 13_023
                    },
                    "modelContextWindow": 258_400
                }
            }),
            &mut state,
        );
        let accounting = events[1].token_usage().expect("response accounting");
        let RuntimeTokenUsage::Delta {
            event_id,
            correlation_id,
            entries,
            ..
        } = accounting
        else {
            panic!("expected exact response delta");
        };
        assert_eq!(event_id.as_deref(), Some("codex-response:resp_123"));
        assert!(correlation_id
            .as_deref()
            .is_some_and(|id| id.starts_with("codex-turn-usage:turn:")));
        assert_eq!(
            (entries[0].input_tokens, entries[0].output_tokens),
            (12_345, 678)
        );
        assert!(state.pending_raw_usage.is_empty());
    }

    #[test]
    fn resumed_thread_accounts_from_token_snapshot_without_raw_events() {
        let events = usage_events(
            json!({
                "threadId": "thread", "turnId": "turn-resumed",
                "tokenUsage": {
                    "last": { "inputTokens": 25_057, "outputTokens": 818, "totalTokens": 25_875 },
                    "total": { "inputTokens": 97_242, "outputTokens": 3_648, "totalTokens": 100_890 }
                }
            }),
            &mut IndexState::default(),
        );
        let RuntimeTokenUsage::Delta {
            event_id, entries, ..
        } = events[1].token_usage().expect("fallback accounting")
        else {
            panic!("expected response delta");
        };
        assert!(event_id
            .as_deref()
            .is_some_and(|id| id.starts_with("codex-turn-usage:turn-resumed:")));
        assert_eq!(
            (entries[0].input_tokens, entries[0].output_tokens),
            (25_057, 818)
        );
    }

    #[test]
    fn turn_completion_flushes_raw_usage_when_token_snapshot_is_missing() {
        let mut state = IndexState::default();
        capture_raw_response_usage(
            &json!({
                "threadId": "thread",
                "turnId": "turn",
                "responseId": "resp_123",
                "usage": { "inputTokens": 10, "outputTokens": 2 }
            }),
            &mut state,
        );
        let events = flush_raw_response_usage_events(
            &json!({ "threadId": "thread", "turn": { "id": "turn" } }),
            &mut state,
        );
        assert_eq!(events.len(), 1);
        assert!(state.pending_raw_usage.is_empty());
    }

    #[test]
    fn omitted_upstream_usage_is_not_buffered() {
        let mut state = IndexState::default();
        capture_raw_response_usage(
            &json!({
                "threadId": "thread", "turnId": "turn", "responseId": "resp_123", "usage": null
            }),
            &mut state,
        );
        assert!(state.pending_raw_usage.is_empty());
    }

    #[test]
    fn multiple_responses_in_one_turn_are_correlated_in_order() {
        let mut state = IndexState::default();
        for (response_id, input_tokens) in [("first", 10), ("second", 20)] {
            capture_raw_response_usage(
                &json!({
                    "threadId": "thread", "turnId": "turn", "responseId": response_id,
                    "usage": { "inputTokens": input_tokens, "outputTokens": 1 }
                }),
                &mut state,
            );
        }

        for (expected_id, last, total) in [("first", 10, 11), ("second", 20, 32)] {
            let events = usage_events(
                json!({
                    "threadId": "thread", "turnId": "turn",
                    "tokenUsage": {
                        "last": { "inputTokens": last, "outputTokens": 1 },
                        "total": { "inputTokens": total, "outputTokens": 2 }
                    }
                }),
                &mut state,
            );
            let RuntimeTokenUsage::Delta { event_id, .. } =
                events[1].token_usage().expect("accounting event")
            else {
                panic!("expected exact response delta");
            };
            let expected_event_id = format!("codex-response:{expected_id}");
            assert_eq!(event_id.as_deref(), Some(expected_event_id.as_str()));
        }
        assert!(state.pending_raw_usage.is_empty());
    }

    #[test]
    fn later_turn_discards_unmatched_usage_from_the_same_thread() {
        let mut state = IndexState::default();
        capture_raw_response_usage(
            &json!({
                "threadId": "thread", "turnId": "stale", "responseId": "stale-response",
                "usage": { "inputTokens": 10, "outputTokens": 1 }
            }),
            &mut state,
        );
        let events = usage_events(
            json!({
                "threadId": "thread", "turnId": "current",
                "tokenUsage": {
                    "last": { "inputTokens": 20, "outputTokens": 2 },
                    "total": { "inputTokens": 30, "outputTokens": 3 }
                }
            }),
            &mut state,
        );

        let RuntimeTokenUsage::Delta { event_id, .. } =
            events[1].token_usage().expect("fallback accounting")
        else {
            panic!("expected response delta");
        };
        assert!(event_id
            .as_deref()
            .is_some_and(|id| id.starts_with("codex-turn-usage:current:")));
        assert!(state.pending_raw_usage.is_empty());
    }
}
