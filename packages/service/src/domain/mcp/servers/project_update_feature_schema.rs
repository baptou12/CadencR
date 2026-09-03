use serde_json::{json, Value};

/// Input schema for `project_update_feature`.
///
/// Every property carries its own description so the shared documentation pass
/// in `project_schema` never falls back to a generic blurb written for another
/// tool (its `title` default describes creating a session, not renaming one).
pub(super) fn schema() -> Value {
    json!({
        "type": "object",
        "description": "Pass at least one of title, label, pinned, or status; an update with none of them fails with EMPTY_UPDATE.",
        "properties": {
            "feature_id": {
                "type": "number",
                "description": "Feature to update, from the feature.id of project_list_sessions. It must belong to the current project, else FEATURE_NOT_IN_PROJECT."
            },
            "title": {
                "type": "string",
                "description": "Replacement title. Must not be blank; setting it also marks the title manually chosen so automatic naming will not overwrite it."
            },
            "label": {
                "type": ["string", "null"],
                "description": "Replacement label. A string replaces the previous label, null clears it, and omitting the key leaves it unchanged."
            },
            "pinned": {
                "type": "boolean",
                "description": "Whether the conversation is pinned to the top of the sidebar."
            },
            "status": {
                "type": "string",
                "enum": ["active", "archived"],
                "description": "archived hides the feature from the sidebar and replaces deletion; active restores it. Archiving fails with FEATURE_HAS_RUNNING_SESSION while another session in the feature is mid-turn."
            }
        },
        "required": ["feature_id"]
    })
}

#[cfg(test)]
mod tests {
    use super::schema;

    #[test]
    fn label_accepts_null_so_clearing_is_expressible() {
        let schema = schema();
        assert_eq!(schema["properties"]["label"]["type"][0], "string");
        assert_eq!(schema["properties"]["label"]["type"][1], "null");
        assert_eq!(schema["required"][0], "feature_id");
    }

    #[test]
    fn status_is_limited_to_the_two_archive_states() {
        let schema = schema();
        assert_eq!(schema["properties"]["status"]["enum"][0], "active");
        assert_eq!(schema["properties"]["status"]["enum"][1], "archived");
        assert_eq!(
            schema["properties"]["status"]["enum"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn every_property_carries_its_own_description() {
        let schema = schema();
        for (name, property) in schema["properties"].as_object().unwrap() {
            assert!(
                property["description"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty()),
                "{name} is missing a description"
            );
        }
        assert!(schema["description"]
            .as_str()
            .unwrap()
            .contains("EMPTY_UPDATE"));
    }
}
