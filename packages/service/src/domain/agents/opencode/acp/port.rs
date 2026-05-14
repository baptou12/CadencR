//! Shared "reserve an OS-assigned localhost port, hand the number to a
//! subprocess" helper.
//!
//! The ACP session spawn needs to reserve a free port and keep that
//! reservation alive until the child process is spawned.

use std::net::TcpListener;

use crate::domain::agents::adapter::RuntimeError;

pub(in crate::domain::agents) struct ReservedLocalPort {
    _listener: TcpListener,
    port: u16,
}

impl ReservedLocalPort {
    pub(in crate::domain::agents) fn port(&self) -> u16 {
        self.port
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
    Ok(ReservedLocalPort {
        _listener: listener,
        port,
    })
}

#[cfg(test)]
mod tests {
    use super::reserve_local_port;

    #[test]
    fn reserve_local_port_yields_nonzero_port() {
        let reserved = reserve_local_port().expect("reserve port");
        assert!(reserved.port() > 0);
    }
}
