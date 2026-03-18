use axum::extract::ws::Message;

use super::super::protocol::*;
use super::{send_error, WsSender};

/// Handle commands domain actions.
pub(super) async fn handle_commands_action(envelope: WsEnvelope, sender: &WsSender) {
    match envelope.action.as_str() {
        "get" => handle_commands_get(envelope, sender).await,
        unknown => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "commands",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "UNKNOWN_ACTION".into(),
                    message: format!("Unknown commands action: {unknown}"),
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
    }
}

/// Handle commands.get: fetch available slash commands for a given cwd.
///
/// Resolves commands by scanning the filesystem for custom commands/skills
/// and combining with hardcoded built-in commands. Does NOT spawn a CLI subprocess.
async fn handle_commands_get(envelope: WsEnvelope, sender: &WsSender) {
    let payload: CommandsGetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &format!("Invalid commands.get payload: {e}"));
            return;
        }
    };

    let resolved = super::super::slash_commands::resolve_commands(&payload.cwd).await;

    let commands: Vec<SlashCommandPayload> = resolved
        .into_iter()
        .map(|c| SlashCommandPayload {
            name: c.name,
            description: c.description,
        })
        .collect();

    let reply = WsEnvelope::reply(
        &envelope.id,
        "commands",
        "list",
        serde_json::to_value(CommandsListPayload { commands }).unwrap(),
    );
    let _ = sender.send(Message::Text(String::from(reply).into()));
}
