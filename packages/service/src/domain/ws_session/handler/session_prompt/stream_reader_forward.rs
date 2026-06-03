use axum::extract::ws::Message;
use tracing::debug;

use crate::domain::agents::adapter::RuntimeStreamStatus;
use crate::domain::agents::adapter::{RuntimeEvent, RuntimeSlashCommandKind};
use crate::domain::ws_session::protocol::{
    CommandsUpdatedPayload, PromptReceivedPayload, SessionStreamStatusPayload,
    SlashCommandKindPayload, SlashCommandPayload, StreamStatusState, WsEnvelope,
};

use super::stream_reader_task::StreamReaderTask;

pub(super) enum ForwardOutcome {
    Forwarded,
    NotHandled,
    SenderClosed,
}

pub(super) async fn forward_immediate_event(
    task: &StreamReaderTask,
    runtime_event: &RuntimeEvent,
) -> ForwardOutcome {
    if let Some(client_message_id) = runtime_event.prompt_received_client_message_id() {
        return send_envelope(
            task,
            "prompt_received",
            WsEnvelope::new(
                "session",
                "prompt_received",
                serde_json::to_value(PromptReceivedPayload {
                    client_message_id: client_message_id.to_string(),
                })
                .unwrap(),
            ),
            false,
        )
        .await;
    }

    if let Some(commands) = runtime_event.slash_commands_updated() {
        return send_envelope(
            task,
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
            false,
        )
        .await;
    }

    if let Some(status) = runtime_event.stream_status() {
        return send_envelope(
            task,
            "stream_status",
            WsEnvelope::new(
                "session",
                "stream_status",
                serde_json::to_value(stream_status_payload(status)).unwrap(),
            ),
            true,
        )
        .await;
    }

    ForwardOutcome::NotHandled
}

/// Forward `envelope` to the turn's owner. When `mirror` is set, also relay it
/// to other devices viewing the feature — only stream content (`stream_status`)
/// is mirrored; owner-specific acks (`prompt_received`, `commands.updated`) are
/// not.
async fn send_envelope(
    task: &StreamReaderTask,
    label: &'static str,
    envelope: WsEnvelope,
    mirror: bool,
) -> ForwardOutcome {
    let msg = Message::Text(String::from(envelope).into());
    let owner_closed = if mirror {
        task.send_and_mirror(msg).await
    } else {
        task.sender.send(msg).is_err()
    };
    if owner_closed {
        debug!(
            task.db_session_id,
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
