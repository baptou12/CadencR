use serde_json::{json, Value};

use crate::client::CodexAppServerClient;
use crate::error::SdkError;
use crate::types::{CodexCommand, CodexCommandKind};

impl CodexAppServerClient {
    pub async fn list_commands_in_directory(
        &self,
        cwd: &str,
    ) -> Result<Vec<CodexCommand>, SdkError> {
        self.list_commands_for_cwds(json!([cwd])).await
    }

    pub async fn list_commands(&self) -> Result<Vec<CodexCommand>, SdkError> {
        self.list_commands_for_cwds(json!([])).await
    }

    async fn list_commands_for_cwds(&self, cwds: Value) -> Result<Vec<CodexCommand>, SdkError> {
        let result = self
            .request(
                "skills/list",
                json!({
                    "cwds": cwds,
                    "forceReload": true,
                }),
            )
            .await?;
        parse_commands_from_skills_response(&result)
    }
}

fn parse_commands_from_skills_response(response: &Value) -> Result<Vec<CodexCommand>, SdkError> {
    let entries = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| SdkError::Protocol("skills/list response missing data array".to_string()))?;
    let mut commands = Vec::new();
    for skill in entries.iter().flat_map(|entry| {
        entry
            .get("skills")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
    }) {
        if skill.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let Some(name) = skill.get("name").and_then(Value::as_str) else {
            continue;
        };
        commands.push(CodexCommand {
            name: name.to_string(),
            description: skill
                .get("description")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            kind: CodexCommandKind::Skill,
        });
    }
    Ok(commands)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_commands_from_skills_response;
    use crate::types::CodexCommandKind;

    #[test]
    fn parse_commands_from_skills_response_maps_enabled_skills() {
        let commands = parse_commands_from_skills_response(&json!({
            "data": [{
                "cwd": "/repo",
                "errors": [],
                "skills": [
                    {
                        "name": "finish-job",
                        "description": "Finish safely",
                        "enabled": true,
                        "path": "/repo/.agents/skills/finish-job",
                        "scope": "repo"
                    },
                    {
                        "name": "hidden",
                        "description": "Hidden",
                        "enabled": false,
                        "path": "/repo/.agents/skills/hidden",
                        "scope": "repo"
                    }
                ]
            }]
        }))
        .unwrap();

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "finish-job");
        assert_eq!(commands[0].description.as_deref(), Some("Finish safely"));
        assert_eq!(commands[0].kind, CodexCommandKind::Skill);
    }
}
