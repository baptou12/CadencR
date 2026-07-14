use std::collections::HashMap;

use tokio::sync::RwLock;

use crate::domain::agents::adapter::RuntimeSlashCommand;

const MAX_SNAPSHOTS: usize = 64;

#[derive(Default)]
pub(crate) struct SlashCommandSnapshots {
    state: RwLock<SnapshotState>,
}

#[derive(Default)]
struct SnapshotState {
    generation: u64,
    entries: HashMap<String, Snapshot>,
}

struct Snapshot {
    generation: u64,
    commands: Vec<RuntimeSlashCommand>,
}

impl SlashCommandSnapshots {
    pub(crate) async fn record(&self, cwd: &str, commands: Vec<RuntimeSlashCommand>) {
        let mut state = self.state.write().await;
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        state.entries.insert(
            cwd.to_string(),
            Snapshot {
                generation,
                commands,
            },
        );
        if state.entries.len() > MAX_SNAPSHOTS {
            let oldest = state
                .entries
                .iter()
                .min_by_key(|(_, snapshot)| snapshot.generation)
                .map(|(cwd, _)| cwd.clone());
            if let Some(oldest) = oldest {
                state.entries.remove(&oldest);
            }
        }
    }

    pub(crate) async fn get(&self, cwd: &str) -> Vec<RuntimeSlashCommand> {
        self.state
            .read()
            .await
            .entries
            .get(cwd)
            .map(|snapshot| snapshot.commands.clone())
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(crate) async fn clear(&self) {
        self.state.write().await.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{SlashCommandSnapshots, MAX_SNAPSHOTS};
    use crate::domain::agents::adapter::{RuntimeSlashCommand, RuntimeSlashCommandKind};

    fn command(name: &str) -> RuntimeSlashCommand {
        RuntimeSlashCommand {
            name: name.to_string(),
            description: None,
            kind: RuntimeSlashCommandKind::Command,
        }
    }

    #[tokio::test]
    async fn evicts_the_oldest_cwd_snapshot() {
        let snapshots = SlashCommandSnapshots::default();
        for index in 0..=MAX_SNAPSHOTS {
            snapshots
                .record(&format!("/project-{index}"), vec![command("test")])
                .await;
        }

        assert!(snapshots.get("/project-0").await.is_empty());
        assert_eq!(snapshots.get("/project-64").await[0].name, "test");
    }
}
