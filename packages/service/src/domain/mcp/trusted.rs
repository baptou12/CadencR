use super::tools::browser::is_auto_trusted_browser_tool;

const SERVER_DASH: &str = "cadencr-browser";
const SERVER_UNDERSCORE: &str = "cadencr_browser";

pub fn is_trusted_cadencr_browser_tool_name(name: &str) -> bool {
    tool_from_name(name).is_some_and(is_browser_tool)
}

pub fn is_trusted_cadencr_browser_server_tool(server: &str, tool: &str) -> bool {
    server_is_cadencr_browser(server) && is_browser_tool(tool)
}

pub fn is_trusted_cadencr_browser_namespace_tool(namespace: &str, tool: &str) -> bool {
    namespace_server(namespace).is_some_and(|server| {
        is_trusted_cadencr_browser_server_tool(server, tool.trim_start_matches('_'))
    })
}

fn tool_from_name(name: &str) -> Option<&str> {
    tool_from_mcp_name(name).or_else(|| name.strip_prefix("cadencr-browser_"))
}

fn tool_from_mcp_name(name: &str) -> Option<&str> {
    let rest = name.strip_prefix("mcp__")?;
    let (server, tool) = rest.split_once("__")?;
    server_is_cadencr_browser(server).then(|| tool.trim_start_matches('_'))
}

fn server_is_cadencr_browser(server: &str) -> bool {
    matches!(server, SERVER_DASH | SERVER_UNDERSCORE)
}

fn namespace_server(namespace: &str) -> Option<&str> {
    Some(
        namespace
            .strip_prefix("mcp__")
            .unwrap_or(namespace)
            .trim_end_matches('_'),
    )
    .filter(|server| !server.is_empty())
}

fn is_browser_tool(tool: &str) -> bool {
    is_auto_trusted_browser_tool(tool)
}

#[cfg(test)]
mod tests {
    use super::{
        is_trusted_cadencr_browser_namespace_tool, is_trusted_cadencr_browser_server_tool,
        is_trusted_cadencr_browser_tool_name,
    };

    #[test]
    fn recognizes_provider_specific_cadencr_browser_tool_names() {
        assert!(is_trusted_cadencr_browser_tool_name(
            "mcp__cadencr-browser__browser_open_url"
        ));
        assert!(is_trusted_cadencr_browser_tool_name(
            "mcp__cadencr_browser____browser_open_url"
        ));
        assert!(is_trusted_cadencr_browser_tool_name(
            "cadencr-browser_browser_open_url"
        ));
    }

    #[test]
    fn recognizes_cadencr_browser_server_tool_pairs() {
        assert!(is_trusted_cadencr_browser_server_tool(
            "cadencr-browser",
            "browser_screenshot"
        ));
        assert!(is_trusted_cadencr_browser_server_tool(
            "cadencr_browser",
            "browser_screenshot"
        ));
    }

    #[test]
    fn recognizes_codex_cadencr_browser_namespace_tool_pairs() {
        assert!(is_trusted_cadencr_browser_namespace_tool(
            "mcp__cadencr_browser",
            "browser_open_url"
        ));
        assert!(is_trusted_cadencr_browser_namespace_tool(
            "mcp__cadencr_browser__",
            "browser_open_url"
        ));
    }

    #[test]
    fn external_url_opener_is_not_auto_trusted() {
        // browser_open_external_url is a real browser tool but must follow the
        // provider's normal permission flow, so it is not auto-trusted.
        assert!(!is_trusted_cadencr_browser_tool_name(
            "mcp__cadencr-browser__browser_open_external_url"
        ));
        assert!(!is_trusted_cadencr_browser_server_tool(
            "cadencr-browser",
            "browser_open_external_url"
        ));
        // A normal browser tool stays trusted.
        assert!(is_trusted_cadencr_browser_tool_name(
            "mcp__cadencr-browser__browser_open_url"
        ));
    }

    #[test]
    fn rejects_non_browser_and_unknown_cadencr_tools() {
        assert!(!is_trusted_cadencr_browser_tool_name("Bash"));
        assert!(!is_trusted_cadencr_browser_tool_name(
            "mcp__cadencr-workspace__read_conversation"
        ));
        assert!(!is_trusted_cadencr_browser_tool_name(
            "mcp__cadencr-browser__read_conversation"
        ));
        assert!(!is_trusted_cadencr_browser_server_tool(
            "cadencr-browser",
            "read_conversation"
        ));
        assert!(!is_trusted_cadencr_browser_namespace_tool(
            "mcp__cadencr_browser",
            "read_conversation"
        ));
    }
}
