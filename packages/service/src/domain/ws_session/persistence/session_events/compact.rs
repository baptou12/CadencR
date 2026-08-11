/// Serialize compaction metadata for a persisted `compact_divider` row.
pub(super) fn serialize_compact_metadata(
    metadata: Option<&crate::domain::agents::adapter::RuntimeCompactMetadata>,
) -> String {
    match metadata {
        Some(meta) if meta.trigger.is_some() || meta.pre_tokens.is_some() => {
            serde_json::to_string(meta).unwrap_or_default()
        }
        _ => String::new(),
    }
}
