use std::collections::HashSet;
use std::time::Duration;

use opencode_sdk_rs::{Message, MessageRole, OpenCodeClient};
use serde_json::Value;

use crate::domain::agents::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

const FALLBACK_MODEL_ID: &str = "default/default";

pub(crate) fn catalog_entry() -> ProviderCatalogEntry {
    build_catalog_entry(default_models(), None)
}

pub(crate) async fn catalog_entry_live() -> ProviderCatalogEntry {
    fetch_configured_catalog()
        .await
        .map(|(models, default_model)| build_catalog_entry(models, default_model))
        .unwrap_or_else(catalog_entry)
}

fn build_catalog_entry(
    models: Vec<OpencodeModel>,
    default_model: Option<String>,
) -> ProviderCatalogEntry {
    let resolved_default = default_model.or_else(|| models.first().map(|model| model.id.clone()));
    ProviderCatalogEntry {
        id: "opencode".to_string(),
        label: "OpenCode".to_string(),
        status: ProviderStatus::Available,
        models: models.iter().map(OpencodeModel::to_catalog_entry).collect(),
        default_model: resolved_default,
    }
}

/// Internal per-model record used by opencode's session init pipeline to
/// tell the stream reader the model's context window. Translated to the
/// frontend-facing `ModelCatalogEntry` via `to_catalog_entry`.
#[derive(Debug, Clone)]
struct OpencodeModel {
    id: String,
    label: String,
    context_window: u64,
    supported_effort_levels: Vec<String>,
}

impl OpencodeModel {
    fn to_catalog_entry(&self) -> ModelCatalogEntry {
        ModelCatalogEntry {
            id: self.id.clone(),
            label: self.label.clone(),
            description: None,
            supports_effort: Some(!self.supported_effort_levels.is_empty()),
            supported_effort_levels: (!self.supported_effort_levels.is_empty())
                .then(|| self.supported_effort_levels.clone()),
            supports_adaptive_thinking: None,
            supports_fast_mode: None,
            supports_auto_mode: None,
        }
    }
}

fn default_models() -> Vec<OpencodeModel> {
    vec![OpencodeModel {
        id: FALLBACK_MODEL_ID.to_string(),
        label: "Default".to_string(),
        context_window: OPENCODE_FALLBACK_CONTEXT_WINDOW,
        supported_effort_levels: Vec::new(),
    }]
}

const OPENCODE_FALLBACK_CONTEXT_WINDOW: u64 = 200_000;

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

fn parse_model_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| first_string(value, &["id", "modelID", "modelId", "model_id"]))
}

fn model_context_window(value: &Value) -> u64 {
    value
        .get("limit")
        .and_then(|limit| limit.get("context"))
        .and_then(Value::as_u64)
        .unwrap_or(OPENCODE_FALLBACK_CONTEXT_WINDOW)
}

