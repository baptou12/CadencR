use crate::domain::agents::runtime::{ProviderCatalogEntry, ProviderStatus};

pub fn catalog_entry() -> ProviderCatalogEntry {
    ProviderCatalogEntry {
        id: "codex_cli".to_string(),
        label: "Codex CLI".to_string(),
        status: ProviderStatus::ComingSoon,
        models: vec![],
        default_model: None,
    }
}

#[cfg(test)]
mod tests {
    use super::catalog_entry;
    use crate::domain::agents::runtime::ProviderStatus;

    #[test]
    fn codex_catalog_entry_is_coming_soon() {
        let entry = catalog_entry();
        assert_eq!(entry.id, "codex_cli");
        assert_eq!(entry.status, ProviderStatus::ComingSoon);
        assert!(entry.models.is_empty());
        assert!(entry.default_model.is_none());
    }
}
