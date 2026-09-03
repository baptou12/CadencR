//! MCP tool annotations for `cadencr-workspace`.
//!
//! Same rules as the project table (`project_schema_annotations`): every tool
//! named explicitly, a conservative fallback, and `openWorldHint: false`
//! because nothing here leaves CadencR's own database. The Steward grant is an
//! authorization concern and has no bearing on these hints — a refused call
//! still writes nothing, and a granted one writes the same way its
//! project-scoped twin does.

use rmcp::model::ToolAnnotations;

pub(super) fn tool_annotations(name: &str) -> ToolAnnotations {
    match name {
        "workspace_list_projects"
        | "workspace_read_session"
        | "workspace_read_sessions"
        | "workspace_session_graph"
        | "workspace_recent_activity" => ToolAnnotations::new().read_only(true).open_world(false),
        "workspace_update_feature" => write(true),
        "workspace_send_session_message" | "workspace_stop_session" => write(false),
        _ => ToolAnnotations::new()
            .read_only(false)
            .destructive(true)
            .idempotent(false)
            .open_world(false),
    }
}

/// No workspace tool deletes anything: `workspace_update_feature` archives
/// (reversible) and `workspace_stop_session` interrupts a turn the target can
/// resume.
fn write(idempotent: bool) -> ToolAnnotations {
    ToolAnnotations::new()
        .read_only(false)
        .destructive(false)
        .idempotent(idempotent)
        .open_world(false)
}

#[cfg(test)]
mod tests {
    use super::super::tools;
    use super::tool_annotations;

    #[test]
    fn every_advertised_tool_states_whether_it_writes() {
        for tool in tools() {
            let annotations = tool
                .annotations
                .as_ref()
                .unwrap_or_else(|| panic!("{} is missing annotations", tool.name));
            assert!(
                annotations.read_only_hint.is_some(),
                "{} leaves read_only_hint to the client's default",
                tool.name
            );
        }
    }

    #[test]
    fn every_write_tool_sets_its_destructive_and_idempotent_hints() {
        for tool in tools() {
            let annotations = tool.annotations.as_ref().expect("annotations");
            if annotations.read_only_hint == Some(false) {
                assert!(
                    annotations.destructive_hint.is_some(),
                    "{} does not state destructive_hint",
                    tool.name
                );
                assert!(
                    annotations.idempotent_hint.is_some(),
                    "{} does not state idempotent_hint",
                    tool.name
                );
            }
        }
    }

    /// Archiving and interrupting are both reversible, so a client should never
    /// be told a workspace tool destroys anything.
    #[test]
    fn no_advertised_workspace_tool_is_destructive() {
        for tool in tools() {
            assert_ne!(
                tool.annotations
                    .as_ref()
                    .expect("annotations")
                    .destructive_hint,
                Some(true),
                "{} claims to be destructive",
                tool.name
            );
        }
    }

    #[test]
    fn an_unlisted_tool_falls_back_to_a_destructive_write() {
        let annotations = tool_annotations("workspace_delete_everything");

        assert_eq!(annotations.read_only_hint, Some(false));
        assert_eq!(annotations.destructive_hint, Some(true));
    }
}
