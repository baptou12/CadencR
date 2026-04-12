use crate::domain::agents::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

pub fn catalog_entry() -> ProviderCatalogEntry {
    ProviderCatalogEntry {
        id: "claude_code".to_string(),
        label: "Claude Code".to_string(),
        status: ProviderStatus::Available,
        models: crate::api::MODELS
            .iter()
            .map(|(id, label, context_window)| ModelCatalogEntry {
                id: (*id).to_string(),
                label: (*label).to_string(),
                context_window: *context_window,
            })
            .collect(),
        default_model: Some(crate::api::DEFAULT_MODEL.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::catalog_entry;
    use crate::domain::agents::runtime::ProviderStatus;

    #[test]
    fn claude_catalog_entry_exposes_available_models() {
        let entry = catalog_entry();
        assert_eq!(entry.id, "claude_code");
        assert_eq!(entry.status, ProviderStatus::Available);
        assert!(!entry.models.is_empty());
        assert_eq!(
            entry.default_model.as_deref(),
            Some(crate::api::DEFAULT_MODEL)
        );
    }
}
