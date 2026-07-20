use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    ConflictContentUnavailableReason, ConflictFileKind, ConflictKind, ConflictResolverPresentation,
    ConflictUnavailableReason, GitOperationKind,
};

/// Content state for one present index entry or worktree result. Missing
/// stages/results use the optional containing object, never an empty string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ConflictContent {
    Text {
        content: String,
    },
    Binary,
    Large,
    Unavailable {
        reason: ConflictContentUnavailableReason,
    },
}

/// Metadata and content for one present named index stage. The containing
/// `base`, `stage_2`, or `stage_3` field is its only stage identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConflictIndexEntryContent {
    pub object_id: String,
    pub file_kind: ConflictFileKind,
    pub byte_size: Option<u64>,
    pub content: ConflictContent,
}

/// Point-in-time worktree/result content. It deliberately has no public
/// fingerprint because Editor writes remain unconditional in Phase 5C.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConflictResultContent {
    pub file_kind: ConflictFileKind,
    pub byte_size: Option<u64>,
    pub content: ConflictContent,
}

/// One coherent available conflict read.
///
/// Phase 5B must compare the exact unmerged row before and after reading:
/// literal path, conflict kind, operation context, and each present stage's Git
/// mode/object ID. Failure to inspect the repository returns
/// `RepositoryUnavailable`.
/// A changed row returns `ConflictContentResponse::Unavailable` with `Stale`;
/// a missing row returns `Resolved`. Raw modes remain backend-only and are
/// exposed here solely as `file_kind`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConflictContentSnapshot {
    pub file_path: String,
    pub conflict_kind: ConflictKind,
    pub operation: Option<GitOperationKind>,
    pub presentation: ConflictResolverPresentation,
    pub base: Option<ConflictIndexEntryContent>,
    pub stage_2: Option<ConflictIndexEntryContent>,
    pub stage_3: Option<ConflictIndexEntryContent>,
    pub result: Option<ConflictResultContent>,
}

