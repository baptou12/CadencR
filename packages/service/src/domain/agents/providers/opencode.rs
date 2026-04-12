use std::collections::HashSet;
use std::time::Duration;

use serde_json::Value;
use tracing::{info, warn};

use crate::domain::agents::adapter::AgentRuntimeAdapter;
use crate::domain::agents::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

const FALLBACK_MODEL_ID: &str = "default/default";

pub fn catalog_entry() -> ProviderCatalogEntry {
    build_catalog_entry(default_models(), None)
}

pub async fn catalog_entry_live() -> ProviderCatalogEntry {
    fetch_configured_catalog()
        .await
        .map(|(models, default_model)| build_catalog_entry(models, default_model))
        .unwrap_or_else(catalog_entry)
}

pub fn spawn_startup_warmup() {
    if !should_warmup_on_start() {
        info!("opencode startup warmup disabled by CADENCE_OPENCODE_WARMUP_ON_START");
        return;
    }

    let adapter = &crate::domain::agents::opencode::OPENCODE_ADAPTER;
    tokio::spawn(async move {
        if let Err(error) = adapter.init().await {
            warn!(error = %error, "opencode startup warmup failed");
        } else {
            info!("opencode startup warmup completed");
        }
    });
}

fn build_catalog_entry(
    models: Vec<ModelCatalogEntry>,
    default_model: Option<String>,
) -> ProviderCatalogEntry {
    let resolved_default = default_model.or_else(|| models.first().map(|model| model.id.clone()));
    ProviderCatalogEntry {
        id: "opencode".to_string(),
        label: "OpenCode".to_string(),
        status: ProviderStatus::Available,
        models,
        default_model: resolved_default,
    }
}

fn default_models() -> Vec<ModelCatalogEntry> {
    vec![ModelCatalogEntry {
        id: FALLBACK_MODEL_ID.to_string(),
        label: "Default".to_string(),
        context_window: crate::api::DEFAULT_CONTEXT_WINDOW,
    }]
}

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

fn models_from_providers(providers: &[Value]) -> Vec<ModelCatalogEntry> {
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
            models.push(ModelCatalogEntry {
                id,
                label: first_string(&model, &["name", "label"]).unwrap_or(model_id),
                context_window: crate::api::DEFAULT_CONTEXT_WINDOW,
            });
        }
    }

    models
}

fn default_model_id(config: &Value, providers: &[Value]) -> Option<String> {
    let defaults = config.get("default")?.as_object()?;
    for provider in providers {
        let provider_id =
            first_string(provider, &["id", "providerID", "providerId", "provider_id"])?;
        let default_model = defaults.get(&provider_id)?.as_str()?;
        return Some(format!("{provider_id}/{default_model}"));
    }
    None
}

async fn fetch_configured_catalog() -> Option<(Vec<ModelCatalogEntry>, Option<String>)> {
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

fn parse_warmup_flag(raw: Option<&str>) -> bool {
    match raw.map(str::trim).map(str::to_ascii_lowercase) {
        None => true,
        Some(value) if value.is_empty() => true,
        Some(value) => !matches!(value.as_str(), "0" | "false" | "no" | "off"),
    }
}

fn should_warmup_on_start() -> bool {
    parse_warmup_flag(
        std::env::var("CADENCE_OPENCODE_WARMUP_ON_START")
            .ok()
            .as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_catalog_entry, catalog_entry, catalog_entry_live, default_model_id,
        models_from_providers, parse_warmup_flag,
    };
    use crate::domain::agents::runtime::ModelCatalogEntry;
    use crate::domain::agents::runtime::ProviderStatus;
    use axum::routing::get;
    use axum::{Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    static OPENCODE_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
                ModelCatalogEntry {
                    id: "anthropic/claude-sonnet".to_string(),
                    label: "anthropic/claude-sonnet".to_string(),
                    context_window: crate::api::DEFAULT_CONTEXT_WINDOW,
                },
                ModelCatalogEntry {
                    id: "openai/gpt-5.4".to_string(),
                    label: "openai/gpt-5.4".to_string(),
                    context_window: crate::api::DEFAULT_CONTEXT_WINDOW,
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

    async fn start_opencode_mock_server() -> String {
        let app = Router::new()
            .route("/global/health", get(|| async { Json(json!({ "ok": true })) }))
            .route(
                "/config/providers",
                get(|| async {
                    Json(json!({
                        "default": { "anthropic": "claude-opus-4-6" },
                        "providers": [{
                            "id": "anthropic",
                            "models": {
                                "claude-sonnet-4-5": { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5" },
                                "claude-opus-4-6": { "id": "claude-opus-4-6", "name": "Claude Opus 4.6" }
                            }
                        }]
                    }))
                }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test(flavor = "current_thread")]
    async fn live_catalog_reads_configured_models() {
        let _guard = OPENCODE_ENV_LOCK.lock().unwrap();
        let base_url = start_opencode_mock_server().await;
        let _ = opencode_sdk_rs::OpenCodeServer::shutdown().await;
        std::env::set_var("CADENCE_OPENCODE_BASE_URL", &base_url);

        let entry = catalog_entry_live().await;
        let ids = entry
            .models
            .iter()
            .map(|model| model.id.clone())
            .collect::<Vec<_>>();
        let mut sorted_ids = ids.clone();
        sorted_ids.sort();
        assert_eq!(
            sorted_ids,
            vec![
                "anthropic/claude-opus-4-6".to_string(),
                "anthropic/claude-sonnet-4-5".to_string()
            ]
        );
        let mut labels = entry
            .models
            .iter()
            .map(|model| model.label.clone())
            .collect::<Vec<_>>();
        labels.sort();
        assert_eq!(labels, vec!["Claude Opus 4.6", "Claude Sonnet 4.5"]);
        assert_eq!(
            entry.default_model.as_deref(),
            Some("anthropic/claude-opus-4-6")
        );

        std::env::remove_var("CADENCE_OPENCODE_BASE_URL");
        let _ = opencode_sdk_rs::OpenCodeServer::shutdown().await;
    }
}
