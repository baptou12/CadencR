use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use super::events::{
    assistant_fallback_event, init_event, message_start_event, permission_request_event,
    question_request_event, result_event, user_message_event,
};
use super::stream_synthesizer::StreamSynthesizer;
use super::PendingRequestKind;
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};

struct LoopState {
    synthesizer: StreamSynthesizer,
    message_roles: HashMap<String, opencode_sdk_rs::MessageRole>,
    assistant_turn_started: bool,
    active_assistant_message_id: Option<String>,
}

impl LoopState {
    fn new(model: Option<String>) -> Self {
        Self {
            synthesizer: StreamSynthesizer::new(model),
            message_roles: HashMap::new(),
            assistant_turn_started: false,
            active_assistant_message_id: None,
        }
    }

    fn on_message(&mut self, message: opencode_sdk_rs::Message, output: &mut Vec<RuntimeEvent>) {
        remember_message_role(&mut self.message_roles, &message);
        match message.role {
            opencode_sdk_rs::MessageRole::Assistant => {
                self.handle_assistant_message(&message, output)
            }
            opencode_sdk_rs::MessageRole::User => output.push(user_message_event(&message)),
            _ => {}
        }
    }

    fn handle_assistant_message(
        &mut self,
        message: &opencode_sdk_rs::Message,
        output: &mut Vec<RuntimeEvent>,
    ) {
        let model = message
            .model
            .clone()
            .or_else(|| self.synthesizer.current_model());
        let is_new_message =
            self.active_assistant_message_id.as_deref() != Some(message.id.as_str());
        if is_new_message {
            self.synthesizer.reset_for_turn(model.clone());
            output.push(message_start_event(&message.session_id, model));
            self.active_assistant_message_id = Some(message.id.clone());
        }
        if !message.parts.is_empty() {
            self.assistant_turn_started = true;
            output.push(assistant_fallback_event(message));
        }
    }

    fn on_part(
        &mut self,
        session_id: &str,
        message_id: &str,
        part: &opencode_sdk_rs::MessagePart,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if !streams_assistant_parts(&self.message_roles, message_id) {
            return;
        }
        self.assistant_turn_started = true;
        output.extend(self.synthesizer.ingest_part(session_id, part));
    }

    fn on_delta(
        &mut self,
        session_id: &str,
        message_id: &str,
        part_id: &str,
        field: &str,
        delta: &str,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if !streams_assistant_parts(&self.message_roles, message_id) {
            return;
        }
        self.assistant_turn_started = true;
        output.extend(
            self.synthesizer
                .ingest_delta(session_id, part_id, field, delta),
        );
    }

    fn on_session_updated(
        &mut self,
        expected_session_id: &str,
        session: opencode_sdk_rs::Session,
        output: &mut Vec<RuntimeEvent>,
    ) {
        if session.id != expected_session_id {
            return;
        }
        if should_finish_turn_from_status(&session.status, self.assistant_turn_started) {
            self.finish_turn(&session.id, output);
        }
    }

    fn finish_turn(&mut self, session_id: &str, output: &mut Vec<RuntimeEvent>) {
        output.extend(self.synthesizer.stop_events(session_id));
        output.push(result_event(session_id));
        self.assistant_turn_started = false;
        self.active_assistant_message_id = None;
    }
}

pub(super) fn spawn_event_loop(
    mut source_rx: mpsc::Receiver<opencode_sdk_rs::SseEvent>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequestKind>>>,
    session_id: String,
    model: Option<String>,
) {
    tokio::spawn(async move {
        let mut state = LoopState::new(model);
        while let Some(event) = source_rx.recv().await {
            let mut output = Vec::new();
            match event {
                opencode_sdk_rs::SseEvent::ServerConnected => {
                    output.push(init_event(&session_id, state.synthesizer.current_model()));
                }
                opencode_sdk_rs::SseEvent::MessageCreated(message)
                | opencode_sdk_rs::SseEvent::MessageUpdated(message) => {
                    state.on_message(message, &mut output);
                }
                opencode_sdk_rs::SseEvent::PartCreated {
                    session_id,
                    message_id,
                    part,
                }
                | opencode_sdk_rs::SseEvent::PartUpdated {
                    session_id,
                    message_id,
                    part,
                } => {
                    state.on_part(&session_id, &message_id, &part, &mut output);
                }
                opencode_sdk_rs::SseEvent::PartDelta {
                    session_id,
                    message_id,
                    part_id,
                    field,
                    delta,
                    ..
                } => {
                    state.on_delta(
                        &session_id,
                        &message_id,
                        &part_id,
                        &field,
                        &delta,
                        &mut output,
                    );
                }
                opencode_sdk_rs::SseEvent::SessionUpdated(session) => {
                    state.on_session_updated(&session_id, session, &mut output);
                }
                opencode_sdk_rs::SseEvent::PermissionCreated(request) => {
                    pending_requests
                        .lock()
                        .await
                        .insert(request.id.clone(), PendingRequestKind::Permission);
                    output.push(permission_request_event(&request));
                }
                opencode_sdk_rs::SseEvent::QuestionCreated(question) => {
                    pending_requests
                        .lock()
                        .await
                        .insert(question.id.clone(), PendingRequestKind::Question);
                    output.push(question_request_event(&question));
                }
                _ => {}
            }

            for mapped in output {
                if tx.send(Ok(mapped)).await.is_err() {
                    return;
                }
            }
        }
    });
}

