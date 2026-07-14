use std::sync::OnceLock;

use crate::domain::agents::acp::runtime::slash_command_snapshots::SlashCommandSnapshots;
use crate::domain::agents::adapter::{RuntimeError, RuntimeSlashCommand};

static SNAPSHOTS: OnceLock<SlashCommandSnapshots> = OnceLock::new();

fn snapshots() -> &'static SlashCommandSnapshots {
    SNAPSHOTS.get_or_init(SlashCommandSnapshots::default)
}

pub(super) async fn record_snapshot(cwd: &str, commands: Vec<RuntimeSlashCommand>) {
    snapshots().record(cwd, commands).await;
}

pub(super) async fn runtime_slash_commands(
    cwd: &str,
) -> Result<Vec<RuntimeSlashCommand>, RuntimeError> {
    Ok(snapshots().get(cwd).await)
}

#[cfg(test)]
mod tests {
    use super::{record_snapshot, runtime_slash_commands};
    use crate::domain::agents::adapter::{RuntimeSlashCommand, RuntimeSlashCommandKind};

    #[tokio::test]
    async fn records_commands_per_cwd() {
        record_snapshot(
            "/cursor-project",
            vec![RuntimeSlashCommand {
                name: "compress".to_string(),
                description: Some("Compress context".to_string()),
                kind: RuntimeSlashCommandKind::Command,
            }],
        )
        .await;
        let commands = runtime_slash_commands("/cursor-project").await.unwrap();
        assert_eq!(commands[0].name, "compress");
    }
}
