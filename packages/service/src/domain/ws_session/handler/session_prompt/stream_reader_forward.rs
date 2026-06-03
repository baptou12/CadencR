use axum::extract::ws::Message;
use tracing::debug;

use crate::domain::agents::adapter::RuntimeStreamStatus;
use crate::domain::agents::adapter::{RuntimeEvent, RuntimeSlashCommandKind};
use crate::domain::ws_session::protocol::{
    CommandsUpdatedPayload, PromptReceivedPayload, SessionStreamStatusPayload,
    SlashCommandKindPayload, SlashCommandPayload, StreamStatusState, WsEnvelope,
};

use super::super::WsSender;

pub(super) enum ForwardOutcome {
    Forwarded,
    NotHandled,
    SenderClosed,
}

pub(super) fn forward_immediate_event(
    sender: &WsSender,
    db_session_id: i64,
    runtime_event: &RuntimeEvent,
) -> ForwardOutcome {
    if let Some(client_message_id) = runtime_event.prompt_received_client_message_id() {
        return send_envelope(
            sender,
            db_session_id,
            "prompt_received",
            WsEnvelope::new(
                "session",
                "prompt_received",
                serde_json::to_value(PromptReceivedPayload {
                    client_message_id: client_message_id.to_string(),
                })
                .unwrap(),
            ),
        );
    }

    if let Some(commands) = runtime_event.slash_commands_updated() {
        return send_envelope(
            sender,
            db_session_id,
            "commands.updated",
            WsEnvelope::new(
                "commands",
                "updated",
                serde_json::to_value(CommandsUpdatedPayload {
                    commands: commands
                        .iter()
                        .map(|command| SlashCommandPayload {
                            name: command.name.clone(),
                            description: command.description.clone(),
                            kind: slash_command_kind_payload(command.kind),
                        })
                        .collect(),
                })
                .unwrap(),
            ),
        );
    }

    if let Some(status) = runtime_event.stream_status() {
        return send_envelope(
            sender,
            db_session_id,
            "stream_status",
            WsEnvelope::new(
                "session",
                "stream_status",
                serde_json::to_value(stream_status_payload(status)).unwrap(),
            ),
        );
    }

    ForwardOutcome::NotHandled
}

fn send_envelope(
    sender: &WsSender,
    db_session_id: i64,
    label: &'static str,
    envelope: WsEnvelope,
) -> ForwardOutcome {
    if sender
        .send(Message::Text(String::from(envelope).into()))
        .is_err()
    {
        debug!(
            db_session_id,
            "WebSocket sender closed during {label} forward"
        );
        return ForwardOutcome::SenderClosed;
    }
    ForwardOutcome::Forwarded
}

fn slash_command_kind_payload(kind: RuntimeSlashCommandKind) -> SlashCommandKindPayload {
    match kind {
        RuntimeSlashCommandKind::Command => SlashCommandKindPayload::Command,
        RuntimeSlashCommandKind::Skill => SlashCommandKindPayload::Skill,
    }
}

fn stream_status_payload(status: &RuntimeStreamStatus) -> SessionStreamStatusPayload {
    match status {
        RuntimeStreamStatus::Degraded { reason } => SessionStreamStatusPayload {
            state: StreamStatusState::Degraded,
            reason: Some(reason.clone()),
        },
        RuntimeStreamStatus::Recovered => SessionStreamStatusPayload {
            state: StreamStatusState::Recovered,
            reason: None,
        },
    }
}
