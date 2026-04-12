use std::collections::{BTreeSet, HashMap};

use crate::domain::agents::adapter::{RuntimeContentDelta, RuntimeEvent};

use super::events::{stream_delta_event, stream_start_event, stream_stop_event};

pub struct StreamSynthesizer {
    next_index: u32,
    part_index: HashMap<String, u32>,
    part_text: HashMap<String, String>,
    part_blocks: HashMap<String, PartBlock>,
    open_indices: BTreeSet<u32>,
    current_model: Option<String>,
}

#[derive(Clone)]
enum PartBlock {
    Text,
    Thinking,
    ToolUse { id: String, name: String },
}

impl StreamSynthesizer {
    pub fn new(model: Option<String>) -> Self {
        Self {
            next_index: 0,
            part_index: HashMap::new(),
            part_text: HashMap::new(),
            part_blocks: HashMap::new(),
            open_indices: BTreeSet::new(),
            current_model: model,
        }
    }

    pub fn current_model(&self) -> Option<String> {
        self.current_model.clone()
    }

    pub fn reset_for_turn(&mut self, model: Option<String>) {
        self.next_index = 0;
        self.part_index.clear();
        self.part_text.clear();
        self.part_blocks.clear();
        self.open_indices.clear();
        self.current_model = model;
    }

    pub fn assign_index(&mut self, part_id: &str) -> u32 {
        if let Some(index) = self.part_index.get(part_id) {
            return *index;
        }
        let index = self.next_index;
        self.next_index += 1;
        self.part_index.insert(part_id.to_string(), index);
        index
    }

    pub fn ensure_index(&mut self, part_id: &str) -> (u32, bool) {
        if let Some(index) = self.part_index.get(part_id) {
            return (*index, false);
        }
        (self.assign_index(part_id), true)
    }

    pub fn mark_open(&mut self, index: u32) {
        self.open_indices.insert(index);
    }

    pub fn compute_delta(&mut self, part_id: &str, text: &str) -> String {
        let previous = self.part_text.get(part_id).cloned().unwrap_or_default();
        let delta = if text.starts_with(&previous) {
            text[previous.len()..].to_string()
        } else {
            text.to_string()
        };
        self.part_text.insert(part_id.to_string(), text.to_string());
        delta
    }

    pub fn stop_events(&mut self, session_id: &str) -> Vec<RuntimeEvent> {
        let indices: Vec<u32> = self.open_indices.iter().copied().collect();
        self.open_indices.clear();
        indices
            .into_iter()
            .map(|index| stream_stop_event(session_id, index))
            .collect()
    }

    pub fn ingest_part(
        &mut self,
        session_id: &str,
        part: &opencode_sdk_rs::MessagePart,
    ) -> Vec<RuntimeEvent> {
        let part_id = match part {
            opencode_sdk_rs::MessagePart::Text { id, .. }
            | opencode_sdk_rs::MessagePart::Thinking { id, .. }
            | opencode_sdk_rs::MessagePart::ToolUse { id, .. }
            | opencode_sdk_rs::MessagePart::ToolResult { id, .. } => id.as_str(),
            opencode_sdk_rs::MessagePart::Other(_) => return Vec::new(),
        };
        if part_id.is_empty() {
            return Vec::new();
        }

        let (index, is_new) = self.ensure_index(part_id);
        let mut output = Vec::new();

        if is_new {
            self.part_blocks
                .insert(part_id.to_string(), part_block_from_message_part(part));
            self.mark_open(index);
            output.push(stream_start_event(
                session_id,
                index,
                empty_runtime_block_for_part(part),
            ));
        }

        let Some(delta) = self.part_delta(part_id, part) else {
            return output;
        };
        if delta_is_empty(&delta) {
            return output;
        }

        if !is_new {
            self.mark_open(index);
        }
        output.push(stream_delta_event(session_id, index, delta));
        output
    }

    pub fn ingest_delta(
        &mut self,
        session_id: &str,
        part_id: &str,
        field: &str,
        delta: &str,
    ) -> Vec<RuntimeEvent> {
        let part_block = self
            .part_blocks
            .get(part_id)
            .cloned()
            .or_else(|| infer_part_block(field, part_id));
        let Some(delta_kind) = delta_from_field(field, delta, part_block.as_ref()) else {
            return Vec::new();
        };
        let (index, is_new) = self.ensure_index(part_id);
        let mut output = Vec::new();

        if is_new {
            let Some(part_block) = part_block else {
                return Vec::new();
            };
            self.part_blocks
                .insert(part_id.to_string(), part_block.clone());
            self.mark_open(index);
            output.push(stream_start_event(
                session_id,
                index,
                runtime_block_from_part_block(&part_block),
            ));
        }

        self.record_delta(part_id, &delta_kind);
        if !is_new {
            self.mark_open(index);
        }
        output.push(stream_delta_event(session_id, index, delta_kind));
        output
    }

