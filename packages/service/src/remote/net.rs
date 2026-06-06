use std::net::IpAddr;

/// Non-loopback IPv4 addresses of the host, used to build the LAN URLs/QR and
/// to extend the `Host`-header allowlist. IPv6 is intentionally skipped for M1:
/// the QR/URL story is IPv4-only and link-local v6 needs a zone id that doesn't
/// round-trip through a browser URL.
pub fn lan_ipv4s() -> Vec<IpAddr> {
    match if_addrs::get_if_addrs() {
        Ok(addrs) => addrs
            .into_iter()
            .filter(|iface| !iface.is_loopback())
            .map(|iface| iface.ip())
            .filter(IpAddr::is_ipv4)
            .collect(),
        Err(err) => {
            tracing::warn!("failed to enumerate network interfaces: {err}");
            Vec::new()
        }
    }
}
