//! ACP `session/update` notification → Cadencr `RuntimeEvent` mapping.
//! Sole place that knows the ACP wire shape of streamed agent output.

use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeUsage,
};
use crate::domain::agents::opencode::acp::events_plan::map_plan;
use crate::domain::agents::opencode::acp::events_stream_blocks::{
    drain_streaming_block_stops, message_start_for, stream_delta_event, stream_start_event,
    stream_stop_event,
};
use crate::domain::agents::opencode::acp::events_tool_call::{
    map_tool_call_start, map_tool_call_update,
};

pub(super) use crate::domain::agents::opencode::acp::events_stream_blocks::EventIndexer;

/// Result of mapping a single `session/update`. Most updates produce 1
/// event; tool calls may produce 2 (result + stop in the same notification).
pub(super) struct MappedUpdate {
    pub events: Vec<RuntimeEvent>,
}

/// Map one `session/update` payload into a sequence of `RuntimeEvent`s.
///
/// The caller (the event loop) is responsible for stamping
/// `parent_tool_use_id` and forwarding to the local channel.
pub(super) fn session_update_to_events(
    params: &Value,
    indexer: &mut EventIndexer,
    active_model: Option<&str>,
    session_id: Option<&str>,
) -> MappedUpdate {
    let kind = params
        .get("update")
        .and_then(|u| u.get("sessionUpdate"))
        .or_else(|| params.get("sessionUpdate"))
        .and_then(Value::as_str)
        .unwrap_or("");

    // Nested under `update` for OpenCode; some adapters embed at top level.
    let body = params
        .get("update")
        .cloned()
        .unwrap_or_else(|| params.clone());

    let metadata = base_metadata(params, session_id);

    match kind {
        "agent_message_chunk" | "agent_thought_chunk" => {
            map_agent_chunk(kind, &body, indexer, active_model, metadata)
        }
        "tool_call" => {
            let mapped = map_tool_call_start(&body, indexer, metadata.clone());
            prepend_streaming_stops(indexer, &metadata, mapped)
        }
        "tool_call_update" => {
            let mapped = map_tool_call_update(&body, indexer, metadata.clone());
            prepend_streaming_stops(indexer, &metadata, mapped)
        }
        "plan" => {
            let mapped = map_plan(&body, indexer, active_model, metadata.clone());
            prepend_streaming_stops(indexer, &metadata, mapped)
        }
        "available_commands_update" | "current_mode_update" => MappedUpdate {
            events: vec![other_event(metadata)],
        },
        "usage_update" => MappedUpdate {
            events: vec![map_usage_update(&body, metadata)],
        },
        other => {
            tracing::debug!(kind = other, "unhandled ACP session/update variant");
            MappedUpdate {
                events: vec![other_event(metadata)],
            }
        }
    }
}

/// Close any open text/thinking block before a tool/plan update so the FE
/// sees a proper Stop boundary and starts a fresh `message_start` for the
/// next text segment.
fn prepend_streaming_stops(
    indexer: &mut EventIndexer,
    metadata: &RuntimeEventMetadata,
    next: MappedUpdate,
) -> MappedUpdate {
    let mut events = drain_streaming_block_stops(indexer, metadata.session_id.as_deref());
    indexer.message_started = false;
    if events.is_empty() {
        return next;
    }
    events.extend(next.events);
    MappedUpdate { events }
}

fn base_metadata(params: &Value, session_id: Option<&str>) -> RuntimeEventMetadata {
    RuntimeEventMetadata {
        session_id: session_id.map(ToOwned::to_owned),
        usage: None,
        context_window: None,
        raw: params.clone(),
    }
}

