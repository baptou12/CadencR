//! First slice of Cadencr-owned canonical session state.
//!
//! Provider adapters still emit the legacy normalized `RuntimeEvent`, but v1
//! index-based stream events are immediately assigned stable message/block ids
//! and applied as upserts/appends here. The desktop wire projection remains
//! legacy-compatible while later slices migrate persistence and DTOs one event
//! family at a time.

use std::collections::BTreeMap;

use serde_json::Value;

use super::adapter::{
    RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeStreamEvent, RuntimeStreamScope,
    RuntimeToolInputBuffer,
};

#[derive(Debug, Clone, PartialEq)]
pub enum CanonicalSessionOperation {
    MessageUpsert {
        message_id: String,
        model: Option<String>,
    },
    ContentBlockUpsert {
        message_id: String,
        block_id: String,
        content: CanonicalContent,
    },
    ContentBlockAppend {
        message_id: String,
        block_id: String,
        delta: CanonicalContentDelta,
    },
    ContentBlockCompleted {
        message_id: String,
        block_id: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum CanonicalContent {
    Text(String),
    Thinking(String),
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalContentDelta {
    Text(String),
    Thinking(String),
    InputJson(String),
}

#[derive(Debug, Clone, Default)]
pub struct CanonicalSessionSnapshot {
    messages: BTreeMap<String, CanonicalMessage>,
}

impl CanonicalSessionSnapshot {
    pub fn message(&self, message_id: &str) -> Option<&CanonicalMessage> {
        self.messages.get(message_id)
    }
}

#[derive(Debug, Clone)]
pub struct CanonicalMessage {
    pub model: Option<String>,
    pub blocks: BTreeMap<String, CanonicalBlock>,
}

#[derive(Debug, Clone)]
pub struct CanonicalBlock {
    pub content: CanonicalContent,
    pub completed: bool,
    input_json_buffer: Option<RuntimeToolInputBuffer>,
}

#[derive(Debug, Clone, Default)]
pub struct CanonicalSessionProjection {
    snapshot: CanonicalSessionSnapshot,
    active_message_ids: BTreeMap<RuntimeStreamScope, String>,
}

impl CanonicalSessionProjection {
    #[cfg(test)]
    pub fn snapshot(&self) -> &CanonicalSessionSnapshot {
        &self.snapshot
    }

    /// Model for this event's runtime stream and subagent nesting scope. A
    /// global "active" model is incorrect when root and child events interleave.
    pub fn model_for_event(&self, event: &RuntimeEvent) -> Option<&str> {
        self.active_message_ids
            .get(&RuntimeStreamScope::for_event(event))
            .map(String::as_str)
            .and_then(|id| self.snapshot.message(id))
            .and_then(|message| message.model.as_deref())
    }

    pub fn finish_turn(&mut self) {
        self.active_message_ids.clear();
    }

    pub fn apply_runtime_event(
        &mut self,
        event: &RuntimeEvent,
    ) -> Option<CanonicalSessionOperation> {
        let stream = event.stream_event()?;
        match stream {
            RuntimeStreamEvent::MessageStart { model, .. } => {
                let message_id = self.next_message_id(event);
                self.snapshot.messages.insert(
                    message_id.clone(),
                    CanonicalMessage {
                        model: model.clone(),
                        blocks: BTreeMap::new(),
                    },
                );
                self.active_message_ids
                    .insert(RuntimeStreamScope::for_event(event), message_id.clone());
                Some(CanonicalSessionOperation::MessageUpsert {
                    message_id,
                    model: model.clone(),
                })
            }
            RuntimeStreamEvent::ContentBlockStart { index, block } => {
                let message_id = self.ensure_message(event);
                let block_id = block_id(&message_id, *index);
                let content = canonical_content(block);
                self.message_mut(&message_id).blocks.insert(
                    block_id.clone(),
                    CanonicalBlock {
                        content: content.clone(),
                        completed: false,
                        input_json_buffer: tool_input_buffer(block),
                    },
                );
                Some(CanonicalSessionOperation::ContentBlockUpsert {
                    message_id,
                    block_id,
                    content,
                })
            }
            RuntimeStreamEvent::ContentBlockDelta { index, delta } => {
                let message_id = self.ensure_message(event);
                let block_id = block_id(&message_id, *index);
                let delta = canonical_delta(delta);
                let block = self
                    .message_mut(&message_id)
                    .blocks
                    .entry(block_id.clone())
                    .or_insert_with(|| CanonicalBlock {
                        content: empty_content_for_delta(&delta),
                        completed: false,
                        input_json_buffer: input_buffer_for_delta(&delta),
                    });
                append_delta(block, &delta);
                Some(CanonicalSessionOperation::ContentBlockAppend {
                    message_id,
                    block_id,
                    delta,
                })
            }
            RuntimeStreamEvent::ContentBlockStop { index } => {
                let message_id = self.ensure_message(event);
                let block_id = block_id(&message_id, *index);
                if let Some(block) = self.message_mut(&message_id).blocks.get_mut(&block_id) {
                    complete_block(block);
                }
                Some(CanonicalSessionOperation::ContentBlockCompleted {
                    message_id,
                    block_id,
                })
            }
            RuntimeStreamEvent::Other => None,
        }
    }

    fn next_message_id(&mut self, event: &RuntimeEvent) -> String {
        event
            .provider_message_id()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "{}:message:{}",
                    event.session_id().unwrap_or("runtime"),
                    uuid::Uuid::new_v4()
                )
            })
    }

