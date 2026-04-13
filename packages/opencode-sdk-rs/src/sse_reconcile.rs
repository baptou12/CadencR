use std::collections::{HashMap, HashSet};

use tracing::warn;

use crate::client::OpenCodeClient;
use crate::types::{
    Message, MessagePart, MessageRole, PermissionRequest, Question, Session, SseEvent,
};

#[derive(Default)]
pub(crate) struct ReconnectState {
    sessions: HashMap<String, Session>,
    messages: HashMap<String, HashMap<String, Message>>,
    permissions: HashMap<String, String>,
    questions: HashMap<String, String>,
}

impl ReconnectState {
    pub(crate) fn record_event(&mut self, event: &SseEvent) {
        match event {
            SseEvent::SessionCreated(session) | SseEvent::SessionUpdated(session) => {
                self.sessions.insert(session.id.clone(), session.clone());
            }
            SseEvent::SessionDeleted { session_id } => {
                self.sessions.remove(session_id);
                self.messages.remove(session_id);
            }
            SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message) => {
                self.messages
                    .entry(message.session_id.clone())
                    .or_default()
                    .insert(message.id.clone(), message.clone());
            }
            SseEvent::PartCreated {
                session_id,
                message_id,
                part,
            }
            | SseEvent::PartUpdated {
                session_id,
                message_id,
                part,
            } => self.update_message_part(session_id, message_id, part),
            SseEvent::PartDelta {
                session_id,
                message_id,
                part_id,
                field,
                delta,
            } => self.apply_message_delta(session_id, message_id, part_id, field, delta),
            SseEvent::PermissionCreated(request) => {
                self.permissions
                    .insert(request.id.clone(), request.session_id.clone());
            }
            SseEvent::PermissionUpdated { id, .. } => {
                self.permissions.remove(id);
            }
            SseEvent::QuestionCreated(question) => {
                self.questions
                    .insert(question.id.clone(), question.session_id.clone());
            }
            SseEvent::QuestionUpdated { id, .. } => {
                self.questions.remove(id);
            }
            _ => {}
        }
    }

    pub(crate) async fn reconcile_subscribers(
        &mut self,
        client: &OpenCodeClient,
        directory: Option<&str>,
        root_session_ids: &[String],
    ) -> Vec<SseEvent> {
        let mut events = Vec::new();
        let mut seen_sessions = HashSet::new();

        for root_session_id in root_session_ids {
            let Ok(root_session) = client.get_session_any(root_session_id).await else {
                warn!(session_id = %root_session_id, "failed to fetch session during SSE reconciliation");
                continue;
            };

            for session in std::iter::once(root_session).chain(
                client
                    .list_children_in_directory(root_session_id, directory)
                    .await
                    .unwrap_or_default(),
            ) {
                if !seen_sessions.insert(session.id.clone()) {
                    continue;
                }
                events.extend(self.reconcile_session(client, &session).await);
            }
        }

        if seen_sessions.is_empty() {
            return events;
        }

        events.extend(self.reconcile_permissions(client, &seen_sessions).await);
        events.extend(self.reconcile_questions(client, &seen_sessions).await);
        events
    }

    async fn reconcile_session(
        &mut self,
        client: &OpenCodeClient,
        session: &Session,
    ) -> Vec<SseEvent> {
        let mut events = Vec::new();
        let needs_session_update = self
            .sessions
            .get(&session.id)
            .map(|known| known != session)
            .unwrap_or(true);
        self.sessions.insert(session.id.clone(), session.clone());
        if needs_session_update {
            events.push(SseEvent::SessionUpdated(session.clone()));
        }

        let messages = match client.list_messages(&session.id).await {
            Ok(messages) => messages,
            Err(error) => {
                warn!(error = %error, session_id = %session.id, "failed to reconcile OpenCode messages");
                return events;
            }
        };

        let known_messages = self.messages.get(&session.id).cloned().unwrap_or_default();
        for message in &messages {
            events.extend(reconcile_message(message, known_messages.get(&message.id)));
        }
        self.messages.insert(
            session.id.clone(),
            messages
                .into_iter()
                .map(|message| (message.id.clone(), message))
                .collect(),
        );

        events
    }

    async fn reconcile_permissions(
        &mut self,
        client: &OpenCodeClient,
        seen_sessions: &HashSet<String>,
    ) -> Vec<SseEvent> {
        match client.list_permissions().await {
            Ok(requests) => reconcile_pending_requests(
                requests,
                seen_sessions,
                &mut self.permissions,
                SseEvent::PermissionCreated,
            ),
            Err(error) => {
                warn!(error = %error, "failed to reconcile OpenCode permissions");
                Vec::new()
            }
        }
    }

    async fn reconcile_questions(
        &mut self,
        client: &OpenCodeClient,
        seen_sessions: &HashSet<String>,
    ) -> Vec<SseEvent> {
        match client.list_questions().await {
            Ok(questions) => reconcile_pending_requests(
                questions,
                seen_sessions,
                &mut self.questions,
                SseEvent::QuestionCreated,
            ),
            Err(error) => {
                warn!(error = %error, "failed to reconcile OpenCode questions");
                Vec::new()
            }
        }
    }

    fn update_message_part(&mut self, session_id: &str, message_id: &str, part: &MessagePart) {
        let Some(message) = self
            .messages
            .get_mut(session_id)
            .and_then(|messages| messages.get_mut(message_id))
        else {
            return;
        };

        let Some(part_id) = part.id() else {
            return;
        };
        if let Some(existing) = message
            .parts
            .iter_mut()
            .find(|existing| existing.id() == Some(part_id))
        {
            *existing = part.clone();
            return;
        }
        message.parts.push(part.clone());
    }

    fn apply_message_delta(
        &mut self,
        session_id: &str,
        message_id: &str,
        part_id: &str,
        field: &str,
        delta: &str,
    ) {
        let Some(message) = self
            .messages
            .get_mut(session_id)
            .and_then(|messages| messages.get_mut(message_id))
        else {
            return;
        };

        let part_index = message
            .parts
            .iter()
            .position(|part| part.id() == Some(part_id));
        let Some(index) = part_index.or_else(|| {
            placeholder_part(part_id, field).map(|part| {
                message.parts.push(part);
                message.parts.len() - 1
            })
        }) else {
            return;
        };

        apply_delta_to_part(&mut message.parts[index], field, delta);
    }
}