fn map_agent_chunk(
    kind: &str,
    body: &Value,
    indexer: &mut EventIndexer,
    active_model: Option<&str>,
    metadata: RuntimeEventMetadata,
) -> MappedUpdate {
    let content = body.get("content").cloned().unwrap_or(Value::Null);
    let (text, content_kind) = extract_chunk_text(&content);
    if text.is_empty() {
        return MappedUpdate {
            events: vec![other_event(metadata)],
        };
    }
    let is_thinking = matches!(
        (kind, content_kind),
        ("agent_thought_chunk", _) | (_, ChunkKind::Thinking)
    );
    let session_id = metadata.session_id.as_deref();
    let mut events = Vec::with_capacity(4);

    // Each agent message segment starts with a `message_start` envelope so
    // the FE can allocate a fresh chat bubble. ACP doesn't send one, so we
    // synthesise it on the first chunk after a turn boundary or tool call.
    if !indexer.message_started {
        events.push(message_start_for(session_id, active_model));
        indexer.message_started = true;
    }

    // Switching kind closes the previously-open block so the FE sees a
    // proper Stop boundary before the new Start.
    let stale = if is_thinking {
        indexer.current_text_index.take()
    } else {
        indexer.current_thinking_index.take()
    };
    if let Some(stale_index) = stale {
        events.push(stream_stop_event(stale_index, session_id));
    }

    let (index, is_new) = if is_thinking {
        indexer.open_thinking_block()
    } else {
        indexer.open_text_block()
    };

    if is_new {
        events.push(stream_start_event(index, is_thinking, session_id));
    }
    let delta = if is_thinking {
        RuntimeContentDelta::Thinking { thinking: text }
    } else {
        RuntimeContentDelta::Text { text }
    };
    events.push(stream_delta_event(index, delta, session_id));
    MappedUpdate { events }
}

#[derive(Clone, Copy)]
enum ChunkKind {
    Text,
    Thinking,
}

fn extract_chunk_text(content: &Value) -> (String, ChunkKind) {
    if let Some(text) = content.as_str() {
        return (text.to_string(), ChunkKind::Text);
    }
    let kind = content
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("text");
    let text = content
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let chunk_kind = if kind == "thinking" {
        ChunkKind::Thinking
    } else {
        ChunkKind::Text
    };
    (text, chunk_kind)
}

pub(super) fn other_event(metadata: RuntimeEventMetadata) -> RuntimeEvent {
    RuntimeEvent::new(metadata, RuntimeEventKind::Other)
}

/// Map OpenCode's `usage_update` session update into a `RuntimeEvent` whose
/// metadata carries the live context-budget snapshot.
///
/// Wire shape (observed against `opencode acp` 1.14):
/// `{ "sessionUpdate": "usage_update", "used": <u64>, "size": <u64>,
///    "cost": { "amount": <f64>, "currency": "USD" } }`
///
/// `used` is the running input-token total for the conversation (matches
/// the `inputTokens` reported by the `session/prompt` response). `size` is
/// the context window. Output tokens aren't part of this notification, so
/// we leave that field at 0 — the next `session/prompt` response (or a
/// later `usage_update` after another turn) will carry the latest snapshot.
fn map_usage_update(body: &Value, mut metadata: RuntimeEventMetadata) -> RuntimeEvent {
    let used = body.get("used").and_then(Value::as_u64);
    let size = body.get("size").and_then(Value::as_u64);
    if let Some(input_tokens) = used {
        metadata.usage = Some(RuntimeUsage {
            input_tokens,
            output_tokens: 0,
        });
    }
    if size.is_some() {
        metadata.context_window = size;
    }
    RuntimeEvent::new(metadata, RuntimeEventKind::Other)
}

