mod pending;
mod subtasks;

use std::collections::HashMap;

use pending::{PendingMessageEvent, PendingSessionEvent, PendingState};

use super::events::{
    assistant_fallback_event, message_start_event, result_event, user_message_event,
};
use super::stream_synthesizer::StreamSynthesizer;
use crate::domain::agents::adapter::{RuntimeEvent, RuntimeUsage};

struct SessionStreamState {
    synthesizer: StreamSynthesizer,
    assistant_turn_started: bool,
    active_assistant_message_id: Option<String>,
    latest_usage: Option<RuntimeUsage>,
}

impl SessionStreamState {
    fn new(model: Option<String>) -> Self {
        Self {
            synthesizer: StreamSynthesizer::new(model),
            assistant_turn_started: false,
            active_assistant_message_id: None,
            latest_usage: None,
        }
    }
}

pub(super) struct LoopState {
    root_session_id: String,
    session_states: HashMap<String, SessionStreamState>,
    pending: PendingState,
}

impl LoopState {
    pub(super) fn new(root_session_id: String, model: Option<String>) -> Self {
        let mut session_states = HashMap::new();
        session_states.insert(root_session_id.clone(), SessionStreamState::new(model));
        Self {
            root_session_id,
            session_states,
            pending: PendingState::new(),
        }
    }

    pub(super) fn current_model(&self) -> Option<String> {
        self.session_states
            .get(&self.root_session_id)
            .and_then(|state| state.synthesizer.current_model())
    }

    pub(super) fn on_message(
        &mut self,
        message: opencode_sdk_rs::Message,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if self
            .pending
            .should_buffer_session(&self.root_session_id, &message.session_id)
        {
            self.pending.buffer_session_message(message);
            return;
        }

        let pending_events = self.pending.register_message(&message);
        match message.role {
            opencode_sdk_rs::MessageRole::Assistant => {
                self.handle_assistant_message(&message, pending_events, output)
            }
            opencode_sdk_rs::MessageRole::User => {
                let parent_tool_use_id = self.parent_tool_use_id_for_session(&message.session_id);
                output.push(user_message_event(&message, parent_tool_use_id.as_deref()));
            }
            _ => {}
        }
    }

    pub(super) fn on_part(
        &mut self,
        session_id: &str,
        message_id: &str,
        part: &opencode_sdk_rs::MessagePart,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if self
            .pending
            .should_buffer_session(&self.root_session_id, session_id)
        {
            self.pending
                .buffer_session_part(session_id, message_id, part.clone());
            return;
        }

        match self.pending.message_role(session_id, message_id) {
            Some(opencode_sdk_rs::MessageRole::Assistant) => {
                self.process_part(session_id, part, output);
            }
            Some(_) => {}
            None => self.pending.buffer_message_event(
                session_id,
                message_id,
                PendingMessageEvent::Part(part.clone()),
            ),
        }
    }

    pub(super) fn on_delta(
        &mut self,
        session_id: &str,
        message_id: &str,
        part_id: &str,
        field: &str,
        delta: &str,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if self
            .pending
            .should_buffer_session(&self.root_session_id, session_id)
        {
            self.pending
                .buffer_session_delta(session_id, message_id, part_id, field, delta);
            return;
        }

        match self.pending.message_role(session_id, message_id) {
            Some(opencode_sdk_rs::MessageRole::Assistant) => {
                self.process_delta(session_id, part_id, field, delta, output);
            }
            Some(_) => {}
            None => self.pending.buffer_message_event(
                session_id,
                message_id,
                PendingMessageEvent::Delta {
                    part_id: part_id.to_string(),
                    field: field.to_string(),
                    delta: delta.to_string(),
                },
            ),
        }
    }

    pub(super) fn on_session_updated(
        &mut self,
        session: opencode_sdk_rs::Session,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if let Some(child_session_id) = self.pending.register_child_session(&session) {
            self.flush_pending_session_events(&child_session_id, output);
        }

        if self
            .pending
            .should_buffer_session(&self.root_session_id, &session.id)
        {
            if should_finish_turn_from_status(&session.status) {
                self.pending.buffer_session_finish(&session.id);
            }
            return;
        }

        if should_finish_turn_from_status(&session.status) {
            self.finish_session(&session.id, output);
        }
    }

