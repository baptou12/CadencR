//! MCP tool annotations for `cadencr-browser`.
//!
//! Same conservative table as the other two servers. The world is closed for
//! every tool — automation only ever runs against a loopback or `file://` tab —
//! except `browser_open_external_url`, whose whole purpose is to reach the open
//! internet.

use rmcp::model::ToolAnnotations;

use crate::domain::mcp::tools::browser::BROWSER_OPEN_EXTERNAL_URL;

pub(super) fn tool_annotations(name: &str) -> ToolAnnotations {
    match name {
        // Observation only: they read the tab, they do not drive it.
        "browser_list_tabs"
        | "browser_get_console"
        | "browser_get_network"
        | "browser_get_snapshot"
        | "browser_screenshot"
        | "browser_wait_for"
        | "browser_select_element_context" => {
            ToolAnnotations::new().read_only(true).open_world(false)
        }
        // Setting a field or hovering an element converges on the same state
        // however often it is repeated.
        "browser_fill" | "browser_hover" => write(false, true),
        // Navigation and input each move the page somewhere new, and `new_tab`
        // makes a repeated open add another tab.
        "browser_open_url" | "browser_click" | "browser_type" | "browser_keypress" => {
            write(false, false)
        }
        // Arbitrary script in the page: the one browser tool whose effect is
        // unbounded, so it is advertised as destructive.
        "browser_evaluate" => write(true, false),
        name if name == BROWSER_OPEN_EXTERNAL_URL => ToolAnnotations::new()
            .read_only(false)
            .destructive(false)
            .idempotent(false)
            .open_world(true),
        _ => write(true, false),
    }
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
    use super::{tool_annotations, BROWSER_OPEN_EXTERNAL_URL};

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

    /// The external opener is the only door to the open internet; everything
    /// else is confined to a loopback or `file://` tab.
    #[test]
    fn only_the_external_opener_declares_an_open_world() {
        let open_world: Vec<_> = tools()
            .into_iter()
            .filter(|tool| {
                tool.annotations
                    .as_ref()
                    .is_some_and(|annotations| annotations.open_world_hint == Some(true))
            })
            .map(|tool| tool.name.to_string())
            .collect();

        assert_eq!(open_world, [BROWSER_OPEN_EXTERNAL_URL]);
    }

    #[test]
    fn an_unlisted_tool_falls_back_to_a_destructive_write() {
        let annotations = tool_annotations("browser_wipe_disk");

        assert_eq!(annotations.read_only_hint, Some(false));
        assert_eq!(annotations.destructive_hint, Some(true));
    }
}
