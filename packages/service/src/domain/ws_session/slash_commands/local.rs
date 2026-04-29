use std::collections::HashSet;
use std::path::Path;

use super::SlashCommand;

#[derive(Debug, Default)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
    user_invocable: Option<bool>,
}

pub(super) fn collect_local_commands(cwd: &str) -> Vec<SlashCommand> {
    collect_local_entries(cwd, true)
}

pub(super) fn collect_local_skill_commands(cwd: &str) -> Vec<SlashCommand> {
    collect_local_entries(cwd, false)
}

fn collect_local_entries(cwd: &str, include_commands: bool) -> Vec<SlashCommand> {
    let mut commands = Vec::new();
    let mut seen = HashSet::new();

    for base in project_ancestors(Path::new(cwd)) {
        scan_project_base(&base, include_commands, &mut commands, &mut seen);
    }

    if let Some(home) = dirs::home_dir() {
        if include_commands {
            scan_commands_dir(
                &home.join(".config/opencode/commands"),
                &mut commands,
                &mut seen,
            );
            scan_commands_dir(&home.join(".claude/commands"), &mut commands, &mut seen);
        }
        scan_skills_dir(
            &home.join(".config/opencode/skills"),
            &mut commands,
            &mut seen,
        );
        scan_skills_dir(&home.join(".agents/skills"), &mut commands, &mut seen);
        scan_skills_dir(&home.join(".claude/skills"), &mut commands, &mut seen);
    }

    commands
}

fn project_ancestors(cwd: &Path) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    let mut current = Some(cwd);

    while let Some(dir) = current {
        dirs.push(dir.to_path_buf());
        if dir.join(".git").exists() {
            break;
        }
        current = dir.parent();
    }

    dirs
}

fn scan_project_base(
    base: &Path,
    include_commands: bool,
    commands: &mut Vec<SlashCommand>,
    seen: &mut HashSet<String>,
) {
    if include_commands {
        scan_commands_dir(&base.join(".opencode/commands"), commands, seen);
        scan_commands_dir(&base.join(".claude/commands"), commands, seen);
    }
    scan_skills_dir(&base.join(".opencode/skills"), commands, seen);
    scan_skills_dir(&base.join(".agents/skills"), commands, seen);
    scan_skills_dir(&base.join(".claude/skills"), commands, seen);
}

fn scan_commands_dir(dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_commands_dir(&path, commands, seen);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }

        let Some(file_stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if seen.contains(file_stem) {
            continue;
        }

        let metadata = read_frontmatter(&path).unwrap_or_default();
        let name = metadata.name.unwrap_or_else(|| file_stem.to_string());
        if seen.insert(name.clone()) {
            commands.push(SlashCommand {
                name,
                description: metadata.description,
            });
        }
    }
}

fn scan_skills_dir(dir: &Path, commands: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let file_stem = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let metadata = read_frontmatter(&path.join("SKILL.md")).unwrap_or_default();
        if metadata.user_invocable == Some(false) {
            continue;
        }

        let name = metadata.name.unwrap_or_else(|| file_stem.to_string());
        if seen.insert(name.clone()) {
            commands.push(SlashCommand {
                name,
                description: metadata.description,
            });
        }
    }
}

fn read_frontmatter(path: &Path) -> Option<Frontmatter> {
    let content = std::fs::read_to_string(path).ok()?;
    parse_frontmatter(&content)
}

fn parse_frontmatter(content: &str) -> Option<Frontmatter> {
    let body = content.strip_prefix("---\n")?;
    let end = body.find("\n---")?;
    let block = &body[..end];
    let lines: Vec<&str> = block.lines().collect();
    let mut parsed = Frontmatter::default();
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index].trim_end();
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            index += 1;
            continue;
        };

        let key = raw_key.trim();
        let value = raw_value.trim();
        let parsed_value = if matches!(value, ">" | "|") {
            index += 1;
            collect_block_value(&lines, &mut index)
        } else {
            index += 1;
            normalize_value(value)
        };

        match key {
            "name" => parsed.name = Some(parsed_value),
            "description" => parsed.description = Some(parsed_value),
            "user-invocable" => parsed.user_invocable = Some(parsed_value != "false"),
            _ => {}
        }
    }

    Some(parsed)
}

