pub fn is_loopback_host(host: Option<&str>) -> bool {
    matches!(host, Some("127.0.0.1" | "localhost" | "::1" | "[::1]"))
}

#[cfg(test)]
mod tests {
    use super::is_loopback_host;

    #[test]
    fn identifies_loopback_hosts_shared_by_browser_mcp() {
        assert!(is_loopback_host(Some("localhost")));
        assert!(is_loopback_host(Some("127.0.0.1")));
        assert!(is_loopback_host(Some("::1")));
        assert!(is_loopback_host(Some("[::1]")));
        assert!(!is_loopback_host(Some("example.com")));
        assert!(!is_loopback_host(None));
    }
}
