mod local;

use std::collections::HashSet;

use tracing::{debug, warn};

use crate::domain::agents::adapter::RuntimeSlashCommandDiscovery;
use crate::domain::agents::runtime_adapter;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
}

pub async fn resolve_commands(cwd: &str, provider: Option<&str>) -> Vec<SlashCommand> {
    let mut commands = Vec::new();
    let mut seen = HashSet::new();

    merge_commands(&mut commands, &mut seen, builtin_commands(provider));

    match slash_discovery(provider) {
        RuntimeSlashCommandDiscovery::LocalFilesystem => {
            merge_commands(&mut commands, &mut seen, local::collect_local_commands(cwd));
        }
        RuntimeSlashCommandDiscovery::RuntimeNative => match opencode_commands(cwd).await {
            Ok(native_commands) => {
                merge_commands(&mut commands, &mut seen, native_commands);
                merge_commands(
                    &mut commands,
                    &mut seen,
                    local::collect_local_skill_commands(cwd),
                );
            }
            Err(error) => {
                warn!(cwd, error = %error, "failed to load commands from OpenCode; falling back to local discovery");
                merge_commands(&mut commands, &mut seen, local::collect_local_commands(cwd));
            }
        },
    }
    commands
}

/// Provider-specific built-in slash commands that aren't discovered through
/// filesystem scanning. Kept isolated per provider to avoid spreading
/// provider-specific branching through the generic resolver.
fn builtin_commands(provider: Option<&str>) -> Vec<SlashCommand> {
    let Some(provider) = provider else {
        return Vec::new();
    };
    let Some(adapter) = runtime_adapter(provider) else {
        return Vec::new();
    };
    if adapter.supports_builtin_compact_command() {
        return vec![SlashCommand {
            name: "compact".to_string(),
            description: Some(
                "Compact the conversation, freeing context while keeping a summary".to_string(),
            ),
        }];
    }
    Vec::new()
}

fn slash_discovery(provider: Option<&str>) -> RuntimeSlashCommandDiscovery {
    provider
        .and_then(runtime_adapter)
        .map(|adapter| adapter.slash_command_discovery())
        .unwrap_or(RuntimeSlashCommandDiscovery::LocalFilesystem)
}

async fn opencode_commands(cwd: &str) -> Result<Vec<SlashCommand>, opencode_sdk_rs::SdkError> {
    let client = opencode_sdk_rs::OpenCodeClient::init().await?;
    let commands = client.list_commands_in_directory(Some(cwd)).await?;

    Ok(commands
        .into_iter()
        .map(|command| SlashCommand {
            name: command.name,
            description: command.description,
        })
        .collect())
}

fn merge_commands(
    resolved: &mut Vec<SlashCommand>,
    seen: &mut HashSet<String>,
    candidates: Vec<SlashCommand>,
) {
    for command in candidates {
        if seen.insert(command.name.clone()) {
            debug!(name = %command.name, "resolved slash command");
            resolved.push(command);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{builtin_commands, merge_commands, SlashCommand};

    #[test]
    fn builtin_commands_injects_compact_for_supported_providers() {
        for provider in [
            crate::domain::agents::claude_code::PROVIDER_ID,
            crate::domain::agents::opencode::PROVIDER_ID,
            crate::domain::agents::codex::PROVIDER_ID,
        ] {
            let commands = builtin_commands(Some(provider));
            assert!(commands.iter().any(|command| command.name == "compact"));
        }
    }

    #[test]
    fn builtin_commands_is_empty_for_other_providers() {
        assert!(builtin_commands(Some("openai")).is_empty());
        assert!(builtin_commands(None).is_empty());
    }

    #[test]
    fn merge_commands_keeps_first_description() {
        let mut resolved = vec![SlashCommand {
            name: "review".to_string(),
            description: Some("OpenCode review".to_string()),
        }];
        let mut seen = HashSet::from(["review".to_string()]);

        merge_commands(
            &mut resolved,
            &mut seen,
            vec![SlashCommand {
                name: "review".to_string(),
                description: Some("Fallback review".to_string()),
            }],
        );

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].description.as_deref(), Some("OpenCode review"));
    }
}