    fn part_delta(
        &mut self,
        part_id: &str,
        part: &opencode_sdk_rs::MessagePart,
    ) -> Option<RuntimeContentDelta> {
        match part {
            opencode_sdk_rs::MessagePart::Text { text, .. } => {
                let delta = self.compute_delta(part_id, text);
                Some(RuntimeContentDelta::Text { text: delta })
            }
            opencode_sdk_rs::MessagePart::Thinking { thinking, .. } => {
                let delta = self.compute_delta(part_id, thinking);
                Some(RuntimeContentDelta::Thinking { thinking: delta })
            }
            opencode_sdk_rs::MessagePart::ToolUse { input, .. } => {
                let as_json = serde_json::to_string(input).unwrap_or_default();
                let delta = self.compute_delta(part_id, &as_json);
                Some(RuntimeContentDelta::InputJson {
                    partial_json: delta,
                })
            }
            _ => None,
        }
    }

    fn record_delta(&mut self, part_id: &str, delta: &RuntimeContentDelta) {
        let previous = self.part_text.get(part_id).cloned().unwrap_or_default();
        let next = match delta {
            RuntimeContentDelta::Text { text } => format!("{previous}{text}"),
            RuntimeContentDelta::Thinking { thinking } => format!("{previous}{thinking}"),
            RuntimeContentDelta::InputJson { partial_json } => format!("{previous}{partial_json}"),
        };
        self.part_text.insert(part_id.to_string(), next);
    }
}

fn part_block_from_message_part(part: &opencode_sdk_rs::MessagePart) -> PartBlock {
    match part {
        opencode_sdk_rs::MessagePart::Text { .. } => PartBlock::Text,
        opencode_sdk_rs::MessagePart::Thinking { .. } => PartBlock::Thinking,
        opencode_sdk_rs::MessagePart::ToolUse { id, name, .. } => PartBlock::ToolUse {
            id: id.clone(),
            name: name.clone(),
        },
        _ => PartBlock::Text,
    }
}

fn runtime_block_from_part_block(
    part_block: &PartBlock,
) -> crate::domain::agents::adapter::RuntimeContentBlock {
    match part_block {
        PartBlock::Text => crate::domain::agents::adapter::RuntimeContentBlock::Text {
            text: String::new(),
        },
        PartBlock::Thinking => crate::domain::agents::adapter::RuntimeContentBlock::Thinking {
            thinking: String::new(),
        },
        PartBlock::ToolUse { id, name } => {
            crate::domain::agents::adapter::RuntimeContentBlock::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: serde_json::json!({}),
            }
        }
    }
}

fn empty_runtime_block_for_part(
    part: &opencode_sdk_rs::MessagePart,
) -> crate::domain::agents::adapter::RuntimeContentBlock {
    runtime_block_from_part_block(&part_block_from_message_part(part))
}

fn infer_part_block(field: &str, part_id: &str) -> Option<PartBlock> {
    if matches_text_field(field) {
        return Some(PartBlock::Text);
    }
    if matches_thinking_field(field) {
        return Some(PartBlock::Thinking);
    }
    if matches_input_field(field) {
        return Some(PartBlock::ToolUse {
            id: part_id.to_string(),
            name: "unknown".to_string(),
        });
    }
    None
}

fn delta_from_field(
    field: &str,
    delta: &str,
    part_block: Option<&PartBlock>,
) -> Option<RuntimeContentDelta> {
    match part_block {
        Some(PartBlock::Thinking) => {
            return Some(RuntimeContentDelta::Thinking {
                thinking: delta.to_string(),
            });
        }
        Some(PartBlock::ToolUse { .. }) if matches_input_field(field) => {
            return Some(RuntimeContentDelta::InputJson {
                partial_json: delta.to_string(),
            });
        }
        Some(PartBlock::Text) if matches_text_field(field) => {
            return Some(RuntimeContentDelta::Text {
                text: delta.to_string(),
            });
        }
        _ => {}
    }
    if matches_text_field(field) {
        return Some(RuntimeContentDelta::Text {
            text: delta.to_string(),
        });
    }
    if matches_thinking_field(field) {
        return Some(RuntimeContentDelta::Thinking {
            thinking: delta.to_string(),
        });
    }
    if matches_input_field(field) {
        return Some(RuntimeContentDelta::InputJson {
            partial_json: delta.to_string(),
        });
    }
    None
}