/// Phase 5B's successful HTTP response. Expected resolved, stale, and
/// repository-unavailable reads stay in this tagged union so generated clients
/// can branch on `outcome` without parsing generic HTTP errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ConflictContentResponse {
    Available {
        snapshot: ConflictContentSnapshot,
    },
    Unavailable {
        file_path: String,
        reason: ConflictUnavailableReason,
    },
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::super::{ConflictFallbackReason, GetConflictContentParams};
    use super::*;
    use serde_json::{json, Value};
    use utoipa::OpenApi;

    fn entry(content: &str) -> ConflictIndexEntryContent {
        ConflictIndexEntryContent {
            object_id: format!("oid-{content}"),
            file_kind: ConflictFileKind::RegularFile,
            byte_size: Some(content.len() as u64),
            content: ConflictContent::Text {
                content: content.into(),
            },
        }
    }

    fn required_fields(schema: &Value) -> BTreeSet<&str> {
        schema["required"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect()
    }

    fn tagged_values<'a>(schema: &'a Value, tag: &str) -> BTreeSet<&'a str> {
        schema["oneOf"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|variant| variant["properties"][tag]["enum"][0].as_str())
            .collect()
    }

    fn enum_values(schema: &Value) -> BTreeSet<&str> {
        schema["enum"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect()
    }

    fn tagged_variant<'a>(schema: &'a Value, tag: &str, value: &str) -> &'a Value {
        schema["oneOf"]
            .as_array()
            .unwrap()
            .iter()
            .find(|variant| variant["properties"][tag]["enum"][0] == value)
            .unwrap()
    }

    fn permits_null(schema: &Value) -> bool {
        schema["nullable"] == true
            || schema["type"] == "null"
            || schema["type"]
                .as_array()
                .is_some_and(|types| types.iter().any(|kind| kind == "null"))
            || schema["oneOf"]
                .as_array()
                .is_some_and(|items| items.iter().any(permits_null))
    }

    fn snapshot() -> ConflictContentSnapshot {
        ConflictContentSnapshot {
            file_path: "src/lib.rs".into(),
            conflict_kind: ConflictKind::Uu,
            operation: Some(GitOperationKind::Rebase),
            presentation: ConflictResolverPresentation::ThreeWay,
            base: Some(entry("base\n")),
            stage_2: Some(entry("onto\n")),
            stage_3: Some(entry("commit\n")),
            result: Some(ConflictResultContent {
                file_kind: ConflictFileKind::RegularFile,
                byte_size: Some(7),
                content: ConflictContent::Text {
                    content: "result\n".into(),
                },
            }),
        }
    }

    #[test]
    fn response_roundtrip_uses_exhaustive_success_outcomes() {
        let available = ConflictContentResponse::Available {
            snapshot: snapshot(),
        };
        let json = serde_json::to_value(&available).unwrap();
        assert_eq!(json["outcome"], "available");
        assert_eq!(json["snapshot"]["stage_2"]["object_id"], "oid-onto\n");
        assert!(json["snapshot"]["stage_2"].get("stage").is_none());
        assert!(json["snapshot"]["stage_2"].get("role").is_none());
        assert!(json["snapshot"]["result"].get("worktree_id").is_none());
        assert_eq!(
            serde_json::from_value::<ConflictContentResponse>(json).unwrap(),
            available
        );

        for reason in [
            ConflictUnavailableReason::Resolved,
            ConflictUnavailableReason::Stale,
            ConflictUnavailableReason::RepositoryUnavailable,
        ] {
            let response = ConflictContentResponse::Unavailable {
                file_path: "src/lib.rs".into(),
                reason,
            };
            let json = serde_json::to_value(&response).unwrap();
            assert_eq!(json["outcome"], "unavailable");
            assert_eq!(
                serde_json::from_value::<ConflictContentResponse>(json).unwrap(),
                response
            );
        }
    }

    #[test]
    fn missing_and_unsupported_entries_have_distinct_typed_states() {
        for (content, expected) in [
            (ConflictContent::Binary, json!({ "state": "binary" })),
            (ConflictContent::Large, json!({ "state": "large" })),
            (
                ConflictContent::Unavailable {
                    reason: ConflictContentUnavailableReason::ObjectMissing,
                },
                json!({ "state": "unavailable", "reason": "object_missing" }),
            ),
            (
                ConflictContent::Unavailable {
                    reason: ConflictContentUnavailableReason::UnsupportedFileKind,
                },
                json!({ "state": "unavailable", "reason": "unsupported_file_kind" }),
            ),
            (
                ConflictContent::Unavailable {
                    reason: ConflictContentUnavailableReason::ReadFailed,
                },
                json!({ "state": "unavailable", "reason": "read_failed" }),
            ),
        ] {
            assert_eq!(serde_json::to_value(content).unwrap(), expected);
        }

        let mut snapshot = snapshot();
        snapshot.presentation = ConflictResolverPresentation::Guidance {
            reason: ConflictFallbackReason::BothDeleted,
        };
        snapshot.stage_2 = None;
        snapshot.stage_3 = None;
        snapshot.result = None;
        let json = serde_json::to_value(snapshot).unwrap();
        assert!(json["stage_2"].is_null());
        assert!(json["stage_3"].is_null());
        assert!(json["result"].is_null());
        assert_eq!(json["presentation"]["reason"], "both_deleted");

        let unsupported = ConflictIndexEntryContent {
            object_id: "oid-symlink".into(),
            file_kind: ConflictFileKind::Symlink,
            byte_size: None,
            content: ConflictContent::Unavailable {
                reason: ConflictContentUnavailableReason::UnsupportedFileKind,
            },
        };
        let json = serde_json::to_value(&unsupported).unwrap();
        assert!(json["byte_size"].is_null());
        assert_eq!(json["file_kind"], "symlink");
        assert!(json.get("git_mode").is_none());
        assert_eq!(
            serde_json::from_value::<ConflictIndexEntryContent>(json).unwrap(),
            unsupported
        );
    }

    #[derive(OpenApi)]
    #[openapi(components(schemas(
        GetConflictContentParams,
        ConflictIndexEntryContent,
        ConflictResultContent,
        ConflictContentSnapshot,
        ConflictContentResponse
    )))]
    struct ConflictContractDoc;

    #[test]
    fn openapi_freezes_tags_required_fields_and_optional_entries() {
        let document = serde_json::to_value(ConflictContractDoc::openapi()).unwrap();
        let schemas = &document["components"]["schemas"];

        assert_eq!(
            tagged_values(&schemas["ConflictContentResponse"], "outcome"),
            BTreeSet::from(["available", "unavailable"])
        );
        assert_eq!(
            tagged_values(&schemas["ConflictContent"], "state"),
            BTreeSet::from(["binary", "large", "text", "unavailable"])
        );
        assert_eq!(
            tagged_values(&schemas["ConflictResolverPresentation"], "mode"),
            BTreeSet::from(["guidance", "modify_delete", "three_way", "two_way"])
        );
        assert_eq!(
            enum_values(&schemas["ConflictFallbackReason"]),
            BTreeSet::from(["binary", "both_deleted", "large", "unavailable"])
        );
        assert_eq!(
            enum_values(&schemas["ConflictContentUnavailableReason"]),
            BTreeSet::from(["object_missing", "read_failed", "unsupported_file_kind"])
        );
        assert_eq!(
            enum_values(&schemas["ConflictFileKind"]),
            BTreeSet::from(["gitlink", "other", "regular_file", "symlink"])
        );
        assert_eq!(
            enum_values(&schemas["ConflictUnavailableReason"]),
            BTreeSet::from(["repository_unavailable", "resolved", "stale"])
        );

        let response = &schemas["ConflictContentResponse"];
        assert_eq!(
            required_fields(tagged_variant(response, "outcome", "available")),
            BTreeSet::from(["outcome", "snapshot"])
        );
        assert_eq!(
            required_fields(tagged_variant(response, "outcome", "unavailable")),
            BTreeSet::from(["file_path", "outcome", "reason"])
        );
        let content = &schemas["ConflictContent"];
        assert_eq!(
            required_fields(tagged_variant(content, "state", "text")),
            BTreeSet::from(["content", "state"])
        );
        assert_eq!(
            required_fields(tagged_variant(content, "state", "unavailable")),
            BTreeSet::from(["reason", "state"])
        );
        let presentation = &schemas["ConflictResolverPresentation"];
        assert_eq!(
            required_fields(tagged_variant(presentation, "mode", "guidance")),
            BTreeSet::from(["mode", "reason"])
        );

        assert_eq!(
            required_fields(&schemas["GetConflictContentParams"]),
            BTreeSet::from(["feature_id", "file_path"])
        );
        let snapshot = &schemas["ConflictContentSnapshot"];
        let required = required_fields(snapshot);
        for field in ["operation", "base", "stage_2", "stage_3", "result"] {
            assert!(!required.contains(field), "{field} must stay optional");
            assert!(
                permits_null(&snapshot["properties"][field]),
                "{field} must permit explicit null"
            );
        }
        assert!(required.contains("file_path"));
        assert!(required.contains("conflict_kind"));
        assert!(required.contains("presentation"));
        for name in ["ConflictIndexEntryContent", "ConflictResultContent"] {
            let schema = &schemas[name];
            assert!(!required_fields(schema).contains("byte_size"));
            assert!(permits_null(&schema["properties"]["byte_size"]));
        }
        assert!(document["paths"].as_object().unwrap().is_empty());
    }
}
