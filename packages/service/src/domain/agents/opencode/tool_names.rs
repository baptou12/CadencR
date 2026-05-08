//! Normalize OpenCode-emitted tool names to the canonical Cadencr MCP format.
//!
//! Claude Code emits MCP tool calls as `mcp__<server>__<tool>`; OpenCode emits
//! them as `<server>_<tool>`. The frontend tool parser only recognizes the
//! Claude form, so we rewrite at the adapter boundary.

use crate::domain::mcp::servers::AgentType;

const CADENCR_MCP_PREFIX: &str = "mcp__cadencr-";
const CADENCR_SERVER_PREFIX: &str = "cadencr-";

/// Rewrite `cadencr-<server>_<tool>` → `mcp__cadencr-<server>__<tool>`.
/// Leaves names that are already canonical or unrelated untouched.
pub(in crate::domain::agents::opencode) fn canonical_cadencr_tool_name(name: &str) -> String {
    if name.starts_with(CADENCR_MCP_PREFIX) {
        return name.to_string();
    }
    let Some(rest) = name.strip_prefix(CADENCR_SERVER_PREFIX) else {
        return name.to_string();
    };
    for agent in AgentType::ALL {
        let server = agent.short_name();
        if let Some(tool) = rest.strip_prefix(server).and_then(|s| s.strip_prefix('_')) {
            return format!("{CADENCR_MCP_PREFIX}{server}__{tool}");
        }
    }
    name.to_string()
}

/// Map OpenCode's ACP-flavoured lowercase tool kinds (`write`, `edit`,
/// `bash`, …) onto the Pascal-case names the Cadencr frontend's tool
/// renderers and `isFileChangeTool` set expect. Without this rewrite the
/// FE falls back to the generic collapsed tool block and `Write`/`Edit`
/// never render as inline diffs.
///
/// Unknown names pass through unchanged so MCP tools and capitalised
/// emissions (Claude-style) are preserved verbatim.
pub(in crate::domain::agents::opencode) fn canonical_acp_tool_name(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "write" => "Write".to_string(),
        "edit" => "Edit".to_string(),
        // OpenCode emits `multiedit` (some forks) and `multi_edit`; both map.
        "multiedit" | "multi_edit" | "multi-edit" => "MultiEdit".to_string(),
        "notebookedit" | "notebook_edit" | "notebook-edit" => "NotebookEdit".to_string(),
        "applypatch" | "apply_patch" | "apply-patch" => "ApplyPatch".to_string(),
        "bash" | "shell" => "Bash".to_string(),
        "read" => "Read".to_string(),
        "glob" => "Glob".to_string(),
        "grep" => "Grep".to_string(),
        "ls" | "list" => "LS".to_string(),
        "task" | "subagent" => "Task".to_string(),
        // OpenCode's built-in interactive Q&A tool is named `question` on
        // both HTTP (see `stream_state::turn_completion`) and ACP. Map it
        // onto Cadencr's canonical `AskUserQuestion` name so the ACP
        // `tool_call` is routed to the question drawer pipeline rather
        // than rendered as a generic tool block.
        "question" | "askuserquestion" | "ask_user_question" => "AskUserQuestion".to_string(),
        "todowrite" | "todo_write" | "todo-write" => "TodoWrite".to_string(),
        "webfetch" | "web_fetch" | "web-fetch" => "WebFetch".to_string(),
        "websearch" | "web_search" | "web-search" => "WebSearch".to_string(),
        _ => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::canonical_cadencr_tool_name;

    #[test]
    fn rewrites_opencode_cadencr_tool_names() {
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-plan_update_plan"),
            "mcp__cadencr-plan__update_plan"
        );
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-execute_mark_phase_done"),
            "mcp__cadencr-execute__mark_phase_done"
        );
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-session_create_phase"),
            "mcp__cadencr-session__create_phase"
        );
    }

    #[test]
    fn passes_through_already_canonical_names() {
        assert_eq!(
            canonical_cadencr_tool_name("mcp__cadencr-plan__update_plan"),
            "mcp__cadencr-plan__update_plan"
        );
    }

    #[test]
    fn passes_through_non_cadencr_tools() {
        assert_eq!(canonical_cadencr_tool_name("Bash"), "Bash");
        assert_eq!(canonical_cadencr_tool_name("Read"), "Read");
        assert_eq!(canonical_cadencr_tool_name("custom_tool"), "custom_tool");
    }

    #[test]
    fn leaves_unknown_cadencr_servers_alone() {
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-unknown_some_tool"),
            "cadencr-unknown_some_tool"
        );
    }

    use super::canonical_acp_tool_name;

    #[test]
    fn acp_lowercase_tool_kinds_map_to_pascal_case() {
        assert_eq!(canonical_acp_tool_name("write"), "Write");
        assert_eq!(canonical_acp_tool_name("edit"), "Edit");
        assert_eq!(canonical_acp_tool_name("bash"), "Bash");
        assert_eq!(canonical_acp_tool_name("shell"), "Bash");
        assert_eq!(canonical_acp_tool_name("read"), "Read");
        assert_eq!(canonical_acp_tool_name("glob"), "Glob");
        assert_eq!(canonical_acp_tool_name("grep"), "Grep");
        assert_eq!(canonical_acp_tool_name("ls"), "LS");
        assert_eq!(canonical_acp_tool_name("task"), "Task");
        assert_eq!(canonical_acp_tool_name("todowrite"), "TodoWrite");
        assert_eq!(canonical_acp_tool_name("multi_edit"), "MultiEdit");
        assert_eq!(canonical_acp_tool_name("apply_patch"), "ApplyPatch");
    }

    #[test]
    fn acp_question_variants_map_to_canonical_ask_user_question() {
        // Without this mapping, OpenCode's built-in `question` tool is left
        // as `question` and `events_tool_call.rs` never routes it to the
        // question drawer (which checks `tool_name == "AskUserQuestion"`).
        assert_eq!(canonical_acp_tool_name("question"), "AskUserQuestion");
        assert_eq!(canonical_acp_tool_name("Question"), "AskUserQuestion");
        assert_eq!(
            canonical_acp_tool_name("askuserquestion"),
            "AskUserQuestion"
        );
        assert_eq!(
            canonical_acp_tool_name("ask_user_question"),
            "AskUserQuestion"
        );
    }

    #[test]
    fn acp_passes_through_already_canonical_names() {
        assert_eq!(canonical_acp_tool_name("Write"), "Write");
        assert_eq!(canonical_acp_tool_name("Bash"), "Bash");
    }

    #[test]
    fn acp_leaves_unknown_tools_unchanged() {
        assert_eq!(canonical_acp_tool_name("custom_tool"), "custom_tool");
        assert_eq!(canonical_acp_tool_name("FetchUrl"), "FetchUrl");
    }
}
