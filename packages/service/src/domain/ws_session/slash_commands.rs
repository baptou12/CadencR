//! Slash command resolution without spawning a CLI subprocess.
//!
//! Commands are resolved from three sources:
//! 1. **Bundled commands** — hardcoded commands that ship with Claude Code
//! 2. **Plugin commands** — from `~/.claude/plugins/marketplaces/` (commands/, skills/, agents/)
//! 3. **Custom commands** — from `.claude/commands/` and `.claude/skills/` at project
//!    level (cwd up to git root) and user level (`~/.claude/`)

use std::collections::HashSet;
use std::path::Path;
use tracing::debug;

/// A resolved slash command with name and optional description.
#[derive(Debug, Clone)]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
}

/// Bundled commands that ship with Claude Code.
/// These are native to the runtime and cannot be discovered from disk.
fn bundled_commands() -> Vec<SlashCommand> {
    let commands = [
        ("clear", "Clear conversation context and start fresh"),
        ("compact", "Compact conversation with optional focus instructions"),
        ("simplify", "Review changed code for reuse, quality, and efficiency, then fix any issues found"),
        ("review", "Review code changes for bugs, quality, and best practices"),
        ("loop", "Run a prompt or slash command on a recurring interval"),
        ("batch", "Run multiple tasks in parallel"),
        ("insights", "Generate insights from the current conversation"),
        ("btw", "Send a background task while continuing the current conversation"),
    ];

    commands
        .into_iter()
        .map(|(name, desc)| SlashCommand {
            name: name.to_string(),
            description: Some(desc.to_string()),
        })
        .collect()
}

/// Return all available slash commands for the given working directory.
///
/// Resolution order (first seen wins for deduplication):
/// 1. Bundled commands
/// 2. Project-level custom commands (cwd → git root)
/// 3. User-level custom commands (`~/.claude/commands/`, `~/.claude/skills/`)
/// 4. Installed plugin commands (`~/.claude/plugins/marketplaces/`)
pub async fn resolve_commands(cwd: &str) -> Vec<SlashCommand> {
    let mut commands = bundled_commands();
    let mut seen: HashSet<String> = commands.iter().map(|c| c.name.clone()).collect();

    // Walk from cwd upward to the git root, scanning each directory
    // for `.claude/commands/` and `.claude/skills/`.
    let cwd_path = Path::new(cwd);
    let mut dir = Some(cwd_path);
    while let Some(current) = dir {
        scan_into(current, &mut commands, &mut seen);

        // Stop at git root
        if current.join(".git").exists() {
            break;
        }
        dir = current.parent();
    }

    // Scan user-level custom commands
    if let Some(home) = dirs::home_dir() {
        let home_claude = home.join(".claude");
        scan_commands_dir(&home_claude.join("commands"), &mut commands, &mut seen);
        scan_skills_dir(&home_claude.join("skills"), &mut commands, &mut seen);

        // Scan installed plugins
        let plugins_dir = home_claude.join("plugins");
        scan_plugins(&plugins_dir.join("marketplaces"), &mut commands, &mut seen);
        scan_cached_plugins(&plugins_dir.join("cache"), &mut commands, &mut seen);
    }

    commands
}

/// Scan both `.claude/commands/` and `.claude/skills/` under the given directory.
fn scan_into(base: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let claude_dir = base.join(".claude");
    scan_commands_dir(&claude_dir.join("commands"), commands, seen);
    scan_skills_dir(&claude_dir.join("skills"), commands, seen);
}