fn matches_text_field(field: &str) -> bool {
    matches!(field, "text" | "content")
}

fn matches_thinking_field(field: &str) -> bool {
    field.starts_with("reasoning")
}

fn matches_input_field(field: &str) -> bool {
    field.contains("input")
}

fn delta_is_empty(delta: &RuntimeContentDelta) -> bool {
    match delta {
        RuntimeContentDelta::Text { text } => text.is_empty(),
        RuntimeContentDelta::Thinking { thinking } => thinking.is_empty(),
        RuntimeContentDelta::InputJson { partial_json } => partial_json.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::StreamSynthesizer;
    use crate::domain::agents::adapter::RuntimeStreamEvent;
    use serde_json::json;

    #[test]
    fn synthesizer_delta_handles_cumulative_updates() {
        let mut synth = StreamSynthesizer::new(None);
        let first = synth.compute_delta("part-1", "hello");
        let second = synth.compute_delta("part-1", "hello world");
        assert_eq!(first, "hello");
        assert_eq!(second, " world");
    }

    #[test]
    fn ingest_part_emits_start_and_delta_for_first_updated_text_part() {
        let mut synth = StreamSynthesizer::new(None);
        let events = synth.ingest_part(
            "ses_1",
            &opencode_sdk_rs::MessagePart::Text {
                id: "part_1".to_string(),
                text: "hello".to_string(),
            },
        );

        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
        assert!(matches!(
            events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: crate::domain::agents::adapter::RuntimeContentDelta::Text { text },
                ..
            }) if text == "hello"
        ));
    }

    #[test]
    fn ingest_part_emits_incremental_delta_after_initial_start() {
        let mut synth = StreamSynthesizer::new(None);
        let _ = synth.ingest_part(
            "ses_1",
            &opencode_sdk_rs::MessagePart::ToolUse {
                id: "part_1".to_string(),
                tool_id: "call_1".to_string(),
                name: "Bash".to_string(),
                input: json!({ "command": "ls" }),
            },
        );

        let events = synth.ingest_part(
            "ses_1",
            &opencode_sdk_rs::MessagePart::ToolUse {
                id: "part_1".to_string(),
                tool_id: "call_1".to_string(),
                name: "Bash".to_string(),
                input: json!({ "command": "ls -la" }),
            },
        );

        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: crate::domain::agents::adapter::RuntimeContentDelta::InputJson {
                    partial_json
                },
                ..
            }) if partial_json.contains("-la")
        ));
    }

    #[test]
    fn ingest_delta_uses_known_part_metadata_for_reasoning() {
        let mut synth = StreamSynthesizer::new(None);
        let _ = synth.ingest_part(
            "ses_1",
            &opencode_sdk_rs::MessagePart::Thinking {
                id: "part_1".to_string(),
                thinking: String::new(),
            },
        );

        let events = synth.ingest_delta("ses_1", "part_1", "reasoning_content", "step 1");
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: crate::domain::agents::adapter::RuntimeContentDelta::Thinking {
                    thinking
                },
                ..
            }) if thinking == "step 1"
        ));
    }

    #[test]
    fn ingest_delta_can_bootstrap_text_block_from_field_name() {
        let mut synth = StreamSynthesizer::new(None);
        let events = synth.ingest_delta("ses_1", "part_1", "text", "hello");
        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
        assert!(matches!(
            events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: crate::domain::agents::adapter::RuntimeContentDelta::Text { text },
                ..
            }) if text == "hello"
        ));
    }

    #[test]
    fn ingest_delta_ignores_unknown_field_without_known_part_type() {
        let mut synth = StreamSynthesizer::new(None);
        let events = synth.ingest_delta("ses_1", "part_1", "mystery_field", "hello");
        assert!(events.is_empty());
    }

    #[test]
    fn ingest_delta_then_full_text_update_does_not_duplicate_content() {
        let mut synth = StreamSynthesizer::new(None);
        let delta_events = synth.ingest_delta("ses_1", "part_1", "text", "hello");
        assert_eq!(delta_events.len(), 2);

        let update_events = synth.ingest_part(
            "ses_1",
            &opencode_sdk_rs::MessagePart::Text {
                id: "part_1".to_string(),
                text: "hello".to_string(),
            },
        );

        assert!(update_events.is_empty());
    }
}