    fn ensure_message(&mut self, event: &RuntimeEvent) -> String {
        let scope = RuntimeStreamScope::for_event(event);
        if let Some(id) = self.active_message_ids.get(&scope) {
            return id.clone();
        }
        let id = self.next_message_id(event);
        self.snapshot.messages.insert(
            id.clone(),
            CanonicalMessage {
                model: None,
                blocks: BTreeMap::new(),
            },
        );
        self.active_message_ids.insert(scope, id.clone());
        id
    }

    fn message_mut(&mut self, message_id: &str) -> &mut CanonicalMessage {
        self.snapshot
            .messages
            .get_mut(message_id)
            .expect("canonical message was ensured")
    }
}

fn block_id(message_id: &str, index: u64) -> String {
    format!("{message_id}:block:{index}")
}

fn canonical_content(content: &RuntimeContentBlock) -> CanonicalContent {
    match content {
        RuntimeContentBlock::Text { text } => CanonicalContent::Text(text.clone()),
        RuntimeContentBlock::Thinking { thinking } => CanonicalContent::Thinking(thinking.clone()),
        RuntimeContentBlock::ToolUse { id, name, input } => CanonicalContent::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
        },
        RuntimeContentBlock::Other => CanonicalContent::Unknown,
    }
}

fn canonical_delta(delta: &RuntimeContentDelta) -> CanonicalContentDelta {
    match delta {
        RuntimeContentDelta::Text { text } => CanonicalContentDelta::Text(text.clone()),
        RuntimeContentDelta::Thinking { thinking } => {
            CanonicalContentDelta::Thinking(thinking.clone())
        }
        RuntimeContentDelta::InputJson { partial_json } => {
            CanonicalContentDelta::InputJson(partial_json.clone())
        }
    }
}

fn tool_input_buffer(content: &RuntimeContentBlock) -> Option<RuntimeToolInputBuffer> {
    match content {
        RuntimeContentBlock::ToolUse { name, input, .. } => {
            Some(RuntimeToolInputBuffer::new(name, input))
        }
        _ => None,
    }
}

fn input_buffer_for_delta(delta: &CanonicalContentDelta) -> Option<RuntimeToolInputBuffer> {
    matches!(delta, CanonicalContentDelta::InputJson(_))
        .then(|| RuntimeToolInputBuffer::new("", &Value::Null))
}

fn empty_content_for_delta(delta: &CanonicalContentDelta) -> CanonicalContent {
    match delta {
        CanonicalContentDelta::Text(_) => CanonicalContent::Text(String::new()),
        CanonicalContentDelta::Thinking(_) => CanonicalContent::Thinking(String::new()),
        CanonicalContentDelta::InputJson(_) => CanonicalContent::ToolUse {
            id: String::new(),
            name: String::new(),
            input: Value::Null,
        },
    }
}