fn remember_message_role(
    message_roles: &mut HashMap<String, opencode_sdk_rs::MessageRole>,
    message: &opencode_sdk_rs::Message,
) {
    message_roles.insert(message.id.clone(), message.role.clone());
}

fn streams_assistant_parts(
    message_roles: &HashMap<String, opencode_sdk_rs::MessageRole>,
    message_id: &str,
) -> bool {
    matches!(
        message_roles.get(message_id),
        Some(opencode_sdk_rs::MessageRole::Assistant)
    )
}

fn should_finish_turn_from_status(
    status: &opencode_sdk_rs::SessionStatus,
    assistant_turn_started: bool,
) -> bool {
    assistant_turn_started && matches!(status, opencode_sdk_rs::SessionStatus::Completed)
}

#[cfg(test)]
mod tests {
    use super::{
        assistant_fallback_event, remember_message_role, should_finish_turn_from_status,
        streams_assistant_parts, LoopState,
    };
    use std::collections::HashMap;

    #[test]
    fn remembers_and_checks_message_roles_for_part_streaming() {
        let mut roles = HashMap::new();
        let assistant = opencode_sdk_rs::Message {
            id: "msg_assistant".to_string(),
            session_id: "ses_1".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: Vec::new(),
            created_at: None,
            model: Some("openai/gpt-5.3-codex".to_string()),
            finished: false,
        };
        let user = opencode_sdk_rs::Message {
            id: "msg_user".to_string(),
            session_id: "ses_1".to_string(),
            role: opencode_sdk_rs::MessageRole::User,
            parts: Vec::new(),
            created_at: None,
            model: None,
            finished: false,
        };

        remember_message_role(&mut roles, &assistant);
        remember_message_role(&mut roles, &user);

        assert!(streams_assistant_parts(&roles, "msg_assistant"));
        assert!(!streams_assistant_parts(&roles, "msg_user"));
        assert!(!streams_assistant_parts(&roles, "missing"));
    }

    #[test]
    fn finishes_turn_only_after_assistant_activity() {
        assert!(!should_finish_turn_from_status(
            &opencode_sdk_rs::SessionStatus::Idle,
            false,
        ));
        assert!(!should_finish_turn_from_status(
            &opencode_sdk_rs::SessionStatus::Completed,
            false,
        ));
        assert!(should_finish_turn_from_status(
            &opencode_sdk_rs::SessionStatus::Completed,
            true,
        ));
        assert!(!should_finish_turn_from_status(
            &opencode_sdk_rs::SessionStatus::Active,
            true,
        ));
        assert!(!should_finish_turn_from_status(
            &opencode_sdk_rs::SessionStatus::Idle,
            true,
        ));
    }

    #[test]
    fn finished_assistant_message_does_not_end_turn_without_session_completion() {
        let message = opencode_sdk_rs::Message {
            id: "msg_assistant".to_string(),
            session_id: "ses_1".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: vec![opencode_sdk_rs::MessagePart::Text {
                id: "part_1".to_string(),
                text: "Working".to_string(),
            }],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            finished: true,
        };
        let mut state = LoopState::new(message.model.clone());
        let mut output = Vec::new();

        state.on_message(message, &mut output);

        assert!(output
            .iter()
            .any(|event| event.assistant_message().is_some()));
        assert!(!output.iter().any(|event| event.is_result()));
    }

    #[test]
    fn session_completed_emits_result_after_assistant_activity() {
        let mut state = LoopState::new(Some("openai/gpt-5.4".to_string()));
        let message = opencode_sdk_rs::Message {
            id: "msg_assistant".to_string(),
            session_id: "ses_1".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: vec![opencode_sdk_rs::MessagePart::Text {
                id: "part_1".to_string(),
                text: "Working".to_string(),
            }],
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            finished: true,
        };
        let mut output = vec![assistant_fallback_event(&message)];
        state.assistant_turn_started = true;

        state.on_session_updated(
            "ses_1",
            opencode_sdk_rs::Session {
                id: "ses_1".to_string(),
                title: None,
                directory: "/tmp".to_string(),
                status: opencode_sdk_rs::SessionStatus::Completed,
                parent_id: None,
                created_at: None,
                updated_at: None,
            },
            &mut output,
        );

        assert!(output.iter().any(|event| event.is_result()));
    }
}