fn reconcile_pending_requests<T, F>(
    items: Vec<T>,
    seen_sessions: &HashSet<String>,
    pending: &mut HashMap<String, String>,
    to_event: F,
) -> Vec<SseEvent>
where
    T: PendingRequest,
    F: Fn(T) -> SseEvent,
{
    let mut events = Vec::new();
    let mut current_ids = HashSet::new();

    for item in items {
        if !seen_sessions.contains(item.session_id()) {
            continue;
        }
        current_ids.insert(item.id().to_string());
        if pending
            .insert(item.id().to_string(), item.session_id().to_string())
            .is_none()
        {
            events.push(to_event(item));
        }
    }

    pending
        .retain(|id, session_id| !seen_sessions.contains(session_id) || current_ids.contains(id));
    events
}

fn reconcile_message(message: &Message, known: Option<&Message>) -> Vec<SseEvent> {
    if !matches!(message.role, MessageRole::Assistant) {
        let needs_replay = known.map(|known| known != message).unwrap_or(true);
        return needs_replay
            .then(|| SseEvent::MessageUpdated(message.clone()))
            .into_iter()
            .collect();
    }

    let mut events = Vec::new();
    if known.is_none() || assistant_header_changed(message, known) {
        events.push(SseEvent::MessageUpdated(assistant_header(message, false)));
    }

    for part in &message.parts {
        let Some(part_id) = part.id() else {
            continue;
        };
        let known_part = known.and_then(|message| {
            message
                .parts
                .iter()
                .find(|known_part| known_part.id() == Some(part_id))
        });
        if known_part != Some(part) {
            events.push(SseEvent::PartCreated {
                session_id: message.session_id.clone(),
                message_id: message.id.clone(),
                part: part.clone(),
            });
        }
    }

    if message.finished
        && known.map(|known| !known.finished).unwrap_or(true)
        && !message.parts.iter().any(MessagePart::is_terminal_stop)
    {
        events.push(SseEvent::MessageUpdated(assistant_header(message, true)));
    }

    events
}

fn assistant_header_changed(message: &Message, known: Option<&Message>) -> bool {
    let Some(known) = known else {
        return true;
    };
    known.model != message.model || known.tokens != message.tokens
}

fn assistant_header(message: &Message, finished: bool) -> Message {
    Message {
        parts: Vec::new(),
        finished,
        ..message.clone()
    }
}

fn placeholder_part(part_id: &str, field: &str) -> Option<MessagePart> {
    if matches!(field, "text" | "content") {
        return Some(MessagePart::Text {
            id: part_id.to_string(),
            text: String::new(),
        });
    }
    if field.starts_with("reasoning") {
        return Some(MessagePart::Thinking {
            id: part_id.to_string(),
            thinking: String::new(),
        });
    }
    None
}

fn apply_delta_to_part(part: &mut MessagePart, field: &str, delta: &str) {
    match part {
        MessagePart::Text { text, .. } if matches!(field, "text" | "content") => {
            text.push_str(delta);
        }
        MessagePart::Thinking { thinking, .. } if field.starts_with("reasoning") => {
            thinking.push_str(delta);
        }
        _ => {}
    }
}

trait PendingRequest {
    fn id(&self) -> &str;
    fn session_id(&self) -> &str;
}

impl PendingRequest for PermissionRequest {
    fn id(&self) -> &str {
        &self.id
    }

    fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl PendingRequest for Question {
    fn id(&self) -> &str {
        &self.id
    }

    fn session_id(&self) -> &str {
        &self.session_id
    }
}