fn append_delta(block: &mut CanonicalBlock, delta: &CanonicalContentDelta) {
    match (&mut block.content, delta) {
        (CanonicalContent::Text(current), CanonicalContentDelta::Text(next))
        | (CanonicalContent::Thinking(current), CanonicalContentDelta::Thinking(next)) => {
            current.push_str(next);
        }
        (CanonicalContent::ToolUse { .. }, CanonicalContentDelta::InputJson(partial_json)) => {
            block
                .input_json_buffer
                .get_or_insert_with(|| RuntimeToolInputBuffer::new("", &Value::Null))
                .apply_delta(partial_json);
        }
        _ => {}
    }
}

fn complete_block(block: &mut CanonicalBlock) {
    if let (CanonicalContent::ToolUse { input, .. }, Some(input_buffer)) =
        (&mut block.content, block.input_json_buffer.take())
    {
        if let Some(materialized) = input_buffer.materialized_value() {
            *input = materialized;
        }
    }
    block.completed = true;
}

#[cfg(test)]
mod tests {
    use super::{CanonicalContent, CanonicalSessionOperation, CanonicalSessionProjection};
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeEventKind,
        RuntimeEventMetadata, RuntimeStreamEvent,
    };
    use serde_json::json;

    fn event(stream: RuntimeStreamEvent) -> RuntimeEvent {
        scoped_event("session-1", None, stream)
    }

    fn scoped_event(
        session_id: &str,
        parent_tool_use_id: Option<&str>,
        stream: RuntimeStreamEvent,
    ) -> RuntimeEvent {
        RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: Some(session_id.into()),
                raw: json!({}),
                ..RuntimeEventMetadata::default()
            },
            RuntimeEventKind::StreamEvent {
                event: stream,
                parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
            },
        )
    }

    #[test]
    fn v1_indexes_gain_stable_ids_and_materialize_deltas() {
        let mut projection = CanonicalSessionProjection::default();
        let start = event(RuntimeStreamEvent::MessageStart {
            model: Some("model-a".into()),
            input_tokens: None,
        });
        let operation = projection.apply_runtime_event(&start).unwrap();
        let CanonicalSessionOperation::MessageUpsert { message_id, .. } = operation else {
            panic!("message upsert")
        };
        assert!(message_id.starts_with("session-1:message:"));

        projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockStart {
            index: 2,
            block: RuntimeContentBlock::Text { text: "a".into() },
        }));
        projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockDelta {
            index: 2,
            delta: RuntimeContentDelta::Text { text: "b".into() },
        }));
        let message = projection.snapshot().message(&message_id).unwrap();
        let block = message
            .blocks
            .get(&format!("{message_id}:block:2"))
            .unwrap();
        assert_eq!(block.content, CanonicalContent::Text("ab".into()));
    }

    #[test]
    fn tool_input_fragments_materialize_as_json_when_the_block_completes() {
        let mut projection = CanonicalSessionProjection::default();
        let operation = projection
            .apply_runtime_event(&event(RuntimeStreamEvent::MessageStart {
                model: None,
                input_tokens: None,
            }))
            .unwrap();
        let CanonicalSessionOperation::MessageUpsert { message_id, .. } = operation else {
            panic!("message upsert")
        };
        projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockStart {
            index: 0,
            block: RuntimeContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "Read".into(),
                input: json!({}),
            },
        }));
        for partial_json in ["{\"path\":\"", "/tmp/file\"}"] {
            projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockDelta {
                index: 0,
                delta: RuntimeContentDelta::InputJson {
                    partial_json: partial_json.into(),
                },
            }));
        }
        projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockStop { index: 0 }));

        let block = projection
            .snapshot()
            .message(&message_id)
            .unwrap()
            .blocks
            .get(&format!("{message_id}:block:0"))
            .unwrap();
        assert_eq!(
            block.content,
            CanonicalContent::ToolUse {
                id: "tool-1".into(),
                name: "Read".into(),
                input: json!({ "path": "/tmp/file" }),
            }
        );
        assert!(block.completed);
    }

    #[test]
    fn complete_tool_input_snapshots_replace_instead_of_concatenating() {
        let mut projection = CanonicalSessionProjection::default();
        let operation = projection
            .apply_runtime_event(&event(RuntimeStreamEvent::MessageStart {
                model: None,
                input_tokens: None,
            }))
            .unwrap();
        let CanonicalSessionOperation::MessageUpsert { message_id, .. } = operation else {
            panic!("message upsert")
        };
        projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockStart {
            index: 0,
            block: RuntimeContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "Read".into(),
                input: json!({}),
            },
        }));
        for partial_json in [r#"{"path":"first"}"#, r#"{"path":"second"}"#] {
            projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockDelta {
                index: 0,
                delta: RuntimeContentDelta::InputJson {
                    partial_json: partial_json.into(),
                },
            }));
        }
        projection.apply_runtime_event(&event(RuntimeStreamEvent::ContentBlockStop { index: 0 }));

        let block = projection
            .snapshot()
            .message(&message_id)
            .unwrap()
            .blocks
            .get(&format!("{message_id}:block:0"))
            .unwrap();
        assert_eq!(
            block.content,
            CanonicalContent::ToolUse {
                id: "tool-1".into(),
                name: "Read".into(),
                input: json!({ "path": "second" }),
            }
        );
    }

    #[test]
    fn root_child_root_interleaving_keeps_messages_and_models_scoped() {
        let mut projection = CanonicalSessionProjection::default();
        let root_start = scoped_event(
            "shared-session",
            None,
            RuntimeStreamEvent::MessageStart {
                model: Some("root-model".into()),
                input_tokens: None,
            },
        );
        let root_id = match projection.apply_runtime_event(&root_start).unwrap() {
            CanonicalSessionOperation::MessageUpsert { message_id, .. } => message_id,
            other => panic!("unexpected root operation: {other:?}"),
        };
        let child_start = scoped_event(
            "shared-session",
            Some("parent-tool"),
            RuntimeStreamEvent::MessageStart {
                model: Some("child-model".into()),
                input_tokens: None,
            },
        );
        let child_id = match projection.apply_runtime_event(&child_start).unwrap() {
            CanonicalSessionOperation::MessageUpsert { message_id, .. } => message_id,
            other => panic!("unexpected child operation: {other:?}"),
        };

        let root_block = scoped_event(
            "shared-session",
            None,
            RuntimeStreamEvent::ContentBlockStart {
                index: 0,
                block: RuntimeContentBlock::Text {
                    text: "root resumed".into(),
                },
            },
        );
        let operation = projection.apply_runtime_event(&root_block).unwrap();
        assert!(matches!(
            operation,
            CanonicalSessionOperation::ContentBlockUpsert { ref message_id, .. }
                if message_id == &root_id
        ));
        assert_eq!(projection.model_for_event(&root_block), Some("root-model"));
        assert_eq!(
            projection.model_for_event(&child_start),
            Some("child-model")
        );
        assert_ne!(root_id, child_id);
        assert!(projection
            .snapshot()
            .message(&child_id)
            .expect("child message")
            .blocks
            .is_empty());
    }

    #[test]
    fn recreated_projections_do_not_reuse_synthetic_message_ids() {
        let start = event(RuntimeStreamEvent::MessageStart {
            model: None,
            input_tokens: None,
        });
        let mut first = CanonicalSessionProjection::default();
        let mut second = CanonicalSessionProjection::default();
        let first = first.apply_runtime_event(&start).unwrap();
        let second = second.apply_runtime_event(&start).unwrap();
        let (
            CanonicalSessionOperation::MessageUpsert {
                message_id: first, ..
            },
            CanonicalSessionOperation::MessageUpsert {
                message_id: second, ..
            },
        ) = (first, second)
        else {
            panic!("message upserts")
        };
        assert_ne!(first, second);
    }

    #[test]
    fn provider_message_identity_wins_over_synthetic_identity() {
        let mut projection = CanonicalSessionProjection::default();
        let event = event(RuntimeStreamEvent::MessageStart {
            model: None,
            input_tokens: None,
        })
        .with_provider_message_id(Some("provider-message".into()));
        let operation = projection.apply_runtime_event(&event).unwrap();
        assert!(matches!(
            operation,
            CanonicalSessionOperation::MessageUpsert { ref message_id, .. }
                if message_id == "provider-message"
        ));
    }
}
