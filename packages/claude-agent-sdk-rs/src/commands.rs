use crate::error::SdkError;
use crate::types::SlashCommand;
use std::collections::HashSet;
use std::path::PathBuf;

mod builtins;
mod filesystem;
mod plugins;

#[derive(Default)]
struct CommandCollector {
    commands: Vec<SlashCommand>,
    seen: HashSet<String>,
}

impl CommandCollector {
    fn add(&mut self, name: impl Into<String>, description: Option<String>) {
        let name = name.into();
        if self.seen.insert(name.clone()) {
            self.commands.push(SlashCommand { name, description });
        }
    }

    fn into_commands(self) -> Vec<SlashCommand> {
        self.commands
    }
}

/// List Claude Code slash commands available for `cwd`.
pub async fn list_commands(
    cwd: &str,
    _path_to_cli: Option<&std::path::Path>,
) -> Result<Vec<SlashCommand>, SdkError> {
    list_commands_with_home(cwd, home_dir()).await
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

async fn list_commands_with_home(
    cwd: &str,
    home: Option<PathBuf>,
) -> Result<Vec<SlashCommand>, SdkError> {
    let mut collector = CommandCollector::default();
    filesystem::collect_filesystem_commands(&mut collector, cwd, home.as_deref())?;
    collect_builtin_commands(&mut collector);
    Ok(collector.into_commands())
}

fn collect_builtin_commands(collector: &mut CommandCollector) {
    for (name, description) in builtins::BUILTIN_COMMANDS {
        collector.add(*name, Some((*description).to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::list_commands_with_home;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn includes_documented_builtin_commands() {
        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        let names: Vec<&str> = commands
            .iter()
            .map(|command| command.name.as_str())
            .collect();
        assert!(names.contains(&"compact"));
        assert!(names.contains(&"help"));
        assert!(names.contains(&"plugin"));
        assert!(names.contains(&"simplify"));
    }

    #[tokio::test]
    async fn discovers_project_and_personal_commands_and_skills() {
        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();

        fs::create_dir_all(workspace.path().join(".claude/commands/frontend")).unwrap();
        fs::write(
            workspace
                .path()
                .join(".claude/commands/frontend/component.md"),
            "---\ndescription: Build a component\n---\nBody",
        )
        .unwrap();
        fs::create_dir_all(workspace.path().join(".claude/skills/review")).unwrap();
        fs::write(
            workspace.path().join(".claude/skills/review/SKILL.md"),
            "---\ndescription: Review project changes\n---\nBody",
        )
        .unwrap();
        fs::create_dir_all(home.path().join(".claude/commands")).unwrap();
        fs::write(
            home.path().join(".claude/commands/security-review.md"),
            "Review security issues",
        )
        .unwrap();
        fs::create_dir_all(home.path().join(".claude/skills/commit")).unwrap();
        fs::write(
            home.path().join(".claude/skills/commit/SKILL.md"),
            "---\ndescription: Create a commit\n---\nBody",
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        let component = commands
            .iter()
            .find(|command| command.name == "component")
            .unwrap();
        assert_eq!(component.description.as_deref(), Some("Build a component"));
        assert!(commands.iter().any(|command| command.name == "review"));
        assert!(commands
            .iter()
            .any(|command| command.name == "security-review"));
        assert!(commands.iter().any(|command| command.name == "commit"));
    }

    #[tokio::test]
    async fn discovers_symlinked_project_skills() {
        use std::os::unix::fs::symlink;

        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let shared_skill = workspace.path().join(".agents/skills/qa");
        fs::create_dir_all(&shared_skill).unwrap();
        fs::write(
            shared_skill.join("SKILL.md"),
            "---\ndescription: Run project QA\n---\nBody",
        )
        .unwrap();
        fs::create_dir_all(workspace.path().join(".claude/skills")).unwrap();
        symlink(
            std::path::Path::new("../../.agents/skills/qa"),
            workspace.path().join(".claude/skills/qa"),
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        let qa = commands
            .iter()
            .find(|command| command.name == "qa")
            .unwrap();
        assert_eq!(qa.description.as_deref(), Some("Run project QA"));
    }

    #[tokio::test]
    async fn lists_custom_and_plugin_commands_before_builtins() {
        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();

        fs::create_dir_all(workspace.path().join(".claude/skills/project-skill")).unwrap();
        fs::write(
            workspace
                .path()
                .join(".claude/skills/project-skill/SKILL.md"),
            "---\ndescription: Project skill\n---\nBody",
        )
        .unwrap();
        let plugin_root = home
            .path()
            .join(".claude/plugins/cache/test-market/superpowers/1.0.0");
        fs::create_dir_all(plugin_root.join("skills/brainstorming")).unwrap();
        fs::write(
            plugin_root.join("skills/brainstorming/SKILL.md"),
            "---\ndescription: Brainstorm\n---\nBody",
        )
        .unwrap();
        fs::create_dir_all(home.path().join(".claude/plugins")).unwrap();
        fs::write(
            home.path().join(".claude/plugins/installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"superpowers@test-market":[{{"installPath":"{}"}}]}}}}"#,
                plugin_root.display()
            ),
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        let custom_index = commands
            .iter()
            .position(|command| command.name == "project-skill")
            .unwrap();
        let plugin_index = commands
            .iter()
            .position(|command| command.name == "superpowers:brainstorming")
            .unwrap();
        let compact_index = commands
            .iter()
            .position(|command| command.name == "compact")
            .unwrap();

        assert!(custom_index < compact_index);
        assert!(plugin_index < compact_index);
    }

    #[tokio::test]
    async fn description_parser_ignores_non_description_frontmatter_fields() {
        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();

        fs::create_dir_all(workspace.path().join(".claude/commands")).unwrap();
        fs::write(
            workspace.path().join(".claude/commands/commit.md"),
            "---\nallowed-tools: Bash(git status:*)\nmodel: sonnet\ndescription: Commit changes\n---\nBody",
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        let commit = commands
            .iter()
            .find(|command| command.name == "commit")
            .unwrap();
        assert_eq!(commit.description.as_deref(), Some("Commit changes"));
    }

    #[tokio::test]
    async fn dangling_command_symlink_does_not_fail_discovery() {
        use std::os::unix::fs::symlink;

        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let commands_dir = home.path().join(".claude/commands");
        fs::create_dir_all(&commands_dir).unwrap();
        symlink(
            home.path().join("missing-source.md"),
            commands_dir.join("missing.md"),
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        assert!(commands.iter().any(|command| command.name == "compact"));
        assert!(!commands.iter().any(|command| command.name == "missing"));
    }

    #[tokio::test]
    async fn discovers_enabled_plugin_commands_from_manifest_install_paths() {
        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let plugin_root = home
            .path()
            .join(".claude/plugins/cache/test-market/superpowers/1.0.0");

        fs::create_dir_all(plugin_root.join("commands")).unwrap();
        fs::write(
            plugin_root.join("commands/plan.md"),
            "---\ndescription: Plan with superpowers\n---\nBody",
        )
        .unwrap();
        fs::create_dir_all(plugin_root.join("skills/debug")).unwrap();
        fs::write(
            plugin_root.join("skills/debug/SKILL.md"),
            "---\ndescription: Debug with superpowers\n---\nBody",
        )
        .unwrap();
        fs::create_dir_all(home.path().join(".claude/plugins")).unwrap();
        fs::write(
            home.path().join(".claude/plugins/installed_plugins.json"),
            format!(
                r#"{{
                  "version": 2,
                  "plugins": {{
                    "superpowers@test-market": [{{
                      "scope": "user",
                      "installPath": "{}",
                      "version": "1.0.0",
                      "lastUpdated": "2026-05-05T00:00:00.000Z"
                    }}]
                  }}
                }}"#,
                plugin_root.display()
            ),
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        let plan = commands
            .iter()
            .find(|command| command.name == "superpowers:plan")
            .unwrap();
        assert_eq!(plan.description.as_deref(), Some("Plan with superpowers"));
        assert!(commands
            .iter()
            .any(|command| command.name == "superpowers:debug"));
    }

    #[tokio::test]
    async fn discovers_multiple_marketplace_plugin_skills() {
        let workspace = TempDir::new().unwrap();
        let home = TempDir::new().unwrap();
        let plugin_root = home
            .path()
            .join(".claude/plugins/cache/claude-plugins-official/superpowers/5.1.0");

        for skill in [
            "brainstorming",
            "systematic-debugging",
            "test-driven-development",
        ] {
            fs::create_dir_all(plugin_root.join("skills").join(skill)).unwrap();
            fs::write(
                plugin_root.join("skills").join(skill).join("SKILL.md"),
                format!("---\ndescription: {skill}\n---\nBody"),
            )
            .unwrap();
        }
        fs::create_dir_all(home.path().join(".claude/plugins")).unwrap();
        fs::write(
            home.path().join(".claude/plugins/installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"superpowers@claude-plugins-official":[{{"installPath":"{}"}}]}}}}"#,
                plugin_root.display()
            ),
        )
        .unwrap();

        let commands = list_commands_with_home(
            workspace.path().to_str().unwrap(),
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap();

        for name in [
            "superpowers:brainstorming",
            "superpowers:systematic-debugging",
            "superpowers:test-driven-development",
        ] {
            assert!(
                commands.iter().any(|command| command.name == name),
                "missing {name}"
            );
        }
    }
}
