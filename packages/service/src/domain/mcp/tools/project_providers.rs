use serde_json::json;

use crate::domain::agents::providers::{
    provider_alias_metadata, provider_aliases, runtime_adapter, valid_provider_ids,
};
use crate::domain::mcp::context::McpContext;

pub async fn list_agent_providers(_ctx: &McpContext) -> Result<serde_json::Value, String> {
    Ok(json!({
        "valid_provider_ids": valid_provider_ids(),
        "providers": provider_docs(),
        "aliases": provider_aliases()
            .into_iter()
            .map(|(provider, aliases)| json!({ "provider": provider, "aliases": aliases }))
            .collect::<Vec<_>>(),
        "spawn_tip": "Use canonical provider ids in project_spawn_session. Common aliases are normalized, but canonical ids avoid validation retries."
    }))
}

fn provider_docs() -> Vec<serde_json::Value> {
    valid_provider_ids()
        .into_iter()
        .filter_map(|provider_id| provider_doc(&provider_id))
        .collect()
}

fn provider_doc(provider_id: &str) -> Option<serde_json::Value> {
    let adapter = runtime_adapter(provider_id)?;
    let catalog = adapter.catalog_entry();
    let metadata = provider_alias_metadata(provider_id);
    let aliases = metadata
        .map(|metadata| metadata.aliases.to_vec())
        .unwrap_or_default();
    let model_guidance = metadata
        .map(|metadata| metadata.model_guidance)
        .unwrap_or("Use model ids from this provider's catalog.");
    let common_models = catalog
        .models
        .iter()
        .map(|model| model.id.clone())
        .collect::<Vec<_>>();

    Some(json!({
        "id": catalog.id,
        "label": catalog.label,
        "aliases": aliases,
        "model_guidance": model_guidance,
        "common_models": common_models,
        "default_model": catalog.default_model,
    }))
}
