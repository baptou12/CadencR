use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

use super::{ensure_success, OpenCodeClient};
use crate::error::SdkError;
use crate::types::{Command, PromptOptions, PromptPart};

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandInvocation {
    command: String,
    arguments: String,
}

impl OpenCodeClient {
    pub async fn list_commands(&self) -> Result<Vec<Command>, SdkError> {
        self.list_commands_in_directory(None).await
    }

    pub async fn list_commands_in_directory(
        &self,
        directory: Option<&str>,
    ) -> Result<Vec<Command>, SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http.get(format!("{}/command", self.base_url)),
                directory,
            )
            .send()
            .await?;
        let body = ensure_success(response).await?;
        parse_command_list(&body)
    }

    pub async fn run_command_in_directory(
        &self,
        session_id: &str,
        directory: Option<&str>,
        command: &str,
        arguments: &str,
        options: PromptOptions,
    ) -> Result<(), SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/session/{session_id}/command", self.base_url)),
                directory,
            )
            .json(&build_command_payload(command, arguments, options))
            .send()
            .await?;
        ensure_success(response).await.map(|_| ())
    }

    pub async fn send_prompt_or_command_in_directory(
        &self,
        session_id: &str,
        directory: Option<&str>,
        parts: Vec<PromptPart>,
        options: PromptOptions,
    ) -> Result<(), SdkError> {
        if let Some((command, arguments)) = parse_command_invocation(&parts) {
            let invocation = CommandInvocation { command, arguments };
            let fallback_parts = fallback_parts(directory, &invocation, &parts);
            let fallback_options = options.clone();
            return match self
                .run_command_in_directory(
                    session_id,
                    directory,
                    &invocation.command,
                    &invocation.arguments,
                    options,
                )
                .await
            {
                Ok(()) => Ok(()),
                Err(error) if should_fallback_to_prompt(&error) => {
                    self.prompt_async_in_directory(
                        session_id,
                        directory,
                        fallback_parts,
                        fallback_options,
                    )
                    .await
                }
                Err(error) => Err(error),
            };
        }

        self.prompt_async_in_directory(session_id, directory, parts, options)
            .await
    }
}

pub fn parse_command_invocation(parts: &[PromptPart]) -> Option<(String, String)> {
    command_invocation_from_parts(parts)
        .map(|invocation| (invocation.command, invocation.arguments))
}

fn parse_command_list(body: &Value) -> Result<Vec<Command>, SdkError> {
    let array = body
        .as_array()
        .ok_or_else(|| SdkError::Protocol("command list response is not an array".to_string()))?;

    array
        .iter()
        .cloned()
        .map(serde_json::from_value)
        .collect::<Result<Vec<Command>, _>>()
        .map_err(SdkError::from)
}

fn build_command_payload(command: &str, arguments: &str, options: PromptOptions) -> Value {
    let mut payload = Map::new();
    payload.insert("command".to_string(), Value::String(command.to_string()));
    payload.insert(
        "arguments".to_string(),
        Value::String(arguments.to_string()),
    );

    if let Some(agent) = options.agent {
        payload.insert("agent".to_string(), Value::String(agent));
    }
    if let Some(model) = options.model {
        payload.insert(
            "model".to_string(),
            Value::String(format!("{}/{}", model.provider_id, model.model_id)),
        );
    }

    Value::Object(payload)
}

fn command_invocation_from_parts(parts: &[PromptPart]) -> Option<CommandInvocation> {
    match parts {
        [PromptPart::Text { text }] => parse_command_invocation_text(text),
        _ => None,
    }
}

fn parse_command_invocation_text(text: &str) -> Option<CommandInvocation> {
    let raw = text.strip_prefix('/')?;
    if raw.is_empty() || raw.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }

    let split_at = raw.find(char::is_whitespace).unwrap_or(raw.len());
    let command = raw[..split_at].trim();
    if command.is_empty() {
        return None;
    }

    let arguments = raw[split_at..].trim_start().to_string();
    Some(CommandInvocation {
        command: command.to_string(),
        arguments,
    })
}

fn should_fallback_to_prompt(error: &SdkError) -> bool {
    let SdkError::HttpStatus { body, .. } = error else {
        return false;
    };

    let Ok(parsed) = serde_json::from_str::<Value>(body) else {
        return false;
    };

    parsed.get("name").and_then(Value::as_str) == Some("UnknownError")
        && parsed
            .get("data")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .is_some_and(|message| message.starts_with("Command not found:"))
}

fn fallback_parts(
    directory: Option<&str>,
    invocation: &CommandInvocation,
    original_parts: &[PromptPart],
) -> Vec<PromptPart> {
    resolve_local_command_prompt(directory, invocation)
        .map(|text| vec![PromptPart::Text { text }])
        .unwrap_or_else(|| original_parts.to_vec())
}

fn resolve_local_command_prompt(
    directory: Option<&str>,
    invocation: &CommandInvocation,
) -> Option<String> {
    let directory = directory?;
    let source = find_local_command_source(Path::new(directory), &invocation.command)?;

    match source {
        LocalCommandSource::Command(command_path) => {
            let content = std::fs::read_to_string(command_path).ok()?;
            let template = strip_frontmatter(&content).trim();
            if template.is_empty() {
                return None;
            }
            Some(expand_command_template(template, &invocation.arguments))
        }
        LocalCommandSource::Skill => Some(expand_command_template(
            &format!(
                "Use the `{}` skill for this request.\n\nAdditional scope or notes:\n$ARGUMENTS",
                invocation.command
            ),
            &invocation.arguments,
        )),
    }
}

enum LocalCommandSource {
    Command(PathBuf),
    Skill,
}