fn supported_effort_levels(value: &Value) -> Vec<String> {
    let Some(variants) = value.get("variants").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut levels = variants
        .iter()
        .filter_map(|(name, variant)| {
            let effort = variant
                .get("reasoningEffort")
                .and_then(Value::as_str)
                .unwrap_or(name.as_str());
            match effort {
                "low" | "medium" | "high" | "xhigh" | "max" => Some(effort.to_string()),
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    levels.sort();
    levels.dedup();
    levels.sort_by_key(|level| match level.as_str() {
        "low" => 0,
        "medium" => 1,
        "high" => 2,
        "xhigh" => 3,
        "max" => 4,
        _ => 5,
    });
    levels
}

fn models_from_providers(providers: &[Value]) -> Vec<OpencodeModel> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for provider in providers {
        let Some(provider_id) =
            first_string(provider, &["id", "providerID", "providerId", "provider_id"])
        else {
            continue;
        };
        let Some(provider_models) = provider.get("models").and_then(|models| match models {
            Value::Array(items) => Some(items.clone()),
            Value::Object(items) => Some(items.values().cloned().collect::<Vec<_>>()),
            _ => None,
        }) else {
            continue;
        };

        for model in provider_models {
            let Some(model_id) = parse_model_id(&model) else {
                continue;
            };
            let id = format!("{provider_id}/{model_id}");
            if !seen.insert(id.clone()) {
                continue;
            }
            let label = first_string(&model, &["name", "label"]).unwrap_or(model_id);
            let context_window = model_context_window(&model);
            let supported_effort_levels = supported_effort_levels(&model);
            models.push(OpencodeModel {
                id,
                label,
                context_window,
                supported_effort_levels,
            });
        }
    }

    models
}

fn default_model_id(config: &Value, providers: &[Value]) -> Option<String> {
    let defaults = config.get("default")?.as_object()?;
    providers.iter().find_map(|provider| {
        let provider_id =
            first_string(provider, &["id", "providerID", "providerId", "provider_id"])?;
        let default_model = defaults.get(&provider_id)?.as_str()?;
        Some(format!("{provider_id}/{default_model}"))
    })
}

async fn fetch_configured_catalog() -> Option<(Vec<OpencodeModel>, Option<String>)> {
    let timeout = Duration::from_secs(3);
    let client = tokio::time::timeout(timeout, opencode_sdk_rs::OpenCodeClient::init())
        .await
        .ok()?
        .ok()?;
    let config = tokio::time::timeout(timeout, client.get_providers_config())
        .await
        .ok()?
        .ok()?;
    let providers = config
        .get("providers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| config.as_array().cloned().unwrap_or_default());
    let models = models_from_providers(&providers);
    if models.is_empty() {
        None
    } else {
        Some((models, default_model_id(&config, &providers)))
    }
}

/// Look up the context window for an opencode model by ID (e.g. "openai/gpt-5.4").
/// Fetches the model catalog from the running opencode server.
pub(crate) async fn context_window_for_model(model_id: &str) -> Option<u64> {
    let (models, _) = fetch_configured_catalog().await?;
    models
        .iter()
        .find(|m| m.id == model_id)
        .map(|m| m.context_window)
}

fn parse_warmup_flag(raw: Option<&str>) -> bool {
    match raw.map(str::trim).map(str::to_ascii_lowercase) {
        None => true,
        Some(value) if value.is_empty() => true,
        Some(value) => !matches!(value.as_str(), "0" | "false" | "no" | "off"),
    }
}

pub(crate) fn should_warmup_on_start() -> bool {
    parse_warmup_flag(
        std::env::var("CADENCE_OPENCODE_WARMUP_ON_START")
            .ok()
            .as_deref(),
    )
}

pub(crate) async fn session_finished(runtime_session_id: &str) -> bool {
    let Ok(client) = OpenCodeClient::init().await else {
        return false;
    };
    let Ok(messages) = client.list_messages(runtime_session_id).await else {
        return false;
    };
    latest_message_is_final_stop(&messages)
}

fn latest_message_is_final_stop(messages: &[Message]) -> bool {
    messages.iter().rev().next().map_or(false, |message| {
        matches!(message.role, MessageRole::Assistant) && message.is_terminal_turn_message()
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_catalog_entry, catalog_entry, default_model_id, model_context_window,
        models_from_providers, parse_warmup_flag, supported_effort_levels, OpencodeModel,
        OPENCODE_FALLBACK_CONTEXT_WINDOW,
    };
    use crate::domain::agents::runtime::ProviderStatus;
    use serde_json::json;

    #[test]
    fn fallback_catalog_entry_is_available() {
        let entry = catalog_entry();
        assert_eq!(entry.id, "opencode");
        assert_eq!(entry.status, ProviderStatus::Available);
        assert_eq!(entry.default_model.as_deref(), Some("default/default"));
        assert_eq!(entry.models.len(), 1);
    }

    #[test]
    fn model_mapping_accepts_string_and_object_shapes() {
        let providers = vec![
            json!({
                "id": "anthropic",
                "models": ["claude-sonnet-4-5", { "id": "claude-opus-4-6" }]
            }),
            json!({
                "providerID": "openai",
                "models": {
                    "gpt-5.4": { "modelID": "gpt-5.4", "name": "GPT-5.4" },
                    "gpt-5.4-mini": { "modelId": "gpt-5.4-mini", "name": "GPT-5.4 mini" }
                }
            }),
        ];

        let mapped = models_from_providers(&providers);
        let ids = mapped
            .into_iter()
            .map(|model| (model.id, model.label))
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![
                (
                    "anthropic/claude-sonnet-4-5".to_string(),
                    "claude-sonnet-4-5".to_string()
                ),
                (
                    "anthropic/claude-opus-4-6".to_string(),
                    "claude-opus-4-6".to_string()
                ),
                ("openai/gpt-5.4".to_string(), "GPT-5.4".to_string()),
                (
                    "openai/gpt-5.4-mini".to_string(),
                    "GPT-5.4 mini".to_string()
                ),
            ]
        );
    }

    #[test]
    fn build_catalog_entry_uses_first_model_when_default_missing() {
        let entry = build_catalog_entry(
            vec![
                OpencodeModel {
                    id: "anthropic/claude-sonnet".to_string(),
                    label: "anthropic/claude-sonnet".to_string(),
                    context_window: OPENCODE_FALLBACK_CONTEXT_WINDOW,
                    supported_effort_levels: Vec::new(),
                },
                OpencodeModel {
                    id: "openai/gpt-5.4".to_string(),
                    label: "openai/gpt-5.4".to_string(),
                    context_window: OPENCODE_FALLBACK_CONTEXT_WINDOW,
                    supported_effort_levels: Vec::new(),
                },
            ],
            None,
        );

        assert_eq!(
            entry.default_model.as_deref(),
            Some("anthropic/claude-sonnet")
        );
    }

    #[test]
    fn model_context_window_uses_limit_context() {
        assert_eq!(
            model_context_window(&json!({ "limit": { "context": 400000 } })),
            400_000
        );
        assert_eq!(
            model_context_window(&json!({ "limit": { "input": 272000 } })),
            OPENCODE_FALLBACK_CONTEXT_WINDOW
        );
    }

    #[test]
    fn default_model_id_reads_top_level_mapping() {
        let providers = vec![json!({
            "id": "anthropic",
            "models": { "claude-opus-4-6": { "id": "claude-opus-4-6" } }
        })];
        let config = json!({ "default": { "anthropic": "claude-opus-4-6" } });

        assert_eq!(
            default_model_id(&config, &providers).as_deref(),
            Some("anthropic/claude-opus-4-6")
        );
    }

    #[test]
    fn supported_effort_levels_read_from_variant_names_and_values() {
        let levels = supported_effort_levels(&json!({
            "variants": {
                "default": { "reasoningEffort": "high" },
                "low": { "reasoningEffort": "low" },
                "xhigh": {}
            }
        }));

        assert_eq!(levels, vec!["low", "high", "xhigh"]);
    }

    #[test]
    fn parse_warmup_flag_defaults_on_and_supports_false_values() {
        assert!(parse_warmup_flag(None));
        assert!(parse_warmup_flag(Some("")));
        assert!(parse_warmup_flag(Some("1")));
        assert!(parse_warmup_flag(Some("true")));
        assert!(!parse_warmup_flag(Some("0")));
        assert!(!parse_warmup_flag(Some("false")));
        assert!(!parse_warmup_flag(Some("no")));
        assert!(!parse_warmup_flag(Some("off")));
    }
}