    fn handle_assistant_message(
        &mut self,
        message: &opencode_sdk_rs::Message,
        pending_events: Option<Vec<PendingMessageEvent>>,
        output: &mut Vec<RuntimeEvent>,
    ) {
        self.note_subtasks_from_message(message, output);
        let parent_tool_use_id = self.parent_tool_use_id_for_session(&message.session_id);
        let usage = message.tokens.as_ref().map(|tokens| RuntimeUsage {
            input_tokens: tokens.total_input(),
            output_tokens: tokens.output,
        });

        {
            let state = self.session_state_mut(&message.session_id, message.model.clone());
            let model = message
                .model
                .clone()
                .or_else(|| state.synthesizer.current_model());
            let is_new_message =
                state.active_assistant_message_id.as_deref() != Some(message.id.as_str());

            if let Some(usage) = usage.clone() {
                state.latest_usage = Some(usage);
            }
            if is_new_message {
                state.synthesizer.reset_for_turn(model.clone());
                output.push(message_start_event(
                    &message.session_id,
                    model,
                    usage,
                    parent_tool_use_id.as_deref(),
                ));
                state.active_assistant_message_id = Some(message.id.clone());
            }
            if !message.parts.is_empty() {
                state.assistant_turn_started = true;
                output.push(assistant_fallback_event(
                    message,
                    parent_tool_use_id.as_deref(),
                ));
            }
        }

        let Some(pending_events) = pending_events else {
            return;
        };

        let fallback_part_ids = message
            .parts
            .iter()
            .filter_map(message_part_id)
            .collect::<std::collections::HashSet<_>>();

        for event in pending_events {
            match event {
                PendingMessageEvent::Part(part)
                    if fallback_part_ids.contains(message_part_id(&part).unwrap_or_default()) => {}
                PendingMessageEvent::Delta { part_id, .. }
                    if fallback_part_ids.contains(part_id.as_str()) => {}
                PendingMessageEvent::Part(part) => {
                    self.process_part(&message.session_id, &part, output);
                }
                PendingMessageEvent::Delta {
                    part_id,
                    field,
                    delta,
                } => self.process_delta(&message.session_id, &part_id, &field, &delta, output),
            }
        }
    }

    fn note_subtasks_from_message(
        &mut self,
        message: &opencode_sdk_rs::Message,
        output: &mut Vec<RuntimeEvent>,
    ) {
        for part in &message.parts {
            self.note_subtask_part(&message.session_id, part, output);
        }
    }

    fn note_subtask_part(
        &mut self,
        session_id: &str,
        part: &opencode_sdk_rs::MessagePart,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if let Some(child_session_id) = self.pending.note_subtask_part(session_id, part) {
            self.flush_pending_session_events(&child_session_id, output);
        }
    }

    fn session_state_mut(
        &mut self,
        session_id: &str,
        model: Option<String>,
    ) -> &mut SessionStreamState {
        self.session_states
            .entry(session_id.to_string())
            .or_insert_with(|| SessionStreamState::new(model))
    }

    fn process_part(
        &mut self,
        session_id: &str,
        part: &opencode_sdk_rs::MessagePart,
        output: &mut Vec<RuntimeEvent>,
    ) {
        self.note_subtask_part(session_id, part, output);
        let parent_tool_use_id = self.parent_tool_use_id_for_session(session_id);
        let state = self.session_state_mut(session_id, None);
        state.assistant_turn_started = true;
        output.extend(state.synthesizer.ingest_part(
            session_id,
            part,
            parent_tool_use_id.as_deref(),
        ));
    }

    fn process_delta(
        &mut self,
        session_id: &str,
        part_id: &str,
        field: &str,
        delta: &str,
        output: &mut Vec<RuntimeEvent>,
    ) {
        let parent_tool_use_id = self.parent_tool_use_id_for_session(session_id);
        let state = self.session_state_mut(session_id, None);
        state.assistant_turn_started = true;
        output.extend(state.synthesizer.ingest_delta(
            session_id,
            part_id,
            field,
            delta,
            parent_tool_use_id.as_deref(),
        ));
    }

    fn flush_pending_session_events(&mut self, session_id: &str, output: &mut Vec<RuntimeEvent>) {
        let Some(events) = self.pending.take_session_events(session_id) else {
            return;
        };

        for event in events {
            match event {
                PendingSessionEvent::Message(message) => self.on_message(message, output),
                PendingSessionEvent::Part { message_id, part } => {
                    self.on_part(session_id, &message_id, &part, output);
                }
                PendingSessionEvent::Delta {
                    message_id,
                    part_id,
                    field,
                    delta,
                } => self.on_delta(session_id, &message_id, &part_id, &field, &delta, output),
                PendingSessionEvent::Finish => self.finish_session(session_id, output),
            }
        }
    }

    fn finish_session(&mut self, session_id: &str, output: &mut Vec<RuntimeEvent>) {
        let parent_tool_use_id = self.parent_tool_use_id_for_session(session_id);
        let Some(state) = self.session_states.get_mut(session_id) else {
            return;
        };
        if !state.assistant_turn_started {
            return;
        }

        output.extend(
            state
                .synthesizer
                .stop_events_with_parent(session_id, parent_tool_use_id.as_deref()),
        );
        if session_id == self.root_session_id {
            output.push(result_event(session_id, state.latest_usage.clone()));
        }
        state.assistant_turn_started = false;
        state.active_assistant_message_id = None;
        state.latest_usage = None;
    }

    fn parent_tool_use_id_for_session(&self, session_id: &str) -> Option<String> {
        self.pending
            .parent_tool_use_id_for_session(session_id)
            .map(ToOwned::to_owned)
    }
}

fn message_part_id(part: &opencode_sdk_rs::MessagePart) -> Option<&str> {
    match part {
        opencode_sdk_rs::MessagePart::Text { id, .. }
        | opencode_sdk_rs::MessagePart::Thinking { id, .. }
        | opencode_sdk_rs::MessagePart::ToolUse { id, .. }
        | opencode_sdk_rs::MessagePart::ToolResult { id, .. } => Some(id.as_str()),
        opencode_sdk_rs::MessagePart::Other(_) => None,
    }
}

fn should_finish_turn_from_status(status: &opencode_sdk_rs::SessionStatus) -> bool {
    matches!(
        status,
        opencode_sdk_rs::SessionStatus::Completed | opencode_sdk_rs::SessionStatus::Idle
    )
}
