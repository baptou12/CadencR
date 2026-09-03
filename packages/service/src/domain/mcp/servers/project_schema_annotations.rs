//! MCP tool annotations for `cadencr-project`.
//!
//! Every tool is listed by name and the fallback is the most conservative
//! reading (a write that may destroy state), because an omitted
//! `destructiveHint` already means *destructive* to a client: a tool added to
//! `PROJECT_TOOL_NAMES` without an arm here is over-warned, never under-warned.
//!
//! `destructiveHint` and `idempotentHint` are only meaningful when
//! `readOnlyHint` is false, so the read tools set nothing but `readOnlyHint`.
//! Nothing here reaches past CadencR's own database and worktrees, hence
//! `openWorldHint: false` throughout.

use rmcp::model::ToolAnnotations;

pub(super) fn tool_annotations(name: &str) -> ToolAnnotations {
    match name {
        "project_list_sessions"
        | "project_read_session"
        | "project_read_session_tail"
        | "project_get_session_status"
        | "project_get_worktree_status"
        | "project_find_related_sessions"
        | "project_compare_sessions"
        | "project_list_agent_providers"
        | "project_list_pending_gates"
        | "project_list_schedules" => read_only(),
        // Reversible metadata writes: replaying the same call lands on the same
        // state, and the inverse is expressible through the same tool.
        "project_update_feature"
        | "project_link_sessions"
        | "project_respond_gate"
        | "project_set_schedule_enabled" => write(false, true),
        // Each call adds something new: a session, a message, a run, a schedule,
        // an interrupt.
        "project_spawn_session"
        | "project_send_session_message"
        | "project_save_schedule"
        | "project_run_schedule"
        | "project_stop_session" => write(false, false),
        // The one tool that deletes: a git worktree, along with the git-ignored
        // files inside it. Removing an already-removed worktree changes nothing
        // further, so it is destructive and idempotent.
        "project_cleanup_worktree" => write(true, true),
        _ => write(true, false),
    }
}

fn read_only() -> ToolAnnotations {
    ToolAnnotations::new().read_only(true).open_world(false)
}

fn write(destructive: bool, idempotent: bool) -> ToolAnnotations {
    ToolAnnotations::new()
        .read_only(false)
        .destructive(destructive)
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

    /// An omitted `destructiveHint` reads as destructive, so every write tool
    /// has to state its own.
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

    #[test]
    fn worktree_cleanup_is_the_only_destructive_project_tool() {
        let destructive: Vec<_> = tools()
            .into_iter()
            .filter(|tool| {
                tool.annotations
                    .as_ref()
                    .is_some_and(|annotations| annotations.destructive_hint == Some(true))
            })
            .map(|tool| tool.name.to_string())
            .collect();

        assert_eq!(destructive, ["project_cleanup_worktree"]);
    }

    /// The hints only reach a client if they survive serialization under their
    /// spec names, which no assertion on the Rust struct would catch.
    #[test]
    fn the_hints_ride_on_the_wire_under_their_spec_names() {
        let tools = tools();
        let cleanup = tools
            .iter()
            .find(|tool| tool.name == "project_cleanup_worktree")
            .expect("project_cleanup_worktree tool");

        let json = serde_json::to_value(cleanup).expect("tool json");

        assert_eq!(json["annotations"]["readOnlyHint"], false);
        assert_eq!(json["annotations"]["destructiveHint"], true);
        assert_eq!(json["annotations"]["idempotentHint"], true);
        assert_eq!(json["annotations"]["openWorldHint"], false);
    }

    /// A tool added to the name list but not to the table must land on the
    /// pessimistic side of the hints.
    #[test]
    fn an_unlisted_tool_falls_back_to_a_destructive_write() {
        let annotations = tool_annotations("project_delete_everything");

        assert_eq!(annotations.read_only_hint, Some(false));
        assert_eq!(annotations.destructive_hint, Some(true));
        assert_eq!(annotations.open_world_hint, Some(false));
    }
}