/// Scan all installed plugins under `~/.claude/plugins/marketplaces/`.
///
/// Structure: `marketplaces/<marketplace>/{plugins,external_plugins}/<plugin-name>/`
/// Each plugin can contain `commands/`, `skills/`, and `agents/` directories.
fn scan_plugins(marketplaces_dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let marketplaces = match std::fs::read_dir(marketplaces_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for marketplace in marketplaces.flatten() {
        let marketplace_path = marketplace.path();
        if !marketplace_path.is_dir() {
            continue;
        }

        // Scan both `plugins/` and `external_plugins/` subdirectories
        for sub in &["plugins", "external_plugins"] {
            let plugins_dir = marketplace_path.join(sub);
            let plugins = match std::fs::read_dir(&plugins_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for plugin in plugins.flatten() {
                let plugin_path = plugin.path();
                if !plugin_path.is_dir() {
                    continue;
                }
                scan_plugin(&plugin_path, commands, seen);
            }
        }
    }
}

/// Scan a single plugin directory for commands/, skills/, and agents/.
fn scan_plugin(plugin_dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    scan_plugin_with_prefix(plugin_dir, None, commands, seen);
}

/// Scan a single plugin directory, optionally prefixing command names with `prefix:`.
fn scan_plugin_with_prefix(
    plugin_dir: &Path,
    prefix: Option<&str>,
    commands: &mut Vec<SlashCommand>,
    seen: &mut HashSet<String>,
) {
    let mut plugin_cmds: Vec<SlashCommand> = Vec::new();
    let mut plugin_seen: HashSet<String> = HashSet::new();

    scan_commands_dir(&plugin_dir.join("commands"), &mut plugin_cmds, &mut plugin_seen);
    scan_skills_dir(&plugin_dir.join("skills"), &mut plugin_cmds, &mut plugin_seen);
    scan_agents_dir(&plugin_dir.join("agents"), &mut plugin_cmds, &mut plugin_seen);

    for mut cmd in plugin_cmds {
        if let Some(p) = prefix {
            cmd.name = format!("{p}:{}", cmd.name);
        }
        if !seen.contains(&cmd.name) {
            seen.insert(cmd.name.clone());
            commands.push(cmd);
        }
    }
}

/// Scan cached plugins under `~/.claude/plugins/cache/`.
///
/// Structure: `cache/<marketplace>/<plugin>/<version>/`
/// Commands are prefixed with the plugin name (e.g., `superpowers:brainstorming`).
fn scan_cached_plugins(cache_dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let marketplaces = match std::fs::read_dir(cache_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for marketplace in marketplaces.flatten() {
        if !marketplace.path().is_dir() {
            continue;
        }

        let plugins = match std::fs::read_dir(marketplace.path()) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for plugin in plugins.flatten() {
            let plugin_path = plugin.path();
            if !plugin_path.is_dir() {
                continue;
            }

            let plugin_name = plugin
                .file_name()
                .to_str()
                .unwrap_or_default()
                .to_string();

            // Find the latest version directory (there's typically only one)
            let version_dir = match latest_version_dir(&plugin_path) {
                Some(d) => d,
                None => continue,
            };

            scan_plugin_with_prefix(&version_dir, Some(&plugin_name), commands, seen);
        }
    }
}

/// Return the latest (lexicographically greatest) version subdirectory.
fn latest_version_dir(plugin_dir: &Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(plugin_dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .max_by_key(|e| e.file_name())
        .map(|e| e.path())
}

/// Scan a `.claude/commands/` directory tree for custom commands (`.md` files).
/// Recurses into subdirectories (namespaced commands).
fn scan_commands_dir(dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_commands_dir(&path, commands, seen);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                if seen.contains(name) {
                    continue;
                }
                let description = parse_frontmatter_file(&path)
                    .and_then(|fm| fm.get("description").cloned());
                debug!(name, ?description, "Discovered custom command");
                seen.insert(name.to_string());
                commands.push(SlashCommand {
                    name: name.to_string(),
                    description,
                });
            }
        }
    }
}

/// Scan a `.claude/skills/` directory for skill-based commands.
/// Each subdirectory with a `SKILL.md` is a skill.
fn scan_skills_dir(dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();

        // Try to read SKILL.md directly (no existence pre-check to avoid TOCTOU)
        let skill_md = path.join("SKILL.md");
        let frontmatter = match parse_frontmatter_file(&skill_md) {
            Some(fm) => fm,
            None => continue,
        };

        let name = frontmatter.get("name").unwrap_or(&dir_name).clone();
        let description = frontmatter.get("description").cloned();
        let user_invocable = frontmatter.get("user-invocable").map_or(true, |v| v != "false");

        if !user_invocable || seen.contains(&name) {
            continue;
        }

        debug!(name, ?description, "Discovered skill command");
        seen.insert(name.clone());
        commands.push(SlashCommand { name, description });
    }
}