fn collect_block_value(lines: &[&str], index: &mut usize) -> String {
    let mut collected = Vec::new();
    while *index < lines.len() {
        let line = lines[*index];
        if !(line.starts_with(' ') || line.starts_with('\t') || line.trim().is_empty()) {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            collected.push(trimmed.to_string());
        }
        *index += 1;
    }

    collected.join(" ")
}

fn normalize_value(raw: &str) -> String {
    raw.trim_matches('"').trim_matches('\'').to_string()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;

    use tempfile::TempDir;

    use super::{
        collect_local_commands, collect_local_skill_commands, parse_frontmatter, scan_commands_dir,
        scan_skills_dir,
    };

    #[test]
    fn parse_frontmatter_supports_folded_descriptions() {
        let parsed = parse_frontmatter(
            "---\nname: qa\ndescription: >\n  Run QA checks\n  for the active feature\nuser-invocable: true\n---\n",
        )
        .expect("frontmatter");

        assert_eq!(parsed.name.as_deref(), Some("qa"));
        assert_eq!(
            parsed.description.as_deref(),
            Some("Run QA checks for the active feature")
        );
        assert_eq!(parsed.user_invocable, Some(true));
    }

    #[test]
    fn scan_commands_dir_reads_command_markdown() {
        let temp = TempDir::new().unwrap();
        let commands_dir = temp.path().join(".opencode/commands");
        fs::create_dir_all(&commands_dir).unwrap();
        fs::write(
            commands_dir.join("finish-job.md"),
            "---\ndescription: Finish the current change safely\n---\nUse finish-job.",
        )
        .unwrap();

        let mut commands = Vec::new();
        let mut seen = HashSet::new();
        scan_commands_dir(&commands_dir, &mut commands, &mut seen);

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "finish-job");
        assert_eq!(
            commands[0].description.as_deref(),
            Some("Finish the current change safely")
        );
    }

    #[test]
    fn scan_skills_dir_skips_non_invocable_skills() {
        let temp = TempDir::new().unwrap();
        let skills_dir = temp.path().join(".agents/skills");
        let hidden_skill = skills_dir.join("hidden");
        fs::create_dir_all(&hidden_skill).unwrap();
        fs::write(
            hidden_skill.join("SKILL.md"),
            "---\nname: hidden\ndescription: Hidden skill\nuser-invocable: false\n---\n",
        )
        .unwrap();

        let mut commands = Vec::new();
        let mut seen = HashSet::new();
        scan_skills_dir(&skills_dir, &mut commands, &mut seen);

        assert!(commands.is_empty());
    }

    #[test]
    fn collect_local_commands_walks_up_to_git_root() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join(".git")).unwrap();

        let root_commands = temp.path().join(".opencode/commands");
        fs::create_dir_all(&root_commands).unwrap();
        fs::write(root_commands.join("finish-job.md"), "Finish job").unwrap();

        let nested = temp.path().join("packages/desktop");
        let nested_skills = nested.join(".agents/skills/db");
        fs::create_dir_all(&nested_skills).unwrap();
        fs::write(
            nested_skills.join("SKILL.md"),
            "---\nname: db\ndescription: Query Cadencr DB\n---\n",
        )
        .unwrap();

        let commands = collect_local_commands(nested.to_str().unwrap());

        assert!(commands.iter().any(|command| command.name == "finish-job"));
        assert!(commands.iter().any(|command| command.name == "db"));
    }

    #[test]
    fn collect_local_skill_commands_excludes_command_markdown() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join(".git")).unwrap();
        fs::create_dir_all(temp.path().join(".opencode/commands")).unwrap();
        fs::write(temp.path().join(".opencode/commands/review.md"), "Review").unwrap();

        let skill_dir = temp.path().join(".agents/skills/finish-job");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: finish-job\ndescription: Finish work\n---\n",
        )
        .unwrap();

        let commands = collect_local_skill_commands(temp.path().to_str().unwrap());

        assert!(commands.iter().any(|command| command.name == "finish-job"));
        assert!(!commands.iter().any(|command| command.name == "review"));
    }
}
