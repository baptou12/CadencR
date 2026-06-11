use crate::domain::mcp::loopback::is_loopback_host;
use reqwest::Url;

pub const BROWSER_TOOL_NAMES: [&str; 10] = [
    "browser_list_tabs",
    "browser_open_url",
    "browser_get_console",
    "browser_get_network",
    "browser_get_snapshot",
    "browser_screenshot",
    "browser_click",
    "browser_type",
    "browser_keypress",
    "browser_select_element_context",
];

pub fn is_localhost_automation_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https") && is_loopback_host(url.host_str())
}

pub fn open_url_allowed(target_url: &str) -> Result<(), String> {
    if is_localhost_automation_url(target_url) {
        Ok(())
    } else {
        Err("Browser MCP can open only localhost URLs.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{is_localhost_automation_url, BROWSER_TOOL_NAMES};

    #[test]
    fn browser_tool_names_include_mvp_surface() {
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_list_tabs"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_click"));
        assert!(BROWSER_TOOL_NAMES.contains(&"browser_select_element_context"));
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
    fn browser_open_url_policy_requires_localhost_target() {
        assert!(super::open_url_allowed("http://localhost:3000").is_ok());
        assert!(super::open_url_allowed("https://example.com").is_err());
    }
}