fn find_local_command_source(start_dir: &Path, command: &str) -> Option<LocalCommandSource> {
    for base in project_ancestors(start_dir) {
        for root in [".opencode/commands", ".claude/commands"] {
            let candidate = base.join(root).join(format!("{command}.md"));
            if candidate.exists() {
                return Some(LocalCommandSource::Command(candidate));
            }
        }
        for root in [".opencode/skills", ".agents/skills", ".claude/skills"] {
            let candidate = base.join(root).join(command).join("SKILL.md");
            if candidate.exists() {
                return Some(LocalCommandSource::Skill);
            }
        }
    }

    let home = dirs::home_dir()?;
    for path in [
        home.join(".config/opencode/commands")
            .join(format!("{command}.md")),
        home.join(".claude/commands").join(format!("{command}.md")),
    ] {
        if path.exists() {
            return Some(LocalCommandSource::Command(path));
        }
    }
    for path in [
        home.join(".config/opencode/skills")
            .join(command)
            .join("SKILL.md"),
        home.join(".agents/skills").join(command).join("SKILL.md"),
        home.join(".claude/skills").join(command).join("SKILL.md"),
    ] {
        if path.exists() {
            return Some(LocalCommandSource::Skill);
        }
    }
    None
}

fn project_ancestors(start_dir: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    let mut current = Some(start_dir);
    while let Some(dir) = current {
        result.push(dir.to_path_buf());
        if dir.join(".git").exists() {
            break;
        }
        current = dir.parent();
    }
    result
}

fn strip_frontmatter(content: &str) -> &str {
    let Some(body) = content.strip_prefix("---\n") else {
        return content;
    };
    let Some(end) = body.find("\n---") else {
        return content;
    };
    body[end + 4..].trim_start_matches('\n')
}

fn expand_command_template(template: &str, arguments: &str) -> String {
    let mut expanded = template.replace("$ARGUMENTS", arguments);
    for (index, argument) in arguments.split_whitespace().enumerate() {
        expanded = expanded.replace(&format!("${}", index + 1), argument);
    }
    expanded
}

#[cfg(test)]
mod tests {
    use super::{
        build_command_payload, command_invocation_from_parts, expand_command_template,
        parse_command_invocation, should_fallback_to_prompt, strip_frontmatter,
    };
    use crate::error::SdkError;
    use crate::types::{ModelRef, PromptOptions, PromptPart};

    #[test]
    fn parse_command_invocation_extracts_command_and_arguments() {
        let invocation =
            super::parse_command_invocation_text("/review src/main.rs").expect("command");

        assert_eq!(invocation.command, "review");
        assert_eq!(invocation.arguments, "src/main.rs");
    }

    #[test]
    fn parse_command_invocation_rejects_non_commands() {
        assert!(super::parse_command_invocation_text("review").is_none());
        assert!(super::parse_command_invocation_text("/").is_none());
        assert!(super::parse_command_invocation_text("/ review").is_none());
    }

    #[test]
    fn command_invocation_requires_single_text_part() {
        let invocation = command_invocation_from_parts(&[PromptPart::Text {
            text: "/db select 1".to_string(),
        }])
        .expect("command");
        assert_eq!(invocation.command, "db");

        assert!(command_invocation_from_parts(&[
            PromptPart::Text {
                text: "/db select 1".to_string(),
            },
            PromptPart::File {
                mime: "image/png".to_string(),
                filename: None,
                url: "data:image/png;base64,abc".to_string(),
            },
        ])
        .is_none());

        let parsed = parse_command_invocation(&[PromptPart::Text {
            text: "/db select 1".to_string(),
        }])
        .expect("public parser");
        assert_eq!(parsed.0, "db");
        assert_eq!(parsed.1, "select 1");
    }

    #[test]
    fn build_command_payload_includes_agent_and_model() {
        let payload = build_command_payload(
            "review",
            "src/lib.rs",
            PromptOptions {
                agent: Some("build".to_string()),
                model: Some(ModelRef {
                    provider_id: "anthropic".to_string(),
                    model_id: "claude-sonnet".to_string(),
                }),
                system: Some("ignored".to_string()),
            },
        );

        assert_eq!(payload["command"], "review");
        assert_eq!(payload["arguments"], "src/lib.rs");
        assert_eq!(payload["agent"], "build");
        assert_eq!(payload["model"], "anthropic/claude-sonnet");
        assert!(payload.get("system").is_none());
    }

    #[test]
    fn should_fallback_to_prompt_only_for_unknown_command_errors() {
        let unknown = SdkError::HttpStatus {
            status: 500,
            body: serde_json::json!({
                "name": "UnknownError",
                "data": {
                    "message": "Command not found: \"finish-job\""
                }
            })
            .to_string(),
        };
        assert!(should_fallback_to_prompt(&unknown));

        let other = SdkError::HttpStatus {
            status: 500,
            body: serde_json::json!({
                "name": "UnknownError",
                "data": {
                    "message": "Something else failed"
                }
            })
            .to_string(),
        };
        assert!(!should_fallback_to_prompt(&other));
    }

    #[test]
    fn strip_frontmatter_returns_markdown_body() {
        let content = "---\ndescription: Run finish-job\n---\nUse the skill.\n";
        assert_eq!(strip_frontmatter(content), "Use the skill.\n");
    }

    #[test]
    fn expand_command_template_replaces_arguments_placeholders() {
        let expanded = expand_command_template(
            "Use the skill with $ARGUMENTS and first arg $1",
            "tighten tests",
        );

        assert_eq!(
            expanded,
            "Use the skill with tighten tests and first arg tighten"
        );
    }
}
