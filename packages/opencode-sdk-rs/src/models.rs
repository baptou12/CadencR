use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use tokio::process::Command;

use crate::error::SdkError;
use crate::process::resolve_binary;
use crate::types::{
    ConfigModelLimit, ConfigProvider, ConfigProviderModel, ConfigProvidersResponse,
};

const MODELS_CLI_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
struct VerboseModel {
    id: Option<String>,
    #[serde(rename = "providerID")]
    provider_id: Option<String>,
    name: Option<String>,
    limit: Option<ConfigModelLimit>,
}

struct ParsedModel {
    provider_id: String,
    model: ConfigProviderModel,
}

pub async fn list_models_from_cli() -> Result<ConfigProvidersResponse, SdkError> {
    let binary = resolve_binary().await?;
    list_models_from_binary(&binary).await
}

pub async fn list_models_from_binary(binary: &Path) -> Result<ConfigProvidersResponse, SdkError> {
    let mut command = Command::new(binary);
    command.arg("models").arg("--verbose").kill_on_drop(true);
    let output = tokio::time::timeout(MODELS_CLI_TIMEOUT, command.output())
        .await
        .map_err(|_| SdkError::Timeout("opencode models --verbose".to_string()))??;

    if !output.status.success() {
        return Err(SdkError::Protocol(format!(
            "opencode models --verbose exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim(),
        )));
    }

    parse_models_verbose_output(&String::from_utf8_lossy(&output.stdout))
}

pub fn parse_models_verbose_output(raw: &str) -> Result<ConfigProvidersResponse, SdkError> {
    let parsed = parse_model_entries(raw)?;
    let mut providers = Vec::new();
    let mut provider_indices = HashMap::new();

    for entry in parsed {
        let index = *provider_indices
            .entry(entry.provider_id.clone())
            .or_insert_with(|| {
                providers.push(ConfigProvider {
                    id: entry.provider_id.clone(),
                    name: None,
                    models: Vec::new(),
                });
                providers.len() - 1
            });
        providers[index].models.push(entry.model);
    }

    let default = providers
        .iter()
        .filter_map(|provider| {
            provider
                .models
                .first()
                .map(|model| (provider.id.clone(), model.id.clone()))
        })
        .collect();

    Ok(ConfigProvidersResponse { providers, default })
}

fn parse_model_entries(raw: &str) -> Result<Vec<ParsedModel>, SdkError> {
    let mut entries = Vec::new();
    let mut pending_ref: Option<String> = None;
    let mut pending_json = String::new();
    let mut brace_depth = 0_i32;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if pending_ref.is_none() {
            pending_ref = Some(trimmed.to_string());
            continue;
        }

        if pending_json.is_empty() && !trimmed.starts_with('{') {
            if let Some(model_ref) = pending_ref.replace(trimmed.to_string()) {
                entries.push(plain_entry(&model_ref)?);
            }
            continue;
        }

        pending_json.push_str(line);
        pending_json.push('\n');
        brace_depth += json_brace_delta(line);
        if brace_depth < 0 {
            return Err(SdkError::Protocol(format!(
                "unexpected closing brace in opencode models output for {}",
                pending_ref.as_deref().unwrap_or("unknown model"),
            )));
        }
        if brace_depth == 0 {
            let model = serde_json::from_str::<VerboseModel>(&pending_json)?;
            if let Some(model_ref) = pending_ref.take() {
                entries.push(verbose_entry(&model_ref, model)?);
            }
            pending_json.clear();
        }
    }

    if let Some(model_ref) = pending_ref {
        if pending_json.trim().is_empty() {
            entries.push(plain_entry(&model_ref)?);
        } else {
            return Err(SdkError::Protocol(format!(
                "unterminated opencode models JSON block for {model_ref}",
            )));
        }
    }

    Ok(entries)
}

fn json_brace_delta(line: &str) -> i32 {
    line.chars().fold(0, |depth, char| match char {
        '{' => depth + 1,
        '}' => depth - 1,
        _ => depth,
    })
}

fn plain_entry(model_ref: &str) -> Result<ParsedModel, SdkError> {
    let (provider_id, model_id) = split_model_ref(model_ref)?;
    Ok(ParsedModel {
        provider_id,
        model: ConfigProviderModel {
            id: model_id,
            name: None,
            limit: None,
        },
    })
}

fn verbose_entry(model_ref: &str, model: VerboseModel) -> Result<ParsedModel, SdkError> {
    let (fallback_provider_id, fallback_model_id) = split_model_ref(model_ref)?;
    let provider_id = model.provider_id.unwrap_or(fallback_provider_id);
    let model_id = model.id.unwrap_or(fallback_model_id);
    Ok(ParsedModel {
        provider_id,
        model: ConfigProviderModel {
            id: model_id,
            name: model.name,
            limit: model.limit,
        },
    })
}

fn split_model_ref(model_ref: &str) -> Result<(String, String), SdkError> {
    let Some((provider_id, model_id)) = model_ref.split_once('/') else {
        return Err(SdkError::Protocol(format!(
            "opencode model ref must be provider/model: {model_ref}",
        )));
    };
    if provider_id.is_empty() || model_id.is_empty() {
        return Err(SdkError::Protocol(format!(
            "opencode model ref must be provider/model: {model_ref}",
        )));
    }
    Ok((provider_id.to_string(), model_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::parse_models_verbose_output;

    #[test]
    fn parse_models_verbose_output_groups_models_by_provider() {
        let raw = r#"opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "limit": { "context": 200000, "output": 128000 }
}
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4",
  "limit": { "context": 1050000, "output": 128000 },
  "variants": {
    "low": { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" },
    "high": { "reasoningEffort": "high" },
    "xhigh": { "reasoningEffort": "xhigh" }
  }
}
"#;

        let response = parse_models_verbose_output(raw).expect("parse ok");

        assert_eq!(response.providers.len(), 2);
        assert_eq!(response.providers[0].id, "opencode");
        assert_eq!(response.providers[0].name, None);
        assert_eq!(response.providers[0].models[0].id, "big-pickle");
        assert_eq!(
            response.providers[0].models[0].name.as_deref(),
            Some("Big Pickle")
        );
        assert_eq!(
            response.providers[0].models[0]
                .limit
                .as_ref()
                .and_then(|limit| limit.context),
            Some(200_000),
        );
        assert_eq!(
            response.default.get("opencode").map(String::as_str),
            Some("big-pickle"),
        );
        assert_eq!(response.providers[1].id, "openai");
        assert_eq!(response.providers[1].name, None);
        assert_eq!(response.providers[1].models[0].id, "gpt-5.4");
        assert_eq!(
            response.providers[1].models[0].name.as_deref(),
            Some("GPT-5.4")
        );
    }

    #[test]
    fn parse_models_verbose_output_accepts_plain_model_list() {
        let response =
            parse_models_verbose_output("opencode/big-pickle\nopenai/gpt-5.4\n").expect("parse ok");

        assert_eq!(response.providers.len(), 2);
        assert_eq!(response.providers[0].models[0].id, "big-pickle");
        assert_eq!(response.providers[1].models[0].id, "gpt-5.4");
    }
}
