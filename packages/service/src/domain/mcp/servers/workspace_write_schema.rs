//! Descriptions and input schemas for the two Steward-gated
//! `cadencr-workspace` write tools.
//!
//! Every property carries its own description so the shared documentation pass
//! in `workspace` never falls back to a blurb written for a read tool, and both
//! tool descriptions state the grant and the refusal code up front: an agent
//! that knows only the user can lift `STEWARD_REQUIRED` asks for it instead of
//! retrying a call that will never succeed.

use serde_json::{json, Value};

pub(super) const UPDATE_FEATURE_DESCRIPTION: &str = "Rename, label, pin, or archive a feature in ANY CadencR project — the workspace-wide twin of project_update_feature, for organizing work you do not own. Requires the Steward grant on YOUR feature: without it the call is refused with STEWARD_REQUIRED, which only the user can lift by enabling 'Workspace writes (Steward)' in this feature's settings, so ask rather than retry. Prefer project_update_feature for features in your own project.";

pub(super) const STOP_SESSION_DESCRIPTION: &str = "Gracefully interrupt the current turn of a session in ANY CadencR project — the workspace-wide twin of project_stop_session. Interrupt-only: the target keeps its runtime and stays resumable through workspace_send_session_message. Requires the Steward grant on YOUR feature: without it the call is refused with STEWARD_REQUIRED, which only the user can lift by enabling 'Workspace writes (Steward)' in this feature's settings, so ask rather than retry.";

pub(super) fn update_feature_schema() -> Value {
    json!({
        "type": "object",
        "description": "Pass at least one of title, label, pinned, or status; an update with none of them fails with EMPTY_UPDATE.",
        "properties": {
            "feature_id": {
                "type": "number",
                "description": "Feature to update, from the feature.id of workspace_read_sessions or workspace_recent_activity. It may live in any project."
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

pub(super) fn stop_session_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_session_id": {
                "type": "number",
                "description": "Session whose current turn to interrupt, in any CadencR project. A session cannot stop itself (CANNOT_STOP_SELF); an already-idle target answers stopped: false with reason SESSION_NOT_RUNNING, which is success."
            }
        },
        "required": ["target_session_id"]
    })
}

#[cfg(test)]
mod tests {
    use super::{
        stop_session_schema, update_feature_schema, STOP_SESSION_DESCRIPTION,
        UPDATE_FEATURE_DESCRIPTION,
    };

    #[test]
    fn both_descriptions_name_the_refusal_code_and_the_user_facing_toggle() {
        for description in [UPDATE_FEATURE_DESCRIPTION, STOP_SESSION_DESCRIPTION] {
            assert!(description.contains("STEWARD_REQUIRED"));
            assert!(description.contains("Workspace writes (Steward)"));
            assert!(description.contains("ANY CadencR project"));
        }
    }

    #[test]
    fn update_feature_keeps_the_clearable_label_and_the_two_archive_states() {
        let schema = update_feature_schema();
        assert_eq!(schema["properties"]["label"]["type"][1], "null");
        assert_eq!(schema["properties"]["status"]["enum"][1], "archived");
        assert_eq!(schema["required"][0], "feature_id");
    }

    #[test]
    fn stop_session_requires_only_the_target() {
        let schema = stop_session_schema();
        assert_eq!(schema["required"], serde_json::json!(["target_session_id"]));
    }

    #[test]
    fn every_property_carries_its_own_description() {
        for schema in [update_feature_schema(), stop_session_schema()] {
            for (name, property) in schema["properties"].as_object().unwrap() {
                assert!(
                    property["description"]
                        .as_str()
                        .is_some_and(|value| !value.is_empty()),
                    "{name} is missing a description"
                );
            }
        }
    }
}