#[cfg(test)]
mod tests {
    use super::{session_update_to_events, EventIndexer};
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeStreamEvent,
    };
    use serde_json::json;

    fn run_chunk(idx: &mut EventIndexer, kind: &str, text: &str) -> Vec<RuntimeEvent> {
        session_update_to_events(
            &json!({
                "update": { "sessionUpdate": kind, "content": text }
            }),
            idx,
            None,
            None,
        )
        .events
    }

    #[test]
    fn first_text_chunk_emits_message_start_then_block_start_then_delta() {
        let mut idx = EventIndexer::default();
        let events = run_chunk(&mut idx, "agent_message_chunk", "hello");
        // message_start + content_block_start + delta
        assert_eq!(events.len(), 3);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
        assert!(matches!(
            events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::Text { .. },
                ..
            })
        ));
        match events[2].stream_event() {
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: RuntimeContentDelta::Text { text },
                ..
            }) => assert_eq!(text, "hello"),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn consecutive_text_chunks_share_index_and_emit_only_deltas() {
        let mut idx = EventIndexer::default();
        let first = run_chunk(&mut idx, "agent_message_chunk", "P");
        let second = run_chunk(&mut idx, "agent_message_chunk", "ONG");
        // first: message_start + content_block_start + delta
        assert_eq!(first.len(), 3);
        // second: just one Delta on the same index, no extra message_start
        assert_eq!(second.len(), 1);
        let first_idx = match first[1].stream_event() {
            Some(RuntimeStreamEvent::ContentBlockStart { index, .. }) => *index,
            other => panic!("unexpected variant: {other:?}"),
        };
        match second[0].stream_event() {
            Some(RuntimeStreamEvent::ContentBlockDelta { index, .. }) => {
                assert_eq!(*index, first_idx)
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn agent_thought_chunk_emits_message_start_then_thinking_block() {
        let mut idx = EventIndexer::default();
        let result = session_update_to_events(
            &json!({
                "update": {
                    "sessionUpdate": "agent_thought_chunk",
                    "content": { "type": "text", "text": "pondering..." }
                }
            }),
            &mut idx,
            None,
            None,
        );
        assert_eq!(result.events.len(), 3);
        assert!(matches!(
            result.events[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
        assert!(matches!(
            result.events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::Thinking { .. },
                ..
            })
        ));
        match result.events[2].stream_event() {
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: RuntimeContentDelta::Thinking { thinking },
                ..
            }) => assert_eq!(thinking, "pondering..."),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn switching_kind_closes_prior_block_then_starts_new_one() {
        let mut idx = EventIndexer::default();
        let _ = run_chunk(&mut idx, "agent_message_chunk", "thinking out loud");
        let switch = session_update_to_events(
            &json!({
                "update": {
                    "sessionUpdate": "agent_thought_chunk",
                    "content": { "type": "text", "text": "wait" }
                }
            }),
            &mut idx,
            None,
            None,
        )
        .events;
        // Stop(text) + Start(thinking) + Delta(thinking) — no extra
        // message_start because the message segment is still ongoing.
        assert_eq!(switch.len(), 3);
        assert!(matches!(
            switch[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStop { .. })
        ));
        assert!(matches!(
            switch[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::Thinking { .. },
                ..
            })
        ));
    }

    #[test]
    fn tool_call_after_text_flushes_streaming_block_first() {
        let mut idx = EventIndexer::default();
        let _ = run_chunk(&mut idx, "agent_message_chunk", "hi");
        let tool_events = session_update_to_events(
            &json!({
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "t1",
                    "toolName": "Bash",
                    "toolInput": { "command": "ls" }
                }
            }),
            &mut idx,
            None,
            None,
        )
        .events;
        assert!(matches!(
            tool_events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStop { .. })
        ));
        assert!(matches!(
            tool_events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { .. },
                ..
            })
        ));
    }

    #[test]
    fn text_chunk_after_tool_call_re_emits_message_start() {
        let mut idx = EventIndexer::default();
        let _ = run_chunk(&mut idx, "agent_message_chunk", "thinking");
        let _ = session_update_to_events(
            &json!({
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "t1",
                    "toolName": "Bash",
                    "toolInput": { "command": "ls" }
                }
            }),
            &mut idx,
            None,
            None,
        );
        let after = run_chunk(&mut idx, "agent_message_chunk", "back to text");
        // Boundary forces a fresh message_start before the next block.
        assert!(matches!(
            after[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
    }

    #[test]
    fn usage_update_populates_metadata_for_context_budget() {
        let mut idx = EventIndexer::default();
        let result = session_update_to_events(
            &json!({
                "sessionId": "s-1",
                "update": {
                    "sessionUpdate": "usage_update",
                    "used": 10_653,
                    "size": 200_000,
                    "cost": { "amount": 0, "currency": "USD" },
                }
            }),
            &mut idx,
            None,
            Some("s-1"),
        );
        assert_eq!(result.events.len(), 1);
        let event = &result.events[0];
        let usage = event.usage().expect("usage_update must carry a usage");
        assert_eq!(usage.input_tokens, 10_653);
        assert_eq!(usage.output_tokens, 0);
        // Context window flows through metadata so RuntimeUsageState picks it
        // up via update_context_window without provider branching.
        assert_eq!(event.context_window(), Some(200_000));
    }

    #[test]
    fn unknown_variant_falls_back_to_other_without_panicking() {
        let mut idx = EventIndexer::default();
        let result = session_update_to_events(
            &json!({ "update": { "sessionUpdate": "exotic", "anything": 1 } }),
            &mut idx,
            None,
            None,
        );
        assert_eq!(result.events.len(), 1);
        assert!(result.events[0].init().is_none());
    }
}
