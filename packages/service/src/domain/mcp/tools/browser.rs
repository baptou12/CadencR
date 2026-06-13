use crate::domain::mcp::loopback::is_loopback_host;
use reqwest::Url;

/// Opens an arbitrary external web URL. Unlike the other browser tools this one
/// is deliberately NOT auto-trusted, so it goes through each provider's normal
/// permission flow (see `is_auto_trusted_browser_tool`).
pub const BROWSER_OPEN_EXTERNAL_URL: &str = "browser_open_external_url";

pub const BROWSER_TOOL_NAMES: [&str; 15] = [
    "browser_list_tabs",
    "browser_open_url",
    BROWSER_OPEN_EXTERNAL_URL,
    "browser_get_console",
    "browser_get_network",
    "browser_get_snapshot",
    "browser_screenshot",
    "browser_click",
    "browser_fill",
    "browser_hover",
    "browser_type",
    "browser_keypress",
    "browser_wait_for",
    "browser_evaluate",
    "browser_select_element_context",
];

/// Browser tools that are auto-approved without prompting the user (Cadencr's
/// special trust for its own dev-server tooling). The external-URL opener is the
/// one exclusion: opening arbitrary remote sites must follow the provider's
/// normal permission flow instead.
pub fn is_auto_trusted_browser_tool(tool: &str) -> bool {
    BROWSER_TOOL_NAMES.contains(&tool) && tool != BROWSER_OPEN_EXTERNAL_URL
}

pub fn is_localhost_automation_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https") && is_loopback_host(url.host_str())
}

pub fn is_local_file_url(raw_url: &str) -> bool {
    Url::parse(raw_url).is_ok_and(|url| url.scheme() == "file")
}

pub fn open_url_allowed(target_url: &str) -> Result<(), String> {
    // Loopback pages can be fully automated; local files can be opened and
    // inspected but not mutated (the desktop bridge denies automation on them).
    if is_localhost_automation_url(target_url) || is_local_file_url(target_url) {
        Ok(())
    } else {
        Err("Browser MCP can open only localhost or file:// URLs.".to_string())
    }
}

/// Validates the target of `browser_open_external_url`: any web (`http`/`https`)
/// URL, remote or local. Non-web schemes (`file:`, `javascript:`, …) are
/// rejected — local files belong on the loopback `browser_open_url` tool.
pub fn external_open_url_allowed(target_url: &str) -> Result<(), String> {
    match Url::parse(target_url) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => Ok(()),
        Ok(url) => Err(format!(
            "browser_open_external_url supports only http(s) URLs, not {}:// URLs.",
            url.scheme()
        )),
        Err(_) => Err("browser_open_external_url requires a valid http(s) URL.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        external_open_url_allowed, is_auto_trusted_browser_tool, is_localhost_automation_url,
        BROWSER_OPEN_EXTERNAL_URL, BROWSER_TOOL_NAMES,
    };

    #[test]
    fn browser_tool_names_include_mvp_surface() {
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_list_tabs"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_click"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_select_element_context"));
    }

    #[test]
    fn browser_tool_names_include_inspection_surface() {
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_get_snapshot"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_screenshot"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_evaluate"));
    }

    #[test]
    fn browser_tool_names_include_interaction_surface() {
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_fill"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_hover"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_wait_for"));
    }

    #[test]
    fn localhost_policy_allows_loopback_http_and_https() {
        assert!(is_localhost_automation_url("http://localhost:1420"));
        assert!(is_localhost_automation_url("https://localhost:3000"));
        assert!(is_localhost_automation_url("http://127.0.0.1:5005"));
        assert!(is_localhost_automation_url("http://[::1]:5173"));
    }

    #[test]
    fn localhost_policy_denies_remote_file_and_javascript_urls() {
        assert!(!is_localhost_automation_url("https://example.com"));
        assert!(!is_localhost_automation_url("file:///tmp/index.html"));
        assert!(!is_localhost_automation_url("javascript:alert(1)"));
    }

    #[test]
    fn browser_open_url_policy_allows_localhost_and_file_targets() {
        assert!(super::open_url_allowed("http://localhost:3000").is_ok());
        assert!(super::open_url_allowed("file:///tmp/index.html").is_ok());
        assert!(super::open_url_allowed("https://example.com").is_err());
    }

    #[test]
    fn file_url_is_openable_but_not_localhost_automation() {
        // file: URLs may be opened, but they are not "localhost automation"
        // targets, so the desktop bridge still denies click/fill/evaluate on them.
        assert!(super::is_local_file_url("file:///tmp/index.html"));
        assert!(!is_localhost_automation_url("file:///tmp/index.html"));
    }

    #[test]
    fn external_open_url_tool_is_exposed_but_not_auto_trusted() {
        // Exposed by the server, but excluded from the auto-trust set so it
        // follows each provider's normal permission flow.
        assert!(BROWSER_TOOL_NAMES.contains(&BROWSER_OPEN_EXTERNAL_URL));
        assert!(!is_auto_trusted_browser_tool(BROWSER_OPEN_EXTERNAL_URL));
        assert!(is_auto_trusted_browser_tool("browser_open_url"));
        assert!(is_auto_trusted_browser_tool("browser_click"));
    }

    #[test]
    fn external_open_url_policy_allows_web_and_rejects_non_web() {
        assert!(external_open_url_allowed("https://example.com").is_ok());
        assert!(external_open_url_allowed("http://example.com/path").is_ok());
        assert!(external_open_url_allowed("https://localhost:3000").is_ok());
        assert!(external_open_url_allowed("file:///tmp/index.html").is_err());
        assert!(external_open_url_allowed("javascript:alert(1)").is_err());
        assert!(external_open_url_allowed("not a url").is_err());
    }
}
