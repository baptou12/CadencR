use std::collections::BTreeSet;
use std::fmt;

use sqlx::SqlitePool;

use super::{provider_catalog_entry_live_for_settings, runtime_adapter};
use crate::domain::agents::adapter::AgentRuntimeAdapter;
use crate::domain::agents::runtime::ProviderCatalogEntry;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderAliasMetadata {
    pub provider_id: &'static str,
    pub aliases: &'static [&'static str],
    pub model_guidance: &'static str,
}

const PROVIDER_ALIAS_METADATA: &[ProviderAliasMetadata] = &[
    ProviderAliasMetadata {
        provider_id: "claude_code",
        aliases: &["claude", "claude-code", "Claude Code", "anthropic"],
        model_guidance: "Use catalog aliases such as opus, opus[1m], sonnet, haiku, or default.",
    },
    ProviderAliasMetadata {
        provider_id: "codex_cli",
        aliases: &["codex", "codex-cli", "Codex CLI", "openai"],
        model_guidance: "Use bare Codex/OpenAI-style model ids advertised by the Codex app-server, for example gpt-5.5.",
    },
    ProviderAliasMetadata {
        provider_id: "opencode",
        aliases: &["open-code", "OpenCode", "open"],
        model_guidance: "Use OpenCode provider/model ids such as default/default or other ids shown by OpenCode's model catalog.",
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderModelValidationError {
    UnknownProvider {
        provider_id: String,
        suggested_provider: Option<String>,
        valid_providers: Vec<String>,
    },
    UnknownModel {
        provider_id: String,
        model_id: String,
        available_models: Vec<String>,
    },
}

impl fmt::Display for ProviderModelValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownProvider {
                provider_id,
                suggested_provider,
                valid_providers,
            } => {
                write!(formatter, "unknown provider '{provider_id}'")?;
                if let Some(suggestion) = suggested_provider {
                    write!(formatter, ". Did you mean '{suggestion}'?")?;
                }
                write!(
                    formatter,
                    ". Valid providers: {}",
                    valid_providers.join(", ")
                )
            }
            Self::UnknownModel {
                provider_id,
                model_id,
                available_models,
            } => {
                write!(
                    formatter,
                    "unknown model '{model_id}' for provider '{provider_id}'"
                )?;
                write!(
                    formatter,
                    ". Available models: {}",
                    available_models.join(", ")
                )
            }
        }
    }
}

pub fn canonical_provider_id(provider_id: &str) -> Option<String> {
    let normalized = normalized_ref(provider_id);
    if runtime_adapter(provider_id).is_some() {
        return Some(provider_id.to_string());
    }

    PROVIDER_ALIAS_METADATA
        .iter()
        .find(|metadata| {
            normalized_ref(metadata.provider_id) == normalized
                || metadata
                    .aliases
                    .iter()
                    .any(|alias| normalized_ref(alias) == normalized)
        })
        .map(|metadata| metadata.provider_id.to_string())
}

pub fn valid_provider_ids() -> Vec<String> {
    super::ADAPTERS
        .iter()
        .map(|(provider_id, _)| (*provider_id).to_string())
        .collect()
}

pub fn provider_aliases() -> Vec<(&'static str, Vec<&'static str>)> {
    PROVIDER_ALIAS_METADATA
        .iter()
        .map(|metadata| (metadata.provider_id, metadata.aliases.to_vec()))
        .collect()
}

pub fn provider_alias_metadata(provider_id: &str) -> Option<ProviderAliasMetadata> {
    PROVIDER_ALIAS_METADATA
        .iter()
        .copied()
        .find(|metadata| metadata.provider_id == provider_id)
}

pub fn canonical_provider_or_error(
    provider_id: &str,
) -> Result<String, ProviderModelValidationError> {
    canonical_provider_id(provider_id).ok_or_else(|| {
        ProviderModelValidationError::UnknownProvider {
            provider_id: provider_id.to_string(),
            suggested_provider: suggested_provider_id(provider_id),
            valid_providers: valid_provider_ids(),
        }
    })
}

pub async fn canonical_model_or_error(
    read_pool: &SqlitePool,
    provider_id: &str,
    model_id: &str,
) -> Result<String, ProviderModelValidationError> {
    let provider_id = canonical_provider_or_error(provider_id)?;
    let adapter = runtime_adapter(&provider_id).expect("canonical provider has adapter");
    let catalog = provider_catalog_entry_live_for_settings(read_pool, None, None, adapter).await;
    let canonical_model = adapter.canonicalize_model_id(model_id, &catalog.models);

    if model_is_available(&canonical_model, &catalog, adapter) {
        return Ok(canonical_model);
    }

    Err(ProviderModelValidationError::UnknownModel {
        provider_id,
        model_id: model_id.to_string(),
        available_models: available_model_ids(&catalog, adapter),
    })
}

fn suggested_provider_id(provider_id: &str) -> Option<String> {
    let requested = normalized_ref(provider_id);
    PROVIDER_ALIAS_METADATA
        .iter()
        .find(|metadata| {
            normalized_ref(metadata.provider_id).contains(&requested)
                || metadata
                    .aliases
                    .iter()
                    .any(|alias| normalized_ref(alias).contains(&requested))
        })
        .map(|metadata| metadata.provider_id.to_string())
}

fn model_is_available(
    model_id: &str,
    catalog: &ProviderCatalogEntry,
    adapter: &dyn AgentRuntimeAdapter,
) -> bool {
    catalog.models.iter().any(|model| model.id == model_id)
        || adapter
            .catalog_entry()
            .models
            .iter()
            .any(|model| model.id == model_id)
}

fn available_model_ids(
    catalog: &ProviderCatalogEntry,
    adapter: &dyn AgentRuntimeAdapter,
) -> Vec<String> {
    catalog
        .models
        .iter()
        .chain(adapter.catalog_entry().models.iter())
        .map(|model| model.id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn normalized_ref(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
