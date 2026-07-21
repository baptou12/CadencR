use crate::domain::git::models::{
    ConflictContent, ConflictFallbackReason, ConflictIndexEntryContent, ConflictKind,
    ConflictResolverPresentation, ConflictResultContent,
};

use super::fingerprint::ConflictFingerprint;

pub(super) fn presentation_for(
    fingerprint: &ConflictFingerprint,
    entries: [&Option<ConflictIndexEntryContent>; 3],
    result: Option<&ConflictResultContent>,
) -> ConflictResolverPresentation {
    if fingerprint.conflict_kind == ConflictKind::Dd {
        return guidance(ConflictFallbackReason::BothDeleted);
    }
    let contents = entries
        .into_iter()
        .filter_map(|entry| entry.as_ref().map(|entry| &entry.content))
        .chain(result.map(|entry| &entry.content));
    let mut has_binary = false;
    let mut has_large = false;
    let mut has_unavailable = false;
    for content in contents {
        match content {
            ConflictContent::Binary => has_binary = true,
            ConflictContent::Large => has_large = true,
            ConflictContent::Unavailable { .. } => has_unavailable = true,
            ConflictContent::Text { .. } => {}
        }
    }
    if has_binary {
        return guidance(ConflictFallbackReason::Binary);
    }
    if has_large {
        return guidance(ConflictFallbackReason::Large);
    }
    if has_unavailable {
        return guidance(ConflictFallbackReason::Unavailable);
    }
    if matches!(
        fingerprint.conflict_kind,
        ConflictKind::Ud | ConflictKind::Du
    ) {
        return ConflictResolverPresentation::ModifyDelete;
    }

    let text = |entry: &Option<ConflictIndexEntryContent>| {
        entry
            .as_ref()
            .is_some_and(|entry| matches!(entry.content, ConflictContent::Text { .. }))
    };
    let result_is_text =
        result.is_some_and(|entry| matches!(entry.content, ConflictContent::Text { .. }));
    if text(entries[0]) && text(entries[1]) && text(entries[2]) && result_is_text {
        ConflictResolverPresentation::ThreeWay
    } else if result_is_text && entries.into_iter().any(text) {
        ConflictResolverPresentation::TwoWay
    } else {
        guidance(ConflictFallbackReason::Unavailable)
    }
}

pub(super) fn guidance(reason: ConflictFallbackReason) -> ConflictResolverPresentation {
    ConflictResolverPresentation::Guidance { reason }
}
