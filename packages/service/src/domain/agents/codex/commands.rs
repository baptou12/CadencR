use codex_app_server_sdk_rs::{CodexAppServerClient, CodexCommandKind};

use super::app_server_spawn_options;
use super::timeouts::{with_probe_timeout, PROBE_TIMEOUT};
use crate::domain::agents::adapter::{RuntimeError, RuntimeSlashCommand, RuntimeSlashCommandKind};

impl From<CodexCommandKind> for RuntimeSlashCommandKind {
    fn from(kind: CodexCommandKind) -> Self {
        match kind {
            CodexCommandKind::Command => Self::Command,
            CodexCommandKind::Skill => Self::Skill,
        }
    }
}

pub(super) async fn runtime_slash_commands(
    cwd: &str,
) -> Result<Vec<RuntimeSlashCommand>, RuntimeError> {
    let client = CodexAppServerClient::spawn_with_options(app_server_spawn_options(None))
        .await
        .map_err(RuntimeError::from)?;
    let result = async {
        client.initialize_with_timeout(PROBE_TIMEOUT).await?;
        with_probe_timeout("Codex skills/list", client.list_commands_in_directory(cwd)).await
    }
    .await;
    client.shutdown().await;
    Ok(result?
        .into_iter()
        .map(|command| RuntimeSlashCommand {
            name: command.name,
            description: command.description,
            kind: command.kind.into(),
        })
        .collect())
}
