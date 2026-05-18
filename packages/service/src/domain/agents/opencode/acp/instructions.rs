use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use tempfile::TempDir;

use crate::domain::agents::adapter::{RuntimeError, RuntimeSpawnConfig};
use crate::domain::agents::response_style::rich_markdown_system_prompt;

const CONFIG_CONTENT_ENV: &str = "OPENCODE_CONFIG_CONTENT";

pub(super) fn apply_instruction_config(
    config: &mut RuntimeSpawnConfig,
) -> Result<TempDir, RuntimeError> {
    let instructions = rich_markdown_system_prompt(config.system_prompt.as_deref());
    let dir = tempfile::Builder::new()
        .prefix("cadencr-opencode-instructions-")
        .tempdir()
        .map_err(|error| {
            RuntimeError::new(format!(
                "failed to create OpenCode instructions dir: {error}"
            ))
        })?;
    let path = dir.path().join("cadencr-instructions.md");
    fs::write(&path, instructions).map_err(|error| {
        RuntimeError::new(format!(
            "failed to write OpenCode instructions file: {error}"
        ))
    })?;

    let inherited_config_content = std::env::var(CONFIG_CONTENT_ENV).ok();
    let env = config.env.get_or_insert_with(HashMap::new);
    let existing_config_content = env
        .get(CONFIG_CONTENT_ENV)
        .or(inherited_config_content.as_ref());
    let merged = opencode_config_content_with_instruction(existing_config_content, &path)?;
    env.insert(CONFIG_CONTENT_ENV.to_string(), merged);
    Ok(dir)
}

fn opencode_config_content_with_instruction(
    existing: Option<&String>,
    path: &Path,
) -> Result<String, RuntimeError> {
    let mut value = match existing
        .map(|content| content.trim())
        .filter(|content| !content.is_empty())
    {
        Some(content) => serde_json::from_str::<Value>(content).map_err(|error| {
            RuntimeError::new(format!("invalid existing OPENCODE_CONFIG_CONTENT: {error}"))
        })?,
        None => json!({}),
    };
    append_instruction_path(&mut value, path)?;
    serde_json::to_string(&value).map_err(|error| {
        RuntimeError::new(format!(
            "failed to serialize OpenCode config content: {error}"
        ))
    })
}

fn append_instruction_path(value: &mut Value, path: &Path) -> Result<(), RuntimeError> {
    let Some(object) = value.as_object_mut() else {
        return Err(RuntimeError::new(
            "existing OPENCODE_CONFIG_CONTENT must be a JSON object",
        ));
    };
    let path = path.to_string_lossy().into_owned();
    match object.get_mut("instructions") {
        Some(Value::Array(instructions)) => {
            if !instructions.iter().any(|item| item.as_str() == Some(&path)) {
                instructions.push(Value::String(path));
            }
        }
        Some(_) => {
            return Err(RuntimeError::new(
                "existing OPENCODE_CONFIG_CONTENT.instructions must be an array",
            ));
        }
        None => {
            object.insert("instructions".to_string(), json!([path]));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;

    use serde_json::{json, Value};

    use super::{
        apply_instruction_config, opencode_config_content_with_instruction, CONFIG_CONTENT_ENV,
    };
    use crate::domain::agents::adapter::RuntimeSpawnConfig;
    use crate::domain::agents::response_style::RICH_MARKDOWN_INSTRUCTION;

    #[test]
    fn inline_config_adds_instruction_path() {
        let config = opencode_config_content_with_instruction(None, Path::new("/tmp/cadencr.md"))
            .expect("config serializes");
        let parsed: Value = serde_json::from_str(&config).unwrap();

        assert_eq!(parsed["instructions"], json!(["/tmp/cadencr.md"]));
    }

    #[test]
    fn inline_config_preserves_existing_content_and_appends_instruction() {
        let existing = json!({
            "model": "anthropic/claude-sonnet-4-5",
            "instructions": ["CONTRIBUTING.md"]
        })
        .to_string();
        let config =
            opencode_config_content_with_instruction(Some(&existing), Path::new("/tmp/cadencr.md"))
                .expect("config serializes");
        let parsed: Value = serde_json::from_str(&config).unwrap();

        assert_eq!(parsed["model"], "anthropic/claude-sonnet-4-5");
        assert_eq!(
            parsed["instructions"],
            json!(["CONTRIBUTING.md", "/tmp/cadencr.md"])
        );
    }

    #[test]
    fn apply_instruction_config_writes_rich_markdown_prompt_file() {
        let mut config = RuntimeSpawnConfig {
            system_prompt: Some("Base prompt".to_string()),
            env: Some(HashMap::from([("EXISTING".to_string(), "1".to_string())])),
            ..RuntimeSpawnConfig::default()
        };
        let dir = apply_instruction_config(&mut config).expect("instruction config applies");
        let env = config.env.as_ref().unwrap();
        let parsed: Value = serde_json::from_str(env.get(CONFIG_CONTENT_ENV).unwrap()).unwrap();
        let instruction_path = parsed["instructions"][0].as_str().unwrap();
        let content = std::fs::read_to_string(instruction_path).unwrap();

        assert!(dir.path().exists());
        assert_eq!(env.get("EXISTING").map(String::as_str), Some("1"));
        assert!(content.starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(content.ends_with("Base prompt"));
    }
}
