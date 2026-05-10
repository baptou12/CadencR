//! Shared "reserve an OS-assigned localhost port, hand the number to a
//! subprocess" helper.
//!
//! Both the ACP session spawn (`acp::spawn_acp_session`) and the live
//! provider catalog probe
//! (`crate::domain::agents::providers::opencode::probe`) need to bind a
//! free port, release it, and let `opencode acp --port <port>` re-bind
//! it. Keeping this in one place avoids drifting two near-identical
//! copies.

use std::net::TcpListener;

use crate::domain::agents::adapter::RuntimeError;

pub(in crate::domain::agents) struct ReservedLocalPort {
    listener: TcpListener,
    port: u16,
}

impl ReservedLocalPort {
    pub(in crate::domain::agents) fn port(&self) -> u16 {
        self.port
    }

    /// Drop the listener and return the port number. The probe path uses
    /// this so the listener is released *before* opencode tries to bind.
    pub(in crate::domain::agents) fn into_port(self) -> u16 {
        let Self { listener, port } = self;
        drop(listener);
        port
    }
}

pub(in crate::domain::agents) fn reserve_local_port() -> Result<ReservedLocalPort, RuntimeError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        RuntimeError::new(format!("failed to reserve ACP sidecar port: {error}"))
    })?;
    let port = listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| RuntimeError::new(format!("failed to read ACP sidecar port: {error}")))?;
    Ok(ReservedLocalPort { listener, port })
}

#[cfg(test)]
mod tests {
    use super::reserve_local_port;

    #[test]
    fn reserve_local_port_yields_nonzero_port() {
        let reserved = reserve_local_port().expect("reserve port");
        assert!(reserved.port() > 0);
    }

    #[test]
    fn into_port_releases_listener_and_returns_same_port() {
        let reserved = reserve_local_port().expect("reserve port");
        let port = reserved.port();
        assert_eq!(reserved.into_port(), port);
    }
}