/// Scan an `agents/` directory for agent-based commands (`.md` files).
/// Agent files use the same frontmatter format as commands (name, description).
fn scan_agents_dir(dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let file_stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };

        let frontmatter = match parse_frontmatter_file(&path) {
            Some(fm) => fm,
            None => continue,
        };

        let name = frontmatter.get("name").unwrap_or(&file_stem).clone();
        let description = frontmatter.get("description").cloned();

        if seen.contains(&name) {
            continue;
        }

        debug!(name, ?description, "Discovered agent command");
        seen.insert(name.clone());
        commands.push(SlashCommand { name, description });
    }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

use std::collections::HashMap;

/// Parse YAML frontmatter from a markdown file into a key→value map.
///
/// Returns `None` if the file cannot be read or has no valid `---` delimited
/// frontmatter block. Values are trimmed and unquoted.
fn parse_frontmatter_file(path: &Path) -> Option<HashMap<String, String>> {
    let content = std::fs::read_to_string(path).ok()?;
    parse_frontmatter(&content)
}

/// Extract frontmatter fields from markdown content.
fn parse_frontmatter(content: &str) -> Option<HashMap<String, String>> {
    if !content.starts_with("---") {
        return None;
    }

    let rest = &content[3..];
    let end = rest.find("\n---")?;
    let block = &rest[..end];

    let mut fields = HashMap::new();
    for line in block.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let val = val.trim().trim_matches('"').trim_matches('\'');
            if !key.is_empty() && !val.is_empty() {
                fields.insert(key.to_string(), val.to_string());
            }
        }
    }

    Some(fields)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn bundled_commands_present() {
        let cmds = bundled_commands();
        assert!(cmds.iter().any(|c| c.name == "clear"));
        assert!(cmds.iter().any(|c| c.name == "simplify"));
        assert!(cmds.iter().any(|c| c.name == "loop"));
        assert!(cmds.iter().any(|c| c.name == "compact"));
        assert!(cmds.iter().any(|c| c.name == "review"));
        assert!(cmds.iter().any(|c| c.name == "btw"));
        assert!(cmds.iter().any(|c| c.name == "batch"));
        assert!(cmds.iter().any(|c| c.name == "insights"));
    }

    #[test]
    fn scan_commands_dir_discovers_md_files() {
        let tmp = TempDir::new().unwrap();
        let cmd_dir = tmp.path().join(".claude/commands");
        fs::create_dir_all(&cmd_dir).unwrap();
        fs::write(
            cmd_dir.join("deploy.md"),
            "---\ndescription: Deploy the app\n---\nDeploy instructions here",
        )
        .unwrap();
        fs::write(cmd_dir.join("test.md"), "Run all tests").unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_commands_dir(&cmd_dir, &mut commands, &mut seen);

        assert_eq!(commands.len(), 2);
        let deploy = commands.iter().find(|c| c.name == "deploy").unwrap();
        assert_eq!(deploy.description.as_deref(), Some("Deploy the app"));
        let test = commands.iter().find(|c| c.name == "test").unwrap();
        assert_eq!(test.description, None);
    }

    #[test]
    fn scan_commands_dir_recurses_subdirectories() {
        let tmp = TempDir::new().unwrap();
        let cmd_dir = tmp.path().join(".claude/commands");
        let sub_dir = cmd_dir.join("frontend");
        fs::create_dir_all(&sub_dir).unwrap();
        fs::write(
            sub_dir.join("component.md"),
            "---\ndescription: Create a component\n---\n",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_commands_dir(&cmd_dir, &mut commands, &mut seen);

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "component");
    }

    #[test]
    fn scan_skills_dir_discovers_skill_md() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join(".claude/skills");
        let skill_dir = skills_dir.join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: Does something cool\n---\nInstructions",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_skills_dir(&skills_dir, &mut commands, &mut seen);

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "my-skill");
        assert_eq!(
            commands[0].description.as_deref(),
            Some("Does something cool")
        );
    }

    #[test]
    fn scan_skills_dir_skips_non_user_invocable() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join(".claude/skills");
        let skill_dir = skills_dir.join("hidden-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: hidden-skill\ndescription: Background knowledge\nuser-invocable: false\n---\n",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_skills_dir(&skills_dir, &mut commands, &mut seen);

        assert!(commands.is_empty());
    }

    #[test]
    fn scan_agents_dir_discovers_agent_md() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(
            agents_dir.join("code-simplifier.md"),
            "---\nname: code-simplifier\ndescription: Simplifies code\n---\nInstructions",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_agents_dir(&agents_dir, &mut commands, &mut seen);

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "code-simplifier");
        assert_eq!(
            commands[0].description.as_deref(),
            Some("Simplifies code")
        );
    }

    #[test]
    fn scan_plugins_discovers_all_plugin_types() {
        let tmp = TempDir::new().unwrap();

        // Create marketplace > plugins > plugin with commands/, skills/, agents/
        let plugin_dir = tmp.path().join("my-marketplace/plugins/my-plugin");

        let cmd_dir = plugin_dir.join("commands");
        fs::create_dir_all(&cmd_dir).unwrap();
        fs::write(
            cmd_dir.join("deploy.md"),
            "---\ndescription: Deploy\n---\n",
        )
        .unwrap();

        let skill_dir = plugin_dir.join("skills/my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A skill\n---\n",
        )
        .unwrap();

        let agents_dir = plugin_dir.join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(
            agents_dir.join("my-agent.md"),
            "---\nname: my-agent\ndescription: An agent\n---\n",
        )
        .unwrap();

        // Create an external_plugins entry too
        let ext_plugin_dir = tmp.path().join("my-marketplace/external_plugins/ext-plugin");
        let ext_cmd_dir = ext_plugin_dir.join("commands");
        fs::create_dir_all(&ext_cmd_dir).unwrap();
        fs::write(
            ext_cmd_dir.join("ext-cmd.md"),
            "---\ndescription: External command\n---\n",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_plugins(tmp.path(), &mut commands, &mut seen);

        assert!(commands.iter().any(|c| c.name == "deploy"), "missing deploy");
        assert!(commands.iter().any(|c| c.name == "my-skill"), "missing my-skill");
        assert!(commands.iter().any(|c| c.name == "my-agent"), "missing my-agent");
        assert!(commands.iter().any(|c| c.name == "ext-cmd"), "missing ext-cmd");
        assert_eq!(commands.len(), 4);
    }

    #[test]
    fn parse_frontmatter_extracts_fields() {
        let fm = parse_frontmatter("---\nname: my-cmd\ndescription: Does things\n---\nbody");
        let fm = fm.unwrap();
        assert_eq!(fm.get("name").unwrap(), "my-cmd");
        assert_eq!(fm.get("description").unwrap(), "Does things");
    }

    #[test]
    fn parse_frontmatter_returns_none_without_delimiters() {
        assert!(parse_frontmatter("Just plain content").is_none());
    }

    #[test]
    fn deduplication_respects_priority() {
        let tmp = TempDir::new().unwrap();

        let cmd_dir = tmp.path().join(".claude/commands");
        fs::create_dir_all(&cmd_dir).unwrap();
        fs::write(
            cmd_dir.join("deploy.md"),
            "---\ndescription: Deploy via command\n---\n",
        )
        .unwrap();

        let skill_dir = tmp.path().join(".claude/skills/deploy");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deploy\ndescription: Deploy via skill\n---\n",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();

        scan_commands_dir(&cmd_dir, &mut commands, &mut seen);
        scan_skills_dir(&tmp.path().join(".claude/skills"), &mut commands, &mut seen);

        let deploys: Vec<_> = commands.iter().filter(|c| c.name == "deploy").collect();
        assert_eq!(deploys.len(), 1);
        assert_eq!(deploys[0].description.as_deref(), Some("Deploy via command"));
    }

    #[test]
    fn scan_cached_plugins_discovers_versioned_plugins() {
        let tmp = TempDir::new().unwrap();

        // cache/<marketplace>/<plugin>/<version>/skills/my-skill/SKILL.md
        let skill_dir = tmp
            .path()
            .join("my-marketplace/superpowers/5.0.6/skills/brainstorming");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: brainstorming\ndescription: Brainstorm ideas\n---\n",
        )
        .unwrap();

        // Also add a command
        let cmd_dir = tmp
            .path()
            .join("my-marketplace/superpowers/5.0.6/commands");
        fs::create_dir_all(&cmd_dir).unwrap();
        fs::write(
            cmd_dir.join("write-plan.md"),
            "---\ndescription: Write a plan\n---\n",
        )
        .unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_cached_plugins(tmp.path(), &mut commands, &mut seen);

        assert!(
            commands.iter().any(|c| c.name == "superpowers:brainstorming"),
            "missing superpowers:brainstorming"
        );
        assert!(
            commands.iter().any(|c| c.name == "superpowers:write-plan"),
            "missing superpowers:write-plan"
        );
        assert_eq!(commands.len(), 2);
    }

    #[test]
    fn scan_cached_plugins_picks_latest_version() {
        let tmp = TempDir::new().unwrap();

        // Two versions: 1.0.0 has old-cmd, 2.0.0 has new-cmd
        let old_dir = tmp.path().join("mk/my-plugin/1.0.0/commands");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("old.md"), "---\ndescription: Old\n---\n").unwrap();

        let new_dir = tmp.path().join("mk/my-plugin/2.0.0/commands");
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(new_dir.join("new.md"), "---\ndescription: New\n---\n").unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_cached_plugins(tmp.path(), &mut commands, &mut seen);

        // Should only scan the latest (2.0.0)
        assert!(commands.iter().any(|c| c.name == "my-plugin:new"));
        assert!(!commands.iter().any(|c| c.name == "my-plugin:old"));
    }

    #[test]
    fn scan_plugin_with_prefix_applies_namespace() {
        let tmp = TempDir::new().unwrap();

        let cmd_dir = tmp.path().join("commands");
        fs::create_dir_all(&cmd_dir).unwrap();
        fs::write(cmd_dir.join("deploy.md"), "---\ndescription: Deploy\n---\n").unwrap();

        let mut commands = vec![];
        let mut seen = HashSet::new();
        scan_plugin_with_prefix(tmp.path(), Some("myplugin"), &mut commands, &mut seen);

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "myplugin:deploy");
    }

    #[tokio::test]
    async fn resolve_commands_includes_bundled() {
        let tmp = TempDir::new().unwrap();
        let commands = resolve_commands(tmp.path().to_str().unwrap()).await;
        assert!(commands.iter().any(|c| c.name == "clear"));
        assert!(commands.iter().any(|c| c.name == "simplify"));
        assert!(commands.iter().any(|c| c.name == "loop"));
    }

    #[tokio::test]
    async fn resolve_commands_walks_ancestors() {
        let tmp = TempDir::new().unwrap();

        fs::create_dir_all(tmp.path().join(".git")).unwrap();

        let skill_dir = tmp.path().join(".claude/skills/root-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: root-skill\ndescription: From root\n---\n",
        )
        .unwrap();

        let nested = tmp.path().join("packages/frontend");
        fs::create_dir_all(&nested).unwrap();

        let nested_cmd = nested.join(".claude/commands");
        fs::create_dir_all(&nested_cmd).unwrap();
        fs::write(nested_cmd.join("local.md"), "Local command").unwrap();

        let commands = resolve_commands(nested.to_str().unwrap()).await;
        assert!(commands.iter().any(|c| c.name == "root-skill"));
        assert!(commands.iter().any(|c| c.name == "local"));
        assert!(commands.iter().any(|c| c.name == "clear"));
    }
}
